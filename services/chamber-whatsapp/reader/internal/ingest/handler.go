// Package ingest turns whatsmeow events into rows in the messages store.
package ingest

import (
	"context"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"congress/wa-reader/internal/store"
)

// Source is the read-only slice of the WhatsApp client ingest needs.
type Source interface {
	OwnJID() types.JID
	PNForLID(ctx context.Context, lid types.JID) (types.JID, bool)
	GroupName(ctx context.Context, group types.JID) (string, error)
	Contacts(ctx context.Context) (map[types.JID]types.ContactInfo, error)
	ParseWebMessage(chat types.JID, msg *waWeb.WebMessageInfo) (*events.Message, error)
}

type Handler struct {
	st     *store.Store
	src    Source
	log    *slog.Logger
	Status *Status
	now    func() time.Time

	merged     sync.Map // LID chat -> struct{}, already merged into its PN chat
	groupQueue chan types.JID
	groupAsked sync.Map
	persistMu  sync.Mutex
	persisted  time.Time
}

func NewHandler(st *store.Store, src Source, log *slog.Logger, status *Status) *Handler {
	return &Handler{st: st, src: src, log: log, Status: status, now: time.Now, groupQueue: make(chan types.JID, 512)}
}

const (
	metaLastEvent = "last_event_at"
	metaLastPhone = "last_phone_at"
)

// Restore loads the last-seen times persisted by a previous run.
func (h *Handler) Restore(ctx context.Context) {
	load := func(key string) time.Time {
		v, _ := h.st.Meta(ctx, key)
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return time.UnixMilli(n)
		}
		return time.Time{}
	}
	h.Status.Restore(load(metaLastEvent), load(metaLastPhone))
}

func (h *Handler) touch(ctx context.Context, phone bool) {
	h.Status.Touch(h.now(), phone)
	h.persistMu.Lock()
	defer h.persistMu.Unlock()
	if !phone && h.now().Sub(h.persisted) < time.Minute {
		return
	}
	h.persisted = h.now()
	snap := h.Status.Snapshot()
	_ = h.st.SetMeta(ctx, metaLastEvent, strconv.FormatInt(snap.LastEventAt, 10))
	_ = h.st.SetMeta(ctx, metaLastPhone, strconv.FormatInt(snap.LastPhoneAt, 10))
}

// Handle is registered with the client; it must never send anything.
func (h *Handler) Handle(evt any) {
	ctx := context.Background()
	switch e := evt.(type) {
	case *events.Message:
		h.touch(ctx, e.Info.IsFromMe)
		if err := h.Message(ctx, e); err != nil {
			h.log.Error("store message", "id", e.Info.ID, "err", err)
		}
	case *events.HistorySync:
		h.touch(ctx, true)
		h.HistorySync(ctx, e)
	case *events.PushName:
		h.touch(ctx, false)
		jid := h.resolveUser(ctx, e.JID, e.JIDAlt)
		_ = h.st.UpsertContact(ctx, store.Contact{JID: jid.String(), PushName: e.NewPushName})
	case *events.Contact:
		h.touch(ctx, true)
		if a := e.Action; a != nil {
			jid := h.resolveUser(ctx, e.JID, types.EmptyJID)
			_ = h.st.UpsertContact(ctx, store.Contact{JID: jid.String(), FullName: a.GetFullName()})
		}
	case *events.BusinessName:
		jid := h.resolveUser(ctx, e.JID, types.EmptyJID)
		_ = h.st.UpsertContact(ctx, store.Contact{JID: jid.String(), BusinessName: e.NewBusinessName})
	case *events.GroupInfo:
		if e.Name != nil {
			_ = h.st.SetChatName(ctx, e.JID.String(), e.Name.Name, true)
		}
	case *events.JoinedGroup:
		_ = h.st.SetChatName(ctx, e.JID.String(), e.Name, true)
	case *events.Receipt:
		// Only the owner's own reads on another device (phone, WhatsApp Web).
		if e.IsFromMe && (e.Type == types.ReceiptTypeRead || e.Type == types.ReceiptTypeReadSelf) {
			h.touch(ctx, true)
			if err := h.Receipt(ctx, e); err != nil {
				h.log.Error("apply read receipt", "chat", e.Chat, "err", err)
			}
		}
	case *events.MarkChatAsRead:
		h.touch(ctx, true)
		if err := h.MarkChatAsRead(ctx, e); err != nil {
			h.log.Error("apply mark chat read", "chat", e.JID, "err", err)
		}
	case *events.Mute:
		h.touch(ctx, true)
		if err := h.Mute(ctx, e); err != nil {
			h.log.Error("apply mute", "chat", e.JID, "err", err)
		}
	case *events.AppStateSyncComplete:
		// The initial full sync stores address-book names without emitting Contact events.
		go h.SyncContacts(ctx)
	}
}

