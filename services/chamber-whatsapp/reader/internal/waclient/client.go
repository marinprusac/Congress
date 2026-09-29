// Package waclient is the only package that imports whatsmeow's client.
// It exposes connect, receive and download - never anything that sends.
package waclient

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"

	wastore "congress/wa-reader/internal/store"
)

// Reader is everything the rest of wa-reader may do with WhatsApp.
type Reader interface {
	Connect() error
	Disconnect()
	IsConnected() bool
	IsPaired() bool
	OwnJID() types.JID
	AddEventHandler(func(any))
	QRChannel(ctx context.Context) (<-chan QRItem, error)
	Download(ctx context.Context, m MediaRef) ([]byte, error)
	PNForLID(ctx context.Context, lid types.JID) (types.JID, bool)
	GroupName(ctx context.Context, group types.JID) (string, error)
	ParseWebMessage(chat types.JID, msg *waWeb.WebMessageInfo) (*events.Message, error)
}

type QRItem struct {
	Event   string // "code", "success", "timeout", or an error event
	Code    string
	Timeout time.Duration
	Err     error
}

// MediaRef is the stored metadata needed to fetch one attachment.
type MediaRef struct {
	Kind       string // message type: image, video, audio, voice, document, sticker
	DirectPath string
	Key        []byte
	SHA256     []byte
	EncSHA256  []byte
}

var ErrMediaExpired = errors.New("media no longer available on WhatsApp's servers")

type Options struct {
	SessionDB   string
	DeviceName  string
	FullHistory bool
	LogLevel    string
}

type client struct {
	cli       *whatsmeow.Client
	container *sqlstore.Container

	groupMu   sync.Mutex
	lastGroup time.Time
}

// Open loads (or creates) the session store and builds a client that isn't connected yet.
func Open(ctx context.Context, o Options) (Reader, func() error, error) {
	// Only the companion's label in the phone's Linked Devices list; cosmetic.
	store.SetOSInfo(o.DeviceName, [3]uint32{1, 0, 0})
	store.DeviceProps.PlatformType = waCompanionReg.DeviceProps_DESKTOP.Enum()
	store.DeviceProps.RequireFullSync = proto.Bool(o.FullHistory)

	if _, err := wastore.Touch(o.SessionDB); err != nil {
		return nil, nil, err
	}
	db, err := sql.Open("sqlite", wastore.DSN(o.SessionDB))
	if err != nil {
		return nil, nil, err
	}
	log := waLog.Stdout("whatsmeow", o.LogLevel, false)
	container := sqlstore.NewWithDB(db, "sqlite3", log.Sub("store"))
	if err := container.Upgrade(ctx); err != nil {
		db.Close()
		return nil, nil, fmt.Errorf("session store: %w", err)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		container.Close()
		return nil, nil, err
	}
	cli := whatsmeow.NewClient(device, log.Sub("client"))
	cli.EnableAutoReconnect = true
	// Asking the phone to resend undecryptable messages is an outbound
	// request beyond passive receipts; leave it off.
	cli.AutomaticMessageRerequestFromPhone = false
	return &client{cli: cli, container: container}, container.Close, nil
}

func (c *client) Connect() error     { return c.cli.Connect() }
func (c *client) Disconnect()        { c.cli.Disconnect() }
func (c *client) IsConnected() bool  { return c.cli.IsConnected() }
func (c *client) IsPaired() bool     { return c.cli.Store.ID != nil }
func (c *client) OwnJID() types.JID {
	if c.cli.Store.ID == nil {
		return types.EmptyJID
	}
	return c.cli.Store.ID.ToNonAD()
}

func (c *client) AddEventHandler(h func(any)) { c.cli.AddEventHandler(h) }

func (c *client) QRChannel(ctx context.Context) (<-chan QRItem, error) {
	src, err := c.cli.GetQRChannel(ctx)
	if err != nil {
		return nil, err
	}
	out := make(chan QRItem)
	go func() {
		defer close(out)
		for it := range src {
			out <- QRItem{Event: it.Event, Code: it.Code, Timeout: it.Timeout, Err: it.Error}
		}
	}()
	return out, nil
}

var mediaTypes = map[string]whatsmeow.MediaType{
	"image": whatsmeow.MediaImage, "sticker": whatsmeow.MediaImage,
	"video": whatsmeow.MediaVideo, "gif": whatsmeow.MediaVideo,
	"audio": whatsmeow.MediaAudio, "voice": whatsmeow.MediaAudio,
	"document": whatsmeow.MediaDocument,
}

func (c *client) Download(ctx context.Context, m MediaRef) ([]byte, error) {
	mt, ok := mediaTypes[m.Kind]
	if !ok {
		return nil, fmt.Errorf("no downloadable media for type %q", m.Kind)
	}
	data, err := c.cli.DownloadMediaWithPath(ctx, m.DirectPath, m.EncSHA256, m.SHA256, m.Key, mt, "", false)
	if errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith404) || errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith410) {
		return nil, ErrMediaExpired
	}
	return data, err
}

func (c *client) PNForLID(ctx context.Context, lid types.JID) (types.JID, bool) {
	pn, err := c.cli.Store.LIDs.GetPNForLID(ctx, lid)
	if err != nil || pn.IsEmpty() {
		return types.EmptyJID, false
	}
	return pn.ToNonAD(), true
}

// GroupName is a read-only IQ query; calls are spaced at least 2s apart
// to stay well under WhatsApp's rate limits.
func (c *client) GroupName(ctx context.Context, group types.JID) (string, error) {
	c.groupMu.Lock()
	defer c.groupMu.Unlock()
	if wait := 2*time.Second - time.Since(c.lastGroup); wait > 0 {
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	c.lastGroup = time.Now()
	info, err := c.cli.GetGroupInfo(ctx, group)
	if err != nil {
		return "", err
	}
	return info.Name, nil
}

func (c *client) ParseWebMessage(chat types.JID, msg *waWeb.WebMessageInfo) (*events.Message, error) {
	return c.cli.ParseWebMessage(chat, msg)
}
