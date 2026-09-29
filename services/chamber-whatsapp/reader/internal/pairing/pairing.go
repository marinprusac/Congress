// Package pairing links the daemon to a WhatsApp account from Congress:
// it runs the QR flow on request and keeps the current code for the UI.
package pairing

import (
	"context"
	"errors"
	"sync"
	"time"

	"rsc.io/qr"

	"congress/wa-reader/internal/waclient"
)

// Client is the slice of waclient.Reader pairing needs.
type Client interface {
	IsPaired() bool
	Connect() error
	Disconnect()
	QRChannel(ctx context.Context) (<-chan waclient.QRItem, error)
}

type Snapshot struct {
	State     string   `json:"state"` // idle | waiting | success | expired | error
	ExpiresAt int64    `json:"expiresAt,omitempty"`
	QR        []string `json:"qr,omitempty"` // module rows, "1" = dark
	Error     string   `json:"error,omitempty"`
}

var ErrAlreadyPaired = errors.New("already paired")

type Pairing struct {
	client    Client
	onSuccess func()
	now       func() time.Time

	mu    sync.Mutex
	state string
	code  string
	exp   time.Time
	err   string
}

func New(client Client, onSuccess func()) *Pairing {
	return &Pairing{client: client, onSuccess: onSuccess, now: time.Now, state: "idle"}
}

// Start begins a QR session unless one is running; codes rotate until
// scanned or WhatsApp stops issuing them (~2 minutes).
func (p *Pairing) Start(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.client.IsPaired() {
		return ErrAlreadyPaired
	}
	if p.state == "waiting" {
		return nil
	}
	items, err := p.client.QRChannel(ctx)
	if err != nil {
		return err
	}
	if err := p.client.Connect(); err != nil {
		return err
	}
	p.state, p.code, p.err = "waiting", "", ""
	go p.run(items)
	return nil
}

func (p *Pairing) run(items <-chan waclient.QRItem) {
	for it := range items {
		switch it.Event {
		case "code":
			p.mu.Lock()
			p.code, p.exp = it.Code, p.now().Add(it.Timeout)
			p.mu.Unlock()
		case "success":
			p.finish("success", "")
			if p.onSuccess != nil {
				p.onSuccess()
			}
			return
		default:
			// Disconnect before leaving "waiting": until then a new Start is a
			// no-op, so this can't cut off a session started after it.
			p.client.Disconnect()
			if it.Event == "timeout" {
				p.finish("expired", "")
			} else if it.Err != nil {
				p.finish("error", it.Err.Error())
			} else {
				p.finish("error", it.Event)
			}
			return
		}
	}
}

func (p *Pairing) finish(state, errText string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.state, p.code, p.err = state, "", errText
}

func (p *Pairing) Snapshot() Snapshot {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := Snapshot{State: p.state, Error: p.err}
	if p.state == "waiting" && p.code != "" {
		s.ExpiresAt = p.exp.UnixMilli()
		s.QR = matrix(p.code)
	}
	return s
}

// matrix renders a QR code as rows of "0"/"1" so the browser can draw it.
func matrix(code string) []string {
	c, err := qr.Encode(code, qr.L)
	if err != nil {
		return nil
	}
	rows := make([]string, c.Size)
	for y := 0; y < c.Size; y++ {
		b := make([]byte, c.Size)
		for x := 0; x < c.Size; x++ {
			b[x] = '0'
			if c.Black(x, y) {
				b[x] = '1'
			}
		}
		rows[y] = string(b)
	}
	return rows
}
