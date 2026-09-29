package store

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

// Display name for a JID from contacts, "" when unknown (the UI falls back to the number).
const contactName = `coalesce(nullif(%[1]s.full_name, ''), nullif(%[1]s.push_name, ''), nullif(%[1]s.business_name, ''), '')`

type ChatRow struct {
	JID           string `json:"jid"`
	Name          string `json:"name"`
	IsGroup       bool   `json:"isGroup"`
	LastMessageAt int64  `json:"lastMessageAt"`
	LastText      string `json:"lastText"`
	LastType      string `json:"lastType"`
	LastFromMe    bool   `json:"lastFromMe"`
	LastSender    string `json:"lastSender"`
	LastRevoked   bool   `json:"lastRevoked"`
}

type MediaInfo struct {
	Mimetype string `json:"mimetype"`
	Size     int64  `json:"size"`
	Filename string `json:"filename,omitempty"`
	Width    int64  `json:"width,omitempty"`
	Height   int64  `json:"height,omitempty"`
	Seconds  int64  `json:"seconds,omitempty"`
	TooLarge bool   `json:"tooLarge,omitempty"`
}

type Quoted struct {
	ID         string `json:"id"`
	Text       string `json:"text"`
	Type       string `json:"type"`
	SenderName string `json:"senderName"`
	SenderJID  string `json:"senderJid"`
	FromMe     bool   `json:"fromMe"`
}

type Reaction struct {
	Emoji      string `json:"emoji"`
	SenderJID  string `json:"senderJid"`
	SenderName string `json:"senderName"`
}

type MessageRow struct {
	ChatJID    string     `json:"chatJid"`
	ChatName   string     `json:"chatName,omitempty"`
	ID         string     `json:"id"`
	SenderJID  string     `json:"senderJid"`
	SenderName string     `json:"senderName"`
	FromMe     bool       `json:"fromMe"`
	TS         int64      `json:"ts"`
	Type       string     `json:"type"`
	Text       string     `json:"text"`
	QuotedID   string     `json:"-"`
	Quoted     *Quoted    `json:"quoted"`
	EditedAt   *int64     `json:"editedAt"`
	RevokedAt  *int64     `json:"revokedAt"`
	Media      *MediaInfo `json:"media"`
	Reactions  []Reaction `json:"reactions"`
}

// Cursor is "<ms>|<key>", the last row of the previous page.
func parseCursor(c string) (int64, string, bool) {
	ts, key, ok := strings.Cut(c, "|")
	if !ok {
		return 0, "", false
	}
	n, err := strconv.ParseInt(ts, 10, 64)
	return n, key, err == nil
}

func Cursor(ts int64, key string) string { return strconv.FormatInt(ts, 10) + "|" + key }

