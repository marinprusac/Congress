package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "m.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

var ctx = context.Background()

func msg(chat, id string, ts int64, text string) Message {
	return Message{ChatJID: chat, ID: id, SenderJID: chat, TS: ts, Type: "text", Text: text}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestFileIsPrivateAndReopenIsIdempotent(t *testing.T) {
	p := filepath.Join(t.TempDir(), "m.sqlite3")
	s, err := Open(p)
	must(t, err)
	s.Close()
	s, err = Open(p)
	must(t, err)
	defer s.Close()
	st, err := os.Stat(p)
	must(t, err)
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", st.Mode().Perm())
	}
}

func TestUpsertIsIdempotentAndOrdersChats(t *testing.T) {
	s := open(t)
	must(t, s.UpsertMessage(ctx, msg("a@s.whatsapp.net", "1", 100, "hi"), false))
	must(t, s.UpsertMessage(ctx, msg("a@s.whatsapp.net", "1", 100, "hi"), false))
	must(t, s.UpsertMessage(ctx, msg("b@s.whatsapp.net", "2", 200, "later"), false))
	chats, err := s.ListChats(ctx, 10, "")
	must(t, err)
	if len(chats) != 2 || chats[0].JID != "b@s.whatsapp.net" || chats[0].LastText != "later" {
		t.Fatalf("%+v", chats)
	}
	msgs, err := s.Messages(ctx, "a@s.whatsapp.net", 10, "")
	must(t, err)
	if len(msgs) != 1 {
		t.Fatalf("%d messages", len(msgs))
	}
}

func TestEditBeforeOriginalKeepsEditedText(t *testing.T) {
	s := open(t)
	c := "a@s.whatsapp.net"
	must(t, s.ApplyEdit(ctx, c, "1", "fixed", 500))
	must(t, s.UpsertMessage(ctx, msg(c, "1", 100, "typo"), false))
	msgs, _ := s.Messages(ctx, c, 10, "")
	if len(msgs) != 1 || msgs[0].Text != "fixed" || msgs[0].EditedAt == nil || msgs[0].TS != 100 || msgs[0].Type != "text" {
		t.Fatalf("%+v", msgs)
	}
}

func TestEditKeepsHistoryAndSearchFollows(t *testing.T) {
	s := open(t)
	c := "a@s.whatsapp.net"
	must(t, s.UpsertMessage(ctx, msg(c, "1", 100, "meet at the station"), false))
	must(t, s.ApplyEdit(ctx, c, "1", "meet at the harbour", 200))
	var n int
	must(t, s.db.QueryRow(`SELECT count(*) FROM message_edits`).Scan(&n))
	if n != 1 {
		t.Fatalf("%d edits", n)
	}
	if r, _ := s.SearchMessages(ctx, "station", "", 10); len(r) != 0 {
		t.Fatalf("stale fts: %+v", r)
	}
	if r, _ := s.SearchMessages(ctx, "harb", "", 10); len(r) != 1 {
		t.Fatalf("prefix search: %+v", r)
	}
}

func TestRevokeClearsContentAndWins(t *testing.T) {
	s := open(t)
	c := "a@s.whatsapp.net"
	m := msg(c, "1", 100, "secret")
	m.Type = "image"
	m.Media = &Media{Mimetype: "image/jpeg", Size: 10, DirectPath: "/x", Key: []byte{1}}
	must(t, s.UpsertMessage(ctx, m, false))
	must(t, s.SetReaction(ctx, c, "1", "b@s.whatsapp.net", "👍", 110))
	must(t, s.ApplyRevoke(ctx, c, "1", 120))
	// History sync replays the original afterwards.
	must(t, s.UpsertMessage(ctx, m, false))
	msgs, _ := s.Messages(ctx, c, 10, "")
	if msgs[0].RevokedAt == nil || msgs[0].Text != "" || msgs[0].Media != nil || len(msgs[0].Reactions) != 0 {
		t.Fatalf("%+v", msgs[0])
	}
	if media, _, _ := s.MediaFor(ctx, c, "1"); media != nil {
		t.Fatal("media still downloadable")
	}
}

func TestReactionsReplaceAndRemove(t *testing.T) {
	s := open(t)
	c := "g@g.us"
	must(t, s.UpsertMessage(ctx, msg(c, "1", 100, "x"), true))
	must(t, s.SetReaction(ctx, c, "1", "b@s.whatsapp.net", "👍", 110))
	must(t, s.SetReaction(ctx, c, "1", "b@s.whatsapp.net", "❤️", 120))
	must(t, s.SetReaction(ctx, c, "1", "b@s.whatsapp.net", "😮", 115)) // older, ignored
	must(t, s.SetReaction(ctx, c, "1", "d@s.whatsapp.net", "😂", 130))
	msgs, _ := s.Messages(ctx, c, 10, "")
	if len(msgs[0].Reactions) != 2 || msgs[0].Reactions[0].Emoji != "❤️" {
		t.Fatalf("%+v", msgs[0].Reactions)
	}
	must(t, s.SetReaction(ctx, c, "1", "d@s.whatsapp.net", "", 140))
	msgs, _ = s.Messages(ctx, c, 10, "")
	if len(msgs[0].Reactions) != 1 {
		t.Fatalf("%+v", msgs[0].Reactions)
	}
}