// SyncContacts copies names from whatsmeow's local contact store (address
// book, push and business names) into ours. Local read; nothing goes to WhatsApp.
func (h *Handler) SyncContacts(ctx context.Context) {
	all, err := h.src.Contacts(ctx)
	if err != nil {
		h.log.Warn("read contacts", "err", err)
		return
	}
	n := 0
	for jid, info := range all {
		if !info.Found {
			continue
		}
		full := info.FullName
		if full == "" {
			full = info.FirstName
		}
		pn := h.resolveUser(ctx, jid, types.EmptyJID)
		if err := h.st.UpsertContact(ctx, store.Contact{JID: pn.String(), FullName: full, PushName: info.PushName, BusinessName: info.BusinessName}); err == nil {
			n++
		}
	}
	h.log.Info("contacts synced", "count", n)
}

func isUserServer(s string) bool {
	return s == types.DefaultUserServer || s == types.HiddenUserServer
}

// resolveUser maps a LID to its phone-number JID when known (alt first, then the store).
func (h *Handler) resolveUser(ctx context.Context, jid, alt types.JID) types.JID {
	jid = jid.ToNonAD()
	if jid.Server != types.HiddenUserServer {
		return jid
	}
	if alt.Server == types.DefaultUserServer {
		return alt.ToNonAD()
	}
	if pn, ok := h.src.PNForLID(ctx, jid); ok {
		return pn
	}
	return jid
}

func (h *Handler) resolveChat(ctx context.Context, info *types.MessageInfo) types.JID {
	chat := info.Chat.ToNonAD()
	if chat.Server != types.HiddenUserServer {
		return chat
	}
	alt := info.SenderAlt
	if info.IsFromMe {
		alt = info.RecipientAlt
	}
	pn := h.resolveUser(ctx, chat, alt)
	if pn != chat {
		if _, done := h.merged.LoadOrStore(chat.String(), struct{}{}); !done {
			if err := h.st.MergeChat(ctx, chat.String(), pn.String()); err != nil {
				h.log.Error("merge LID chat", "lid", chat, "err", err)
				h.merged.Delete(chat.String())
			}
		}
	}
	return pn
}

// Message stores one live or history message, or applies an edit/revoke/reaction.
func (h *Handler) Message(ctx context.Context, e *events.Message) error {
	info := &e.Info
	if info.Chat.Server == types.BroadcastServer || info.Chat.Server == types.NewsletterServer {
		return nil // status updates and channels aren't chats
	}
	chat := h.resolveChat(ctx, info)
	var sender types.JID
	senderLID := ""
	if info.Sender.ToNonAD().Server == types.HiddenUserServer {
		senderLID = info.Sender.ToNonAD().String()
	}
	if info.IsFromMe && !h.src.OwnJID().IsEmpty() {
		sender = h.src.OwnJID()
	} else {
		sender = h.resolveUser(ctx, info.Sender, info.SenderAlt)
	}
	ts := info.Timestamp.UnixMilli()
	if info.PushName != "" && !info.IsFromMe && isUserServer(sender.Server) {
		_ = h.st.UpsertContact(ctx, store.Contact{JID: sender.String(), PushName: info.PushName})
	}

	m := e.Message
	if m == nil {
		return nil
	}
	if pm := m.GetProtocolMessage(); pm != nil {
		target := pm.GetKey().GetID()
		if target == "" {
			return nil
		}
		switch pm.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			return h.st.ApplyRevoke(ctx, chat.String(), target, ts)
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			return h.st.ApplyEdit(ctx, chat.String(), target, Extract(pm.GetEditedMessage()).Text, ts)
		}
		return nil
	}
	if r := m.GetReactionMessage(); r != nil {
		rts := r.GetSenderTimestampMS()
		if rts == 0 {
			rts = ts
		}
		return h.st.SetReaction(ctx, chat.String(), r.GetKey().GetID(), sender.String(), r.GetText(), rts)
	}
	c := Extract(m)
	if c.Type == "" {
		return nil
	}
	isGroup := chat.Server == types.GroupServer
	err := h.st.UpsertMessage(ctx, store.Message{
		ChatJID: chat.String(), ID: info.ID, SenderJID: sender.String(), SenderLID: senderLID,
		FromMe: info.IsFromMe, TS: ts, Type: c.Type, Text: c.Text, QuotedID: c.QuotedID, Media: c.Media,
	}, isGroup)
	if err == nil && isGroup {
		h.maybeLookupGroup(ctx, chat)
	}
	return err
}

// Receipt marks messages read up to the ones the owner read elsewhere.
func (h *Handler) Receipt(ctx context.Context, e *events.Receipt) error {
	info := types.MessageInfo{MessageSource: e.MessageSource}
	chat := h.resolveChat(ctx, &info)
	return h.st.SetReadByIDs(ctx, chat.String(), e.MessageIDs, e.Timestamp.UnixMilli(), h.now().UnixMilli())
}

