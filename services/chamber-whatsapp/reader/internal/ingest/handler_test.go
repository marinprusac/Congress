package ingest

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"congress/wa-reader/internal/store"
)

type fakeSource struct {
	own   types.JID
	lids  map[types.JID]types.JID
	parse func(types.JID, *waWeb.WebMessageInfo) (*events.Message, error)
}

func (f *fakeSource) OwnJID() types.JID { return f.own }
func (f *fakeSource) PNForLID(_ context.Context, lid types.JID) (types.JID, bool) {
	pn, ok := f.lids[lid]
	return pn, ok
}
func (f *fakeSource) GroupName(context.Context, types.JID) (string, error) { return "", errors.New("offline") }
func (f *fakeSource) ParseWebMessage(chat types.JID, m *waWeb.WebMessageInfo) (*events.Message, error) {
	return f.parse(chat, m)
}

var (
	ctx   = context.Background()
	me    = types.NewJID("385910000000", types.DefaultUserServer)
	ana   = types.NewJID("385911111111", types.DefaultUserServer)
	anaL  = types.NewJID("99887766", types.HiddenUserServer)
	group = types.NewJID("12345", types.GroupServer)
)

func setup(t *testing.T) (*Handler, *store.Store, *fakeSource) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "m.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	src := &fakeSource{own: me, lids: map[types.JID]types.JID{}}
	return NewHandler(st, src, slog.New(slog.NewTextHandler(io.Discard, nil)), NewStatus("connecting")), st, src
}

func event(chat, sender types.JID, id string, at int64, m *waE2E.Message) *events.Message {
	e := &events.Message{Message: m}
	e.Info.Chat, e.Info.Sender, e.Info.ID = chat, sender, id
	e.Info.IsFromMe = sender == me
	e.Info.IsGroup = chat.Server == types.GroupServer
	e.Info.Timestamp = time.UnixMilli(at)
	return e
}

func text(s string) *waE2E.Message { return &waE2E.Message{Conversation: proto.String(s)} }

func messages(t *testing.T, st *store.Store, chat types.JID) []store.MessageRow {
	t.Helper()
	rows, err := st.Messages(ctx, chat.String(), 50, "")
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestTextEditRevokeReaction(t *testing.T) {
	h, st, _ := setup(t)
	h.Handle(event(ana, ana, "m1", 1000, text("hello")))
	h.Handle(event(ana, me, "m2", 2000, &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
		Text: proto.String("hi back"), ContextInfo: &waE2E.ContextInfo{StanzaID: proto.String("m1")}}}))
	h.Handle(event(ana, ana, "e1", 3000, &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(), Key: &waCommon.MessageKey{ID: proto.String("m1")},
		EditedMessage: text("hello there")}}))
	h.Handle(event(ana, ana, "r1", 4000, &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{
		Key: &waCommon.MessageKey{ID: proto.String("m2")}, Text: proto.String("👍"), SenderTimestampMS: proto.Int64(4000)}}))

	rows := messages(t, st, ana)
	if len(rows) != 2 {
		t.Fatalf("want 2 messages (edit/reaction aren't rows), got %+v", rows)
	}
	reply, orig := rows[0], rows[1]
	if orig.Text != "hello there" || orig.EditedAt == nil {
		t.Fatalf("edit not applied: %+v", orig)
	}
	if !reply.FromMe || reply.SenderJID != me.String() || reply.Quoted == nil || reply.Quoted.Text != "hello there" {
		t.Fatalf("reply: %+v", reply)
	}
	if len(reply.Reactions) != 1 || reply.Reactions[0].SenderJID != ana.String() {
		t.Fatalf("reaction: %+v", reply.Reactions)
	}

	h.Handle(event(ana, ana, "d1", 5000, &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type: waE2E.ProtocolMessage_REVOKE.Enum(), Key: &waCommon.MessageKey{ID: proto.String("m1")}}}))
	if rows := messages(t, st, ana); rows[1].RevokedAt == nil || rows[1].Text != "" {
		t.Fatalf("revoke: %+v", rows[1])
	}
}

func TestLIDSenderAndChatResolveToPhoneNumber(t *testing.T) {
	h, st, src := setup(t)
	// Before the mapping is known the chat is stored under the LID...
	h.Handle(event(anaL, anaL, "m1", 1000, text("early")))
	// ...and merged into the phone-number chat once it is.
	src.lids[anaL] = ana
	e := event(anaL, anaL, "m2", 2000, text("later"))
	e.Info.PushName = "Ana"
	h.Handle(e)

	chats, _ := st.ListChats(ctx, 10, "")
	if len(chats) != 1 || chats[0].JID != ana.String() || chats[0].Name != "Ana" {
		t.Fatalf("%+v", chats)
	}
	rows := messages(t, st, ana)
	if len(rows) != 2 || rows[0].SenderJID != ana.String() {
		t.Fatalf("%+v", rows)
	}
}

func TestSenderAltUsedWithoutStoreLookup(t *testing.T) {
	h, st, _ := setup(t)
	e := event(group, anaL, "g1", 1000, text("in group"))
	e.Info.SenderAlt = ana
	h.Handle(e)
	rows := messages(t, st, group)
	if len(rows) != 1 || rows[0].SenderJID != ana.String() {
		t.Fatalf("%+v", rows)
	}
}

