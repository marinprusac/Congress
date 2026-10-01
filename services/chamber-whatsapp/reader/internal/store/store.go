// Package store is wa-reader's own messages database (separate from
// whatsmeow's session store).
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	db *sql.DB
}

// Media is the metadata needed to show and later download an attachment.
type Media struct {
	Mimetype   string
	Size       int64
	Filename   string
	DirectPath string
	Key        []byte
	SHA256     []byte
	EncSHA256  []byte
	Width      int64
	Height     int64
	Seconds    int64
}

type Message struct {
	ChatJID   string
	ID        string
	SenderJID string
	SenderLID string
	FromMe    bool
	TS        int64 // unix ms
	Type      string
	Text      string
	QuotedID  string
	Media     *Media
}

// Open opens (creating if needed) the DB with 0600 permissions and migrates it.
func Open(path string) (*Store, error) {
	if _, err := Touch(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", DSN(path))
	if err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate %s: %w", path, err)
	}
	return s, nil
}

// Touch creates a DB file if missing and forces it to 0600. Reports whether it existed.
func Touch(path string) (bool, error) {
	_, statErr := os.Stat(path)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return false, err
	}
	f.Close()
	return statErr == nil, os.Chmod(path, 0o600)
}

// DSN is the modernc.org/sqlite connection string both DBs use.
func DSN(path string) string {
	return "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for i, name := range names {
		n := i + 1
		if n <= version {
			continue
		}
		body, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("%s: %w", name, err)
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", n)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func bumpChat(tx *sql.Tx, chat string, isGroup bool, ts int64) error {
	_, err := tx.Exec(`INSERT INTO chats (jid, is_group, last_message_at) VALUES (?, ?, ?)
		ON CONFLICT (jid) DO UPDATE SET last_message_at = max(chats.last_message_at, excluded.last_message_at),
		is_group = excluded.is_group OR chats.is_group`, chat, isGroup, ts)
	return err
}

// UpsertMessage stores a message idempotently. An edit or revoke that
// arrived first keeps its text; the original fills in everything else.
func (s *Store) UpsertMessage(ctx context.Context, m Message, isGroup bool) error {
	var md Media
	hasMedia := m.Media != nil
	if hasMedia {
		md = *m.Media
	}
	null := func(v any) any {
		if !hasMedia {
			return nil
		}
		return v
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		var readAt any // incoming messages arrive unread; read state is kept on conflict
		if m.FromMe {
			readAt = m.TS
		}
		_, err := tx.Exec(`INSERT INTO messages (chat_jid, id, sender_jid, sender_lid, from_me, ts, type, text, quoted_id,
				media_mimetype, media_size, media_filename, media_direct_path, media_key, media_sha256, media_enc_sha256,
				media_width, media_height, media_seconds, read_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (chat_jid, id) DO UPDATE SET
				sender_jid = excluded.sender_jid, sender_lid = excluded.sender_lid, from_me = excluded.from_me,
				ts = excluded.ts, type = excluded.type, quoted_id = excluded.quoted_id,
				text = CASE WHEN messages.edited_at IS NOT NULL OR messages.revoked_at IS NOT NULL THEN messages.text ELSE excluded.text END,
				media_mimetype = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_mimetype END,
				media_size = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_size END,
				media_filename = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_filename END,
				media_direct_path = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_direct_path END,
				media_key = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_key END,
				media_sha256 = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_sha256 END,
				media_enc_sha256 = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_enc_sha256 END,
				media_width = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_width END,
				media_height = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_height END,
				media_seconds = CASE WHEN messages.revoked_at IS NULL THEN excluded.media_seconds END`,
			m.ChatJID, m.ID, m.SenderJID, m.SenderLID, m.FromMe, m.TS, m.Type, m.Text, m.QuotedID,
			null(md.Mimetype), null(md.Size), null(md.Filename), null(md.DirectPath), null(md.Key), null(md.SHA256), null(md.EncSHA256),
			null(md.Width), null(md.Height), null(md.Seconds), readAt)
		if err != nil {
			return err
		}
		if m.FromMe { // replying means everything before was read
			if err := setChatRead(tx, m.ChatJID, m.TS, m.TS); err != nil {
				return err
			}
		}
		return bumpChat(tx, m.ChatJID, isGroup, m.TS)
	})
}

func ensurePlaceholder(tx *sql.Tx, chat, id string, ts int64) error {
	_, err := tx.Exec(`INSERT OR IGNORE INTO messages (chat_jid, id, ts, type) VALUES (?, ?, ?, 'placeholder')`, chat, id, ts)
	return err
}

