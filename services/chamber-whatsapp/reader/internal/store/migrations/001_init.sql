CREATE TABLE chats (
  jid TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  is_group INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX chats_recent ON chats (last_message_at DESC, jid DESC);

CREATE TABLE contacts (
  jid TEXT PRIMARY KEY,
  push_name TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- Timestamps are unix milliseconds. type 'placeholder' = an edit/revoke seen
-- before its original message; the original fills it in when it arrives.
CREATE TABLE messages (
  chat_jid TEXT NOT NULL,
  id TEXT NOT NULL,
  sender_jid TEXT NOT NULL DEFAULT '',
  sender_lid TEXT NOT NULL DEFAULT '',
  from_me INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  quoted_id TEXT NOT NULL DEFAULT '',
  edited_at INTEGER,
  revoked_at INTEGER,
  media_mimetype TEXT,
  media_size INTEGER,
  media_filename TEXT,
  media_direct_path TEXT,
  media_key BLOB,
  media_sha256 BLOB,
  media_enc_sha256 BLOB,
  media_width INTEGER,
  media_height INTEGER,
  media_seconds INTEGER,
  PRIMARY KEY (chat_jid, id)
);
CREATE INDEX messages_chat_ts ON messages (chat_jid, ts DESC, id DESC);

CREATE TABLE message_edits (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  previous_text TEXT NOT NULL,
  edited_at INTEGER NOT NULL
);
CREATE INDEX message_edits_msg ON message_edits (chat_jid, message_id);

CREATE TABLE reactions (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_jid TEXT NOT NULL,
  emoji TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (chat_jid, message_id, sender_jid)
);

CREATE VIRTUAL TABLE messages_fts USING fts5 (
  text, content = 'messages', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER messages_fts_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
