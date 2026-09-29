-- Local read state. read_at NULL = an incoming message not yet read (on the
-- phone, another device, or locally in Congress). Messages stored before this
-- count as read: WhatsApp doesn't resend old read state.
ALTER TABLE messages ADD COLUMN read_at INTEGER;
ALTER TABLE chats ADD COLUMN marked_unread INTEGER NOT NULL DEFAULT 0;
UPDATE messages SET read_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
CREATE INDEX messages_unread ON messages (chat_jid, ts) WHERE read_at IS NULL AND from_me = 0;