// ApplyEdit replaces a message's text, keeping the previous text as history.
func (s *Store) ApplyEdit(ctx context.Context, chat, id, text string, at int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if err := ensurePlaceholder(tx, chat, id, at); err != nil {
			return err
		}
		var prev string
		var revoked sql.NullInt64
		if err := tx.QueryRow(`SELECT text, revoked_at FROM messages WHERE chat_jid = ? AND id = ?`, chat, id).Scan(&prev, &revoked); err != nil {
			return err
		}
		if revoked.Valid || prev == text {
			return nil
		}
		if _, err := tx.Exec(`INSERT INTO message_edits (chat_jid, message_id, previous_text, edited_at) VALUES (?, ?, ?, ?)`, chat, id, prev, at); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE messages SET text = ?, edited_at = max(coalesce(edited_at, 0), ?) WHERE chat_jid = ? AND id = ?`, text, at, chat, id)
		return err
	})
}

// ApplyRevoke marks a message deleted for everyone and drops its content,
// edit history and reactions, as WhatsApp itself does.
func (s *Store) ApplyRevoke(ctx context.Context, chat, id string, at int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if err := ensurePlaceholder(tx, chat, id, at); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE messages SET revoked_at = ?, text = '', media_mimetype = NULL, media_size = NULL,
			media_filename = NULL, media_direct_path = NULL, media_key = NULL, media_sha256 = NULL, media_enc_sha256 = NULL,
			media_width = NULL, media_height = NULL, media_seconds = NULL
			WHERE chat_jid = ? AND id = ?`, at, chat, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM message_edits WHERE chat_jid = ? AND message_id = ?`, chat, id); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM reactions WHERE chat_jid = ? AND message_id = ?`, chat, id)
		return err
	})
}

// SetReaction stores a sender's reaction; an empty emoji removes it.
func (s *Store) SetReaction(ctx context.Context, chat, messageID, sender, emoji string, ts int64) error {
	if emoji == "" {
		_, err := s.db.ExecContext(ctx, `DELETE FROM reactions WHERE chat_jid = ? AND message_id = ? AND sender_jid = ?`, chat, messageID, sender)
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO reactions (chat_jid, message_id, sender_jid, emoji, ts) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (chat_jid, message_id, sender_jid) DO UPDATE SET emoji = excluded.emoji, ts = excluded.ts
		WHERE excluded.ts >= reactions.ts`, chat, messageID, sender, emoji, ts)
	return err
}

// Incoming, real (not placeholder) messages without read state.
const unreadWhere = `from_me = 0 AND read_at IS NULL AND type != 'placeholder'`

// setChatRead marks a chat's incoming messages up to upTo (ms; 0 = all) read and
// clears its marked-unread flag.
func setChatRead(tx *sql.Tx, chat string, upTo, at int64) error {
	if _, err := tx.Exec(`UPDATE messages SET read_at = ? WHERE chat_jid = ? AND from_me = 0 AND read_at IS NULL
		AND (? = 0 OR ts <= ?)`, at, chat, upTo, upTo); err != nil {
		return err
	}
	_, err := tx.Exec(`UPDATE chats SET marked_unread = 0 WHERE jid = ?`, chat)
	return err
}

// SetChatRead updates local read state only (never WhatsApp): the chat's incoming
// messages up to and including upToID ("" = all) become read.
func (s *Store) SetChatRead(ctx context.Context, chat, upToID string, at int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		var upTo int64
		if upToID != "" {
			err := tx.QueryRow(`SELECT ts FROM messages WHERE chat_jid = ? AND id = ?`, chat, upToID).Scan(&upTo)
			if err == sql.ErrNoRows {
				return ErrNotFound
			}
			if err != nil {
				return err
			}
		}
		return setChatRead(tx, chat, upTo, at)
	})
}

// ErrNotFound is returned when a referenced message doesn't exist.
var ErrNotFound = errors.New("not found")

// SetReadByIDs applies a read receipt from one of the owner's own devices:
// everything up to the newest listed message is read. Unknown IDs fall back to
// the receipt time.
func (s *Store) SetReadByIDs(ctx context.Context, chat string, ids []string, receiptTS, at int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		upTo := int64(0)
		for _, id := range ids {
			var ts int64
			err := tx.QueryRow(`SELECT ts FROM messages WHERE chat_jid = ? AND id = ?`, chat, id).Scan(&ts)
			if err != nil && err != sql.ErrNoRows {
				return err
			}
			upTo = max(upTo, ts)
		}
		if upTo == 0 {
			upTo = receiptTS
		}
		if upTo <= 0 {
			return nil
		}
		return setChatRead(tx, chat, upTo, at)
	})
}

// SetMarkedUnread records the phone's "mark as unread" on a chat.
func (s *Store) SetMarkedUnread(ctx context.Context, chat string, marked bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE chats SET marked_unread = ? WHERE jid = ?`, marked, chat)
	return err
}

