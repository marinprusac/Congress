package ingest

import (
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waSyncAction"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func unread(t *testing.T, h *Handler, chat types.JID) (int, bool) {
	t.Helper()
	c, err := h.st.Chat(ctx, chat.String())
	if err != nil || c == nil {
		t.Fatalf("chat %s: %v", chat, err)
	}
	return c.UnreadCount, c.MarkedUnread
}

func TestIncomingIsUnreadAndOwnReplyReadsIt(t *testing.T) {
	h, _, _ := setup(t)
	h.Handle(event(ana, ana, "a1", 1000, text("one")))
	h.Handle(event(ana, ana, "a2", 2000, text("two")))
	if n, _ := unread(t, h, ana); n != 2 {
		t.Fatalf("unread = %d", n)
	}
	h.Handle(event(ana, me, "m1", 3000, text("reply")))
	h.Handle(event(ana, ana, "a3", 4000, text("three")))
	if n, _ := unread(t, h, ana); n != 1 {
		t.Fatalf("after reply unread = %d", n)
	}
}

func TestOwnReadReceiptReadsUpToThatMessage(t *testing.T) {
	h, st, _ := setup(t)
	for i, id := range []string{"a1", "a2", "a3"} {
		h.Handle(event(ana, ana, id, int64(1000*(i+1)), text(id)))
	}
	// Someone else's receipt (their read of our message) changes nothing.
	h.Handle(&events.Receipt{MessageSource: types.MessageSource{Chat: ana, Sender: ana}, MessageIDs: []string{"a3"}, Type: types.ReceiptTypeRead})
	// Delivery receipts from our own devices don't mean read either.
	h.Handle(&events.Receipt{MessageSource: types.MessageSource{Chat: ana, Sender: me, IsFromMe: true}, MessageIDs: []string{"a3"}, Type: types.ReceiptTypeDelivered})
	if n, _ := unread(t, h, ana); n != 3 {
		t.Fatalf("unread = %d", n)
	}
	h.Handle(&events.Receipt{MessageSource: types.MessageSource{Chat: ana, Sender: me, IsFromMe: true},
		MessageIDs: []string{"a2"}, Type: types.ReceiptTypeReadSelf, Timestamp: time.UnixMilli(9000)})
	if n, _ := unread(t, h, ana); n != 1 {
		t.Fatalf("after receipt unread = %d", n)
	}
	rows := messages(t, st, ana)
	if !rows[0].Unread || rows[1].Unread || rows[2].Unread {
		t.Fatalf("%+v", rows)
	}
}

func TestReceiptInLIDChatAppliesToPhoneChat(t *testing.T) {
	h, _, src := setup(t)
	src.lids[anaL] = ana
	h.Handle(event(ana, ana, "a1", 1000, text("hi")))
	h.Handle(&events.Receipt{MessageSource: types.MessageSource{Chat: anaL, Sender: me, IsFromMe: true},
		MessageIDs: []string{"a1"}, Type: types.ReceiptTypeRead})
	if n, _ := unread(t, h, ana); n != 0 {
		t.Fatalf("unread = %d", n)
	}
}

func TestMarkChatAsReadAndUnread(t *testing.T) {
	h, _, _ := setup(t)
	h.Handle(event(ana, ana, "a1", 1000, text("one")))
	h.Handle(event(ana, ana, "a2", 5000, text("two")))
	h.Handle(&events.MarkChatAsRead{JID: ana, Action: &waSyncAction.MarkChatAsReadAction{Read: proto.Bool(false)}})
	if n, marked := unread(t, h, ana); n != 2 || !marked {
		t.Fatalf("unread = %d marked = %v", n, marked)
	}
	// Read up to the range's last message (seconds): a2 arrived later and stays unread.
	h.Handle(&events.MarkChatAsRead{JID: ana, Action: &waSyncAction.MarkChatAsReadAction{Read: proto.Bool(true),
		MessageRange: &waSyncAction.SyncActionMessageRange{LastMessageTimestamp: proto.Int64(2)}}})
	if n, marked := unread(t, h, ana); n != 1 || marked {
		t.Fatalf("unread = %d marked = %v", n, marked)
	}
	h.Handle(&events.MarkChatAsRead{JID: ana, Action: &waSyncAction.MarkChatAsReadAction{Read: proto.Bool(true)}})
	if n, _ := unread(t, h, ana); n != 0 {
		t.Fatalf("unread = %d", n)
	}
}

func TestHistorySyncKeepsThePhonesUnreadCount(t *testing.T) {
	h, _, src := setup(t)
	src.parse = func(chat types.JID, w *waWeb.WebMessageInfo) (*events.Message, error) {
		return event(chat, chat, w.GetKey().GetID(), int64(w.GetMessageTimestamp())*1000, w.GetMessage()), nil
	}
	msg := func(id string, ts uint64) *waHistorySync.HistorySyncMsg {
		return &waHistorySync.HistorySyncMsg{Message: &waWeb.WebMessageInfo{
			Key: &waCommon.MessageKey{ID: proto.String(id)}, MessageTimestamp: proto.Uint64(ts), Message: text(id)}}
	}
	other := types.NewJID("385912222222", types.DefaultUserServer)
	h.Handle(&events.HistorySync{Data: &waHistorySync.HistorySync{
		SyncType: waHistorySync.HistorySync_INITIAL_BOOTSTRAP.Enum(),
		Conversations: []*waHistorySync.Conversation{
			{ID: proto.String(ana.String()), UnreadCount: proto.Uint32(2),
				Messages: []*waHistorySync.HistorySyncMsg{msg("a1", 1), msg("a2", 2), msg("a3", 3)}},
			{ID: proto.String(other.String()), MarkedAsUnread: proto.Bool(true),
				Messages: []*waHistorySync.HistorySyncMsg{msg("o1", 1)}},
		},
	}})
	if n, marked := unread(t, h, ana); n != 2 || marked {
		t.Fatalf("ana unread = %d marked = %v", n, marked)
	}
	rows := messages(t, h.st, ana)
	if !rows[0].Unread || !rows[1].Unread || rows[2].Unread {
		t.Fatalf("the newest two should be unread: %+v", rows)
	}
	if n, marked := unread(t, h, other); n != 0 || !marked {
		t.Fatalf("other unread = %d marked = %v", n, marked)
	}
}