func (s *Store) ListChats(ctx context.Context, limit int, cursor string) ([]ChatRow, error) {
	where, args := "c.last_message_at > 0", []any{}
	if ts, jid, ok := parseCursor(cursor); ok {
		where += " AND (c.last_message_at < ? OR (c.last_message_at = ? AND c.jid < ?))"
		args = append(args, ts, ts, jid)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT c.jid, coalesce(nullif(c.name, ''), `+fmt.Sprintf(contactName, "ct")+`), c.is_group, c.last_message_at,
			coalesce(m.text, ''), coalesce(m.type, ''), coalesce(m.from_me, 0), coalesce(`+fmt.Sprintf(contactName, "sc")+`, ''),
			m.revoked_at IS NOT NULL
		FROM chats c
		LEFT JOIN contacts ct ON ct.jid = c.jid
		LEFT JOIN messages m ON m.rowid = (
			SELECT rowid FROM messages WHERE chat_jid = c.jid AND type != 'placeholder' ORDER BY ts DESC, id DESC LIMIT 1)
		LEFT JOIN contacts sc ON sc.jid = m.sender_jid
		WHERE %s
		ORDER BY c.last_message_at DESC, c.jid DESC
		LIMIT ?`, where), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatRow{}
	for rows.Next() {
		var r ChatRow
		if err := rows.Scan(&r.JID, &r.Name, &r.IsGroup, &r.LastMessageAt, &r.LastText, &r.LastType, &r.LastFromMe, &r.LastSender, &r.LastRevoked); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) Chat(ctx context.Context, jid string) (*ChatRow, error) {
	var r ChatRow
	err := s.db.QueryRowContext(ctx, `SELECT c.jid, coalesce(nullif(c.name, ''), `+fmt.Sprintf(contactName, "ct")+`), c.is_group, c.last_message_at
		FROM chats c LEFT JOIN contacts ct ON ct.jid = c.jid WHERE c.jid = ?`, jid).Scan(&r.JID, &r.Name, &r.IsGroup, &r.LastMessageAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &r, err
}

const messageColumns = `m.chat_jid, m.id, m.sender_jid, coalesce(` + "%s" + `, ''), m.from_me, m.ts, m.type, m.text, m.quoted_id,
	m.edited_at, m.revoked_at, m.media_mimetype, m.media_size, m.media_filename, m.media_width, m.media_height, m.media_seconds`

func scanMessage(sc interface{ Scan(...any) error }, extra ...any) (MessageRow, error) {
	var r MessageRow
	var edited, revoked, size, w, h, secs sql.NullInt64
	var mime, fname sql.NullString
	dest := []any{&r.ChatJID, &r.ID, &r.SenderJID, &r.SenderName, &r.FromMe, &r.TS, &r.Type, &r.Text, &r.QuotedID,
		&edited, &revoked, &mime, &size, &fname, &w, &h, &secs}
	if err := sc.Scan(append(dest, extra...)...); err != nil {
		return r, err
	}
	if edited.Valid {
		r.EditedAt = &edited.Int64
	}
	if revoked.Valid {
		r.RevokedAt = &revoked.Int64
	}
	if mime.Valid {
		r.Media = &MediaInfo{Mimetype: mime.String, Size: size.Int64, Filename: fname.String, Width: w.Int64, Height: h.Int64, Seconds: secs.Int64}
	}
	r.Reactions = []Reaction{}
	return r, nil
}

// Messages returns a page of a chat's messages, newest first.
func (s *Store) Messages(ctx context.Context, chat string, limit int, cursor string) ([]MessageRow, error) {
	where, args := "m.chat_jid = ?", []any{chat}
	if ts, id, ok := parseCursor(cursor); ok {
		where += " AND (m.ts < ? OR (m.ts = ? AND m.id < ?))"
		args = append(args, ts, ts, id)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, `SELECT `+fmt.Sprintf(messageColumns, fmt.Sprintf(contactName, "sc"))+`
		FROM messages m LEFT JOIN contacts sc ON sc.jid = m.sender_jid
		WHERE `+where+` ORDER BY m.ts DESC, m.id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	out := []MessageRow{}
	for rows.Next() {
		r, err := scanMessage(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, s.decorate(ctx, out)
}

// decorate fills in quoted messages and reactions.
func (s *Store) decorate(ctx context.Context, msgs []MessageRow) error {
	for i := range msgs {
		m := &msgs[i]
		if m.QuotedID != "" {
			q := Quoted{ID: m.QuotedID}
			err := s.db.QueryRowContext(ctx, `SELECT m.text, m.type, m.sender_jid, m.from_me, coalesce(`+fmt.Sprintf(contactName, "sc")+`, '')
				FROM messages m LEFT JOIN contacts sc ON sc.jid = m.sender_jid WHERE m.chat_jid = ? AND m.id = ?`,
				m.ChatJID, m.QuotedID).Scan(&q.Text, &q.Type, &q.SenderJID, &q.FromMe, &q.SenderName)
			if err != nil && err != sql.ErrNoRows {
				return err
			}
			m.Quoted = &q
		}
		rows, err := s.db.QueryContext(ctx, `SELECT r.emoji, r.sender_jid, coalesce(`+fmt.Sprintf(contactName, "sc")+`, '')
			FROM reactions r LEFT JOIN contacts sc ON sc.jid = r.sender_jid
			WHERE r.chat_jid = ? AND r.message_id = ? ORDER BY r.ts`, m.ChatJID, m.ID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var r Reaction
			if err := rows.Scan(&r.Emoji, &r.SenderJID, &r.SenderName); err != nil {
				rows.Close()
				return err
			}
			m.Reactions = append(m.Reactions, r)
		}
		rows.Close()
	}
	return nil
}

// SearchMessages runs a full-text search, newest first, optionally within one chat.
func (s *Store) SearchMessages(ctx context.Context, q, chat string, limit int) ([]MessageRow, error) {
	fq := ftsQuery(q)
	if fq == "" {
		return []MessageRow{}, nil
	}
	where, args := "messages_fts MATCH ?", []any{fq}
	if chat != "" {
		where += " AND m.chat_jid = ?"
		args = append(args, chat)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, `SELECT `+fmt.Sprintf(messageColumns, fmt.Sprintf(contactName, "sc"))+`,
			coalesce(nullif(c.name, ''), `+fmt.Sprintf(contactName, "cc")+`)
		FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
		LEFT JOIN contacts sc ON sc.jid = m.sender_jid
		LEFT JOIN chats c ON c.jid = m.chat_jid
		LEFT JOIN contacts cc ON cc.jid = m.chat_jid
		WHERE `+where+` AND m.revoked_at IS NULL ORDER BY m.ts DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MessageRow{}
	for rows.Next() {
		var chatName string
		r, err := scanMessage(rows, &chatName)
		if err != nil {
			return nil, err
		}
		r.ChatName = chatName
		out = append(out, r)
	}
	return out, rows.Err()
}

// SearchChats matches chat and contact names.
func (s *Store) SearchChats(ctx context.Context, q string, limit int) ([]ChatRow, error) {
	like := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.TrimSpace(q)) + "%"
	rows, err := s.db.QueryContext(ctx, `SELECT c.jid, coalesce(nullif(c.name, ''), `+fmt.Sprintf(contactName, "ct")+`) AS n, c.is_group, c.last_message_at
		FROM chats c LEFT JOIN contacts ct ON ct.jid = c.jid
		WHERE c.last_message_at > 0 AND (n LIKE ? ESCAPE '\' OR c.jid LIKE ? ESCAPE '\')
		ORDER BY c.last_message_at DESC LIMIT ?`, like, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatRow{}
	for rows.Next() {
		var r ChatRow
		if err := rows.Scan(&r.JID, &r.Name, &r.IsGroup, &r.LastMessageAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// MediaFor returns the stored download metadata of a message's attachment, nil if none.
func (s *Store) MediaFor(ctx context.Context, chat, id string) (*Media, string, error) {
	var m Media
	var typ string
	var mime, fname, path sql.NullString
	var size, w, h, secs sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT type, media_mimetype, media_size, media_filename, media_direct_path, media_key,
		media_sha256, media_enc_sha256, media_width, media_height, media_seconds
		FROM messages WHERE chat_jid = ? AND id = ?`, chat, id).
		Scan(&typ, &mime, &size, &fname, &path, &m.Key, &m.SHA256, &m.EncSHA256, &w, &h, &secs)
	if err == sql.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	if !path.Valid || len(m.Key) == 0 {
		return nil, typ, nil
	}
	m.Mimetype, m.Size, m.Filename, m.DirectPath = mime.String, size.Int64, fname.String, path.String
	m.Width, m.Height, m.Seconds = w.Int64, h.Int64, secs.Int64
	return &m, typ, nil
}