func TestQuotedAndNames(t *testing.T) {
	s := open(t)
	c := "a@s.whatsapp.net"
	must(t, s.UpsertContact(ctx, Contact{JID: c, PushName: "Ana"}))
	must(t, s.UpsertContact(ctx, Contact{JID: c, FullName: "Ana Horvat"}))
	must(t, s.UpsertMessage(ctx, msg(c, "1", 100, "question?"), false))
	reply := msg(c, "2", 200, "answer")
	reply.QuotedID = "1"
	must(t, s.UpsertMessage(ctx, reply, false))
	msgs, _ := s.Messages(ctx, c, 10, "")
	if msgs[0].Quoted == nil || msgs[0].Quoted.Text != "question?" || msgs[0].SenderName != "Ana Horvat" {
		t.Fatalf("%+v", msgs[0])
	}
	chats, _ := s.ListChats(ctx, 10, "")
	if chats[0].Name != "Ana Horvat" {
		t.Fatalf("%+v", chats[0])
	}
}

func TestPagingWithEqualTimestamps(t *testing.T) {
	s := open(t)
	c := "a@s.whatsapp.net"
	for _, id := range []string{"a", "b", "c", "d", "e"} {
		must(t, s.UpsertMessage(ctx, msg(c, id, 100, id), false))
	}
	seen := map[string]bool{}
	cursor := ""
	for i := 0; i < 5; i++ {
		page, err := s.Messages(ctx, c, 2, cursor)
		must(t, err)
		if len(page) == 0 {
			break
		}
		for _, m := range page {
			if seen[m.ID] {
				t.Fatalf("duplicate %s", m.ID)
			}
			seen[m.ID] = true
		}
		last := page[len(page)-1]
		cursor = Cursor(last.TS, last.ID)
	}
	if len(seen) != 5 {
		t.Fatalf("saw %d", len(seen))
	}
}

func TestMergeChatMovesLIDChat(t *testing.T) {
	s := open(t)
	lid, pn := "123@lid", "385911111111@s.whatsapp.net"
	must(t, s.UpsertMessage(ctx, msg(lid, "1", 100, "from lid"), false))
	must(t, s.UpsertMessage(ctx, msg(pn, "2", 200, "from pn"), false))
	must(t, s.UpsertMessage(ctx, msg(lid, "2", 200, "dupe"), false))
	must(t, s.MergeChat(ctx, lid, pn))
	chats, _ := s.ListChats(ctx, 10, "")
	if len(chats) != 1 || chats[0].JID != pn {
		t.Fatalf("%+v", chats)
	}
	msgs, _ := s.Messages(ctx, pn, 10, "")
	if len(msgs) != 2 {
		t.Fatalf("%+v", msgs)
	}
}

func TestDMNamePrefersContactAndIgnoresMaskedNumbers(t *testing.T) {
	s := open(t)
	dm, grp := "385911111106@s.whatsapp.net", "g@g.us"
	must(t, s.UpsertMessage(ctx, msg(dm, "1", 100, "x"), false))
	must(t, s.UpsertMessage(ctx, msg(grp, "2", 200, "y"), true))
	must(t, s.SetChatName(ctx, dm, "+385∙∙∙∙∙∙∙06", false)) // refused
	must(t, s.SetChatName(ctx, dm, "Old history name", false))
	must(t, s.UpsertContact(ctx, Contact{JID: dm, FullName: "Petra", PushName: "+385∙∙∙∙∙∙∙06"}))
	must(t, s.SetChatName(ctx, grp, "Family", true))
	must(t, s.UpsertContact(ctx, Contact{JID: grp, PushName: "not a group name"}))
	names := map[string]string{}
	chats, _ := s.ListChats(ctx, 10, "")
	for _, c := range chats {
		names[c.JID] = c.Name
	}
	if names[dm] != "Petra" || names[grp] != "Family" {
		t.Fatalf("%v", names)
	}
	var push string
	must(t, s.db.QueryRow(`SELECT push_name FROM contacts WHERE jid = ?`, dm).Scan(&push))
	if push != "" {
		t.Fatalf("masked push name stored: %q", push)
	}
}

func TestMigrationClearsStoredMaskedNames(t *testing.T) {
	p := filepath.Join(t.TempDir(), "m.sqlite3")
	s, err := Open(p)
	must(t, err)
	_, err = s.db.Exec(`INSERT INTO chats (jid, name, last_message_at) VALUES ('a@s.whatsapp.net', '+385∙∙∙∙∙∙∙06', 1), ('g@g.us', 'Family', 1);
		INSERT INTO contacts (jid, push_name, updated_at) VALUES ('a@s.whatsapp.net', '+1∙∙∙∙80', 0);
		PRAGMA user_version = 1;`)
	must(t, err)
	s.Close()
	s, err = Open(p)
	must(t, err)
	defer s.Close()
	var chatName, grpName, push string
	must(t, s.db.QueryRow(`SELECT name FROM chats WHERE jid = 'a@s.whatsapp.net'`).Scan(&chatName))
	must(t, s.db.QueryRow(`SELECT name FROM chats WHERE jid = 'g@g.us'`).Scan(&grpName))
	must(t, s.db.QueryRow(`SELECT push_name FROM contacts`).Scan(&push))
	if chatName != "" || push != "" || grpName != "Family" {
		t.Fatalf("%q %q %q", chatName, push, grpName)
	}
}

func TestSearchChatsEscapesLike(t *testing.T) {
	s := open(t)
	must(t, s.UpsertMessage(ctx, msg("g@g.us", "1", 100, "x"), true))
	must(t, s.SetChatName(ctx, "g@g.us", "100% Family", true))
	if r, _ := s.SearchChats(ctx, "100%", 10); len(r) != 1 {
		t.Fatalf("%+v", r)
	}
	if r, _ := s.SearchChats(ctx, "_", 10); len(r) != 0 {
		t.Fatalf("underscore matched: %+v", r)
	}
}
