-- The phone's mute on a chat: 0 = not muted, -1 = muted forever, otherwise
-- the epoch ms the mute ends (it expires without any event).
ALTER TABLE chats ADD COLUMN muted_until INTEGER NOT NULL DEFAULT 0;