// SetMuted records the phone's mute on a chat: 0 = not muted, -1 = forever,
// otherwise the epoch ms it ends. It may arrive before the chat has a message.
func (s *Store) SetMuted(ctx context.Context, chat string, isGroup bool, until int64) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO chats (jid, is_group, muted_until) VALUES (?, ?, ?)
		ON CONFLICT (jid) DO UPDATE SET muted_until = excluded.muted_until`, chat, isGroup, until)
	return err
}

// ApplyHistoryUnread applies a history-sync conversation's read state: only its
// newest `unread` incoming messages stay unread.
func (s *Store) ApplyHistoryUnread(ctx context.Context, chat string, unread int, marked bool, at int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE messages SET read_at = ? WHERE chat_jid = ? AND read_at IS NULL AND from_me = 0
			AND rowid NOT IN (SELECT rowid FROM messages WHERE chat_jid = ? AND `+unreadWhere+`
				ORDER BY ts DESC, id DESC LIMIT ?)`, at, chat, chat, max(unread, 0)); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE chats SET marked_unread = ? WHERE jid = ?`, marked, chat)
		return err
	})
}

// Masked reports WhatsApp's redacted-number placeholders ("+385∙∙∙∙∙∙∙06"),
// which are not names.
func Masked(name string) bool { return strings.ContainsRune(name, '∙') }

// SetChatName records a chat's display name (group subject, or a name from history sync).
func (s *Store) SetChatName(ctx context.Context, jid, name string, isGroup bool) error {
	if name == "" || Masked(name) {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO chats (jid, name, is_group) VALUES (?, ?, ?)
		ON CONFLICT (jid) DO UPDATE SET name = excluded.name, is_group = excluded.is_group OR chats.is_group`, jid, name, isGroup)
	return err
}

// ChatName returns a chat's stored name, "" if unknown.
func (s *Store) ChatName(ctx context.Context, jid string) (string, error) {
	var name string
	err := s.db.QueryRowContext(ctx, `SELECT name FROM chats WHERE jid = ?`, jid).Scan(&name)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return name, err
}

type Contact struct {
	JID          string
	PushName     string
	FullName     string
	BusinessName string
}

// UpsertContact updates only the non-empty fields.
func (s *Store) UpsertContact(ctx context.Context, c Contact) error {
	for _, f := range []*string{&c.PushName, &c.FullName, &c.BusinessName} {
		if Masked(*f) {
			*f = ""
		}
	}
	if c.JID == "" || (c.PushName == "" && c.FullName == "" && c.BusinessName == "") {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO contacts (jid, push_name, full_name, business_name, updated_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (jid) DO UPDATE SET
			push_name = CASE WHEN excluded.push_name != '' THEN excluded.push_name ELSE contacts.push_name END,
			full_name = CASE WHEN excluded.full_name != '' THEN excluded.full_name ELSE contacts.full_name END,
			business_name = CASE WHEN excluded.business_name != '' THEN excluded.business_name ELSE contacts.business_name END,
			updated_at = excluded.updated_at`,
		c.JID, c.PushName, c.FullName, c.BusinessName, time.Now().UnixMilli())
	return err
}

// MergeChat moves everything stored under `from` (a LID chat) onto `to`
// (its phone-number chat) once the mapping is known.
func (s *Store) MergeChat(ctx context.Context, from, to string) error {
	if from == to {
		return nil
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		var name string
		var isGroup bool
		var last, muted int64
		err := tx.QueryRow(`SELECT name, is_group, last_message_at, muted_until FROM chats WHERE jid = ?`, from).Scan(&name, &isGroup, &last, &muted)
		if err == sql.ErrNoRows {
			return nil
		}
		if err != nil {
			return err
		}
		for _, q := range []string{
			`UPDATE OR IGNORE messages SET chat_jid = ? WHERE chat_jid = ?`,
			`UPDATE OR IGNORE reactions SET chat_jid = ? WHERE chat_jid = ?`,
			`UPDATE message_edits SET chat_jid = ? WHERE chat_jid = ?`,
		} {
			if _, err := tx.Exec(q, to, from); err != nil {
				return err
			}
		}
		for _, q := range []string{`DELETE FROM messages WHERE chat_jid = ?`, `DELETE FROM reactions WHERE chat_jid = ?`, `DELETE FROM chats WHERE jid = ?`} {
			if _, err := tx.Exec(q, from); err != nil {
				return err
			}
		}
		if err := bumpChat(tx, to, isGroup, last); err != nil {
			return err
		}
		if muted != 0 {
			if _, err := tx.Exec(`UPDATE chats SET muted_until = ? WHERE jid = ? AND muted_until = 0`, muted, to); err != nil {
				return err
			}
		}
		if name != "" {
			_, err = tx.Exec(`UPDATE chats SET name = ? WHERE jid = ? AND name = ''`, name, to)
		}
		return err
	})
}

func (s *Store) SetMeta(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func (s *Store) Meta(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

// ftsQuery turns free text into an FTS5 prefix query: every word must match.
func ftsQuery(q string) string {
	var parts []string
	for _, w := range strings.Fields(q) {
		w = strings.ReplaceAll(w, `"`, "")
		if w != "" {
			parts = append(parts, `"`+w+`"*`)
		}
	}
	return strings.Join(parts, " ")
}