func TestMediaMetadataOnlyAndSkips(t *testing.T) {
	h, st, _ := setup(t)
	h.Handle(event(ana, ana, "img", 1000, &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
		Caption: proto.String("look"), Mimetype: proto.String("image/jpeg"), FileLength: proto.Uint64(2048),
		DirectPath: proto.String("/v/t62/x"), MediaKey: []byte{1, 2}, FileSHA256: []byte{3}, FileEncSHA256: []byte{4},
		Width: proto.Uint32(640), Height: proto.Uint32(480)}}))
	h.Handle(event(ana, ana, "voice", 1100, &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
		PTT: proto.Bool(true), Seconds: proto.Uint32(7), Mimetype: proto.String("audio/ogg"), DirectPath: proto.String("/a"), MediaKey: []byte{9}}}))
	// Plumbing only: nothing to show.
	h.Handle(event(ana, ana, "skd", 1200, &waE2E.Message{SenderKeyDistributionMessage: &waE2E.SenderKeyDistributionMessage{}}))
	// Status updates aren't chats.
	h.Handle(event(types.StatusBroadcastJID, ana, "st", 1300, text("my status")))

	rows := messages(t, st, ana)
	if len(rows) != 2 {
		t.Fatalf("%+v", rows)
	}
	if rows[0].Type != "voice" || rows[0].Media.Seconds != 7 {
		t.Fatalf("%+v", rows[0])
	}
	if rows[1].Type != "image" || rows[1].Text != "look" || rows[1].Media.Width != 640 {
		t.Fatalf("%+v", rows[1])
	}
	media, _, err := st.MediaFor(ctx, ana.String(), "img")
	if err != nil || media == nil || media.DirectPath != "/v/t62/x" || media.Size != 2048 {
		t.Fatalf("%+v %v", media, err)
	}
	if chats, _ := st.ListChats(ctx, 10, ""); len(chats) != 1 {
		t.Fatalf("status broadcast stored as a chat: %+v", chats)
	}
}

func TestUnknownMessageKindIsKeptAsUnsupported(t *testing.T) {
	c := Extract(&waE2E.Message{EventMessage: &waE2E.EventMessage{Name: proto.String("Party")}})
	if c.Type != "unsupported" {
		t.Fatalf("%+v", c)
	}
	if c := Extract(&waE2E.Message{MessageContextInfo: &waE2E.MessageContextInfo{}}); c.Type != "" {
		t.Fatalf("%+v", c)
	}
}

func TestHistorySyncIsIdempotentAndNamesChats(t *testing.T) {
	h, st, src := setup(t)
	src.parse = func(chat types.JID, w *waWeb.WebMessageInfo) (*events.Message, error) {
		sender := chat
		if w.GetKey().GetFromMe() {
			sender = me
		}
		return event(chat, sender, w.GetKey().GetID(), int64(w.GetMessageTimestamp())*1000, w.GetMessage()), nil
	}
	hs := &events.HistorySync{Data: &waHistorySync.HistorySync{
		SyncType:  waHistorySync.HistorySync_INITIAL_BOOTSTRAP.Enum(),
		Pushnames: []*waHistorySync.Pushname{{ID: proto.String(ana.String()), Pushname: proto.String("Ana")}},
		Conversations: []*waHistorySync.Conversation{
			{ID: proto.String(group.String()), Name: proto.String("Family"), Messages: []*waHistorySync.HistorySyncMsg{
				{Message: &waWeb.WebMessageInfo{Key: &waCommon.MessageKey{ID: proto.String("h1"), FromMe: proto.Bool(true)},
					MessageTimestamp: proto.Uint64(100), Message: text("old news")}},
			}},
			{ID: proto.String(ana.String()), Messages: []*waHistorySync.HistorySyncMsg{
				{Message: &waWeb.WebMessageInfo{Key: &waCommon.MessageKey{ID: proto.String("h2")},
					MessageTimestamp: proto.Uint64(200), Message: text("hey")}},
			}},
		},
	}}
	h.Handle(hs)
	h.Handle(hs)
	chats, _ := st.ListChats(ctx, 10, "")
	if len(chats) != 2 || chats[0].Name != "Ana" || chats[1].Name != "Family" || !chats[1].IsGroup {
		t.Fatalf("%+v", chats)
	}
	if rows := messages(t, st, group); len(rows) != 1 || rows[0].TS != 100_000 {
		t.Fatalf("%+v", rows)
	}
	if h.Status.Snapshot().LastPhoneAt == 0 {
		t.Fatal("history sync should count as a sign of the phone")
	}
}

func TestPhoneLivenessOnlyFromOwnActivity(t *testing.T) {
	h, _, _ := setup(t)
	h.Handle(event(ana, ana, "m1", 1000, text("from someone else")))
	if s := h.Status.Snapshot(); s.LastEventAt == 0 || s.LastPhoneAt != 0 {
		t.Fatalf("%+v", s)
	}
	h.Handle(event(ana, me, "m2", 2000, text("from my phone")))
	if s := h.Status.Snapshot(); s.LastPhoneAt == 0 {
		t.Fatalf("%+v", s)
	}
}
