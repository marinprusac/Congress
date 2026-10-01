package store

import (
	"errors"
	"path/filepath"
	"strconv"
	"testing"
)

func unreadOf(t *testing.T, s *Store, chat string) (int, bool) {
	t.Helper()
	c, err := s.Chat(ctx, chat)
	must(t, err)
	return c.UnreadCount, c.MarkedUnread
}

// rollbackUnread undoes migration 003 and sets the schema version to v.
func rollbackUnread(t *testing.T, s *Store, v int) {
	t.Helper()
	_, err := s.db.Exec(`DROP INDEX messages_unread; ALTER TABLE messages DROP COLUMN read_at;
		ALTER TABLE chats DROP COLUMN marked_unread; ALTER TABLE chats DROP COLUMN muted_until; PRAGMA user_version = ` + strconv.Itoa(v))
	must(t, err)
}

func TestMigrationTreatsExistingMessagesAsRead(t *testing.T) {
	p := filepath.Join(t.TempDir(), "m.sqlite3")
	s, err := Open(p)
	must(t, err)
	rollbackUnread(t, s, 2)
	// A message stored before read tracking existed.
	_, err = s.db.Exec(`INSERT INTO chats (jid, last_message_at) VALUES ('a', 1);
		INSERT INTO messages (chat_jid, id, sender_jid, ts, type, text) VALUES ('a', 'old', 'a', 1, 'text', 'hi');`)
	must(t, err)
	s.Close()
	s, err = Open(p)
	must(t, err)
	defer s.Close()
	must(t, s.UpsertMessage(ctx, msg("a", "old", 1, "hi"), false)) // history re-delivery keeps it read
	must(t, s.UpsertMessage(ctx, msg("a", "new", 2, "yo"), false))
	if n, _ := unreadOf(t, s, "a"); n != 1 {
		t.Fatalf("unread = %d", n)
	}
}

func TestLocalMarkReadUpToAMessage(t *testing.T) {
	s := open(t)
	for i, id := range []string{"a1", "a2", "a3"} {
		must(t, s.UpsertMessage(ctx, msg("a", id, int64(i+1), id), false))
	}
	must(t, s.UpsertMessage(ctx, msg("b", "b1", 5, "other"), false))
	must(t, s.SetMarkedUnread(ctx, "a", true))
	must(t, s.SetChatRead(ctx, "a", "a2", 100))
	if n, marked := unreadOf(t, s, "a"); n != 1 || marked {
		t.Fatalf("unread = %d marked = %v", n, marked)
	}
	if err := s.SetChatRead(ctx, "a", "nope", 100); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	must(t, s.SetChatRead(ctx, "a", "", 100))
	if n, _ := unreadOf(t, s, "a"); n != 0 {
		t.Fatalf("unread = %d", n)
	}
	if n, _ := unreadOf(t, s, "b"); n != 1 {
		t.Fatalf("other chat touched: %d", n)
	}
}

func TestUnreadListingAndTotals(t *testing.T) {
	s := open(t)
	must(t, s.UpsertMessage(ctx, msg("a", "a1", 1, "one"), false))
	must(t, s.UpsertMessage(ctx, msg("a", "a2", 2, "two"), false))
	must(t, s.UpsertMessage(ctx, msg("b", "b1", 3, "read"), false))
	must(t, s.SetChatRead(ctx, "b", "", 10))
	must(t, s.UpsertMessage(ctx, msg("c", "c1", 4, "flagged"), false))
	must(t, s.SetChatRead(ctx, "c", "", 10))
	must(t, s.SetMarkedUnread(ctx, "c", true))
	must(t, s.ApplyRevoke(ctx, "d", "gone", 5)) // a placeholder is never unread

	chats, err := s.UnreadChats(ctx, 10, "")
	must(t, err)
	if len(chats) != 2 || chats[0].JID != "c" || !chats[0].MarkedUnread || chats[1].JID != "a" || chats[1].UnreadCount != 2 {
		t.Fatalf("%+v", chats)
	}
	msgs, err := s.UnreadMessages(ctx, "a", 1, "")
	must(t, err)
	if len(msgs) != 1 || msgs[0].ID != "a2" || !msgs[0].Unread {
		t.Fatalf("%+v", msgs)
	}
	nm, nc, err := s.UnreadTotals(ctx)
	must(t, err)
	if nm != 2 || nc != 2 {
		t.Fatalf("totals %d %d", nm, nc)
	}
}

func TestOwnMessagesAreNeverUnread(t *testing.T) {
	s := open(t)
	m := msg("a", "m1", 1, "mine")
	m.FromMe = true
	must(t, s.UpsertMessage(ctx, m, false))
	if n, _ := unreadOf(t, s, "a"); n != 0 {
		t.Fatalf("unread = %d", n)
	}
}