// MarkChatAsRead applies the phone's "mark as read/unread" on a chat.
func (h *Handler) MarkChatAsRead(ctx context.Context, e *events.MarkChatAsRead) error {
	info := types.MessageInfo{MessageSource: types.MessageSource{Chat: e.JID}}
	chat := h.resolveChat(ctx, &info).String()
	if a := e.Action; a != nil && !a.GetRead() {
		return h.st.SetMarkedUnread(ctx, chat, true)
	}
	upTo := int64(0)
	if e.Action != nil {
		upTo = e.Action.GetMessageRange().GetLastMessageTimestamp() * 1000
	}
	if upTo > 0 {
		return h.st.SetReadByIDs(ctx, chat, nil, upTo, h.now().UnixMilli())
	}
	return h.st.SetChatRead(ctx, chat, "", h.now().UnixMilli())
}

// mutedUntil converts WhatsApp's mute end (seconds; -1 or a far-future value
// = forever) to epoch ms, with -1 meaning forever and 0 not muted.
func mutedUntil(seconds int64, nowMs int64) int64 {
	if seconds < 0 || seconds > 4102444800 { // before 1970 or after 2100
		return -1
	}
	if ms := seconds * 1000; ms > nowMs {
		return ms
	}
	return 0
}

// Mute applies the phone's mute or unmute of a chat.
func (h *Handler) Mute(ctx context.Context, e *events.Mute) error {
	info := types.MessageInfo{MessageSource: types.MessageSource{Chat: e.JID}}
	chat := h.resolveChat(ctx, &info)
	until := int64(0)
	if a := e.Action; a != nil && a.GetMuted() {
		until = mutedUntil(a.GetMuteEndTimestamp(), h.now().UnixMilli())
	}
	return h.st.SetMuted(ctx, chat.String(), chat.Server == types.GroupServer, until)
}

// HistorySync stores the conversations the phone sends after pairing (and later top-ups).
func (h *Handler) HistorySync(ctx context.Context, e *events.HistorySync) {
	d := e.Data
	for _, p := range d.GetPushnames() {
		if jid, err := types.ParseJID(p.GetID()); err == nil {
			jid = h.resolveUser(ctx, jid, types.EmptyJID)
			_ = h.st.UpsertContact(ctx, store.Contact{JID: jid.String(), PushName: p.GetPushname()})
		}
	}
	stored := 0
	for _, conv := range d.GetConversations() {
		chat, err := types.ParseJID(conv.GetID())
		if err != nil {
			continue
		}
		for _, hm := range conv.GetMessages() {
			evt, err := h.src.ParseWebMessage(chat, hm.GetMessage())
			if err != nil {
				continue
			}
			if err := h.Message(ctx, evt); err != nil {
				h.log.Error("store history message", "chat", chat, "err", err)
				continue
			}
			stored++
		}
		var fake types.MessageInfo
		fake.Chat = chat
		resolved := h.resolveChat(ctx, &fake)
		if end := conv.GetMuteEndTime(); end > 0 {
			if until := mutedUntil(int64(end), h.now().UnixMilli()); until != 0 {
				_ = h.st.SetMuted(ctx, resolved.String(), resolved.Server == types.GroupServer, until)
			}
		}
		// The phone's own unread count (absent = 0), so a fresh pairing isn't all unread.
		if err := h.st.ApplyHistoryUnread(ctx, resolved.String(), int(conv.GetUnreadCount()), conv.GetMarkedAsUnread(), h.now().UnixMilli()); err != nil {
			h.log.Error("history unread state", "chat", chat, "err", err)
		}
		name := conv.GetName()
		if name == "" {
			name = conv.GetDisplayName()
		}
		if name != "" {
			_ = h.st.SetChatName(ctx, resolved.String(), name, resolved.Server == types.GroupServer)
		}
	}
	h.log.Info("history sync", "type", d.GetSyncType().String(), "conversations", len(d.GetConversations()),
		"messages", stored, "progress", d.GetProgress())
}

// maybeLookupGroup queues a one-time group-name lookup for a group with no known name.
func (h *Handler) maybeLookupGroup(ctx context.Context, group types.JID) {
	if _, asked := h.groupAsked.LoadOrStore(group.String(), struct{}{}); asked {
		return
	}
	if name, err := h.st.ChatName(ctx, group.String()); err != nil || name != "" {
		return
	}
	select {
	case h.groupQueue <- group:
	default:
		h.groupAsked.Delete(group.String())
	}
}

// RunGroupLookups resolves queued group names one at a time until ctx ends.
func (h *Handler) RunGroupLookups(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case g := <-h.groupQueue:
			name, err := h.src.GroupName(ctx, g)
			if err != nil {
				h.log.Warn("group name lookup", "group", g, "err", err)
				select { // back off, e.g. after a rate-limit
				case <-time.After(time.Minute):
				case <-ctx.Done():
					return
				}
				continue
			}
			_ = h.st.SetChatName(ctx, g.String(), name, true)
		}
	}
}
