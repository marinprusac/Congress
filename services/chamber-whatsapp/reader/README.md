# wa-reader

A read-only WhatsApp companion device for Congress. It links to your account
like WhatsApp Web does, stores what arrives in its own SQLite database, and
serves it to the WhatsApp Chamber over a Unix socket. It never sends
anything beyond what a passive linked device does automatically (delivery
and retry receipts, key uploads, keepalives).

```
phone ── WhatsApp servers ── wa-reader (Go, user wa-reader)
                               │ data/session.sqlite3   whatsmeow session (0600)
                               │ data/messages.sqlite3  chats/messages (0600)
                               └ /run/wa-reader/api.sock  GET-only API (0660, group wa-reader)
                                         │
                      Congress (user marin) ── chamber-whatsapp ── /api/whatsapp/* (session cookie)
```

**Why a socket and not direct DB reads:** the databases stay private to the
daemon's own user (Congress's user couldn't open a 0600 file anyway), media
downloads need the live WhatsApp client, and unlike a 127.0.0.1 port a
socket isn't reachable by the other services on this VPS.

## Read-only guarantees

- `internal/waclient` is the only package that imports whatsmeow's client.
  It exposes connect, receive, download, and two lookups (LID→phone number,
  group name). There is no send method to call.
- `readonly-denylist.txt` lists every whatsmeow method that sends, marks,
  subscribes or mutates (`SendMessage`, `MarkRead`, `SendPresence`,
  `SendChatPresence`, `SendMediaRetryReceipt`, group/profile/status/privacy
  changes, `Logout`, …). `readonly_test.go` (Go) and
  `tests/wa-reader-readonly.test.ts` (vitest, so the pre-push hook and CI
  catch it without Go) fail if any appears, if anything outside
  `internal/waclient` imports the client, or if `waclient` touches a client
  member that isn't on its allowlist.
- Presence is never sent, so you always appear offline from this device.
  Asking the phone to resend undecryptable messages is switched off.
- The API only answers GET; the Chamber only proxies GET routes.
- Congress's AI can read (never send) through the Chamber's MCP tools:
  `get_status`, `list_chats`, `find_chats`, `read_chat`, `search_messages`.
  No exhibits or feed items, so WhatsApp isn't in Congress Search or the home feed.
- Permanent rule: nothing is ever sent or uploaded to WhatsApp (messages,
  reactions, media, photos, status, receipts beyond the automatic ones,
  account or app-state changes), from the UI or the AI.

## Keeping the device healthy

From community reports on whatsmeow, mautrix-whatsapp and Baileys, bans are
tied to *sending* (especially to non-contacts), not to passive linked
devices. What this daemon does about the remaining risks:

- **One process per session.** A file lock refuses a second instance, and on
  `StreamReplaced` the daemon stops reconnecting instead of fighting.
- **Terminal states stay down.** Logged out (unlinked), client outdated
  (405) and temporary ban leave the daemon idle with the API up and the
  Chamber showing what to do. Nothing retries in a loop.
- **Few queries.** Group names come from history sync and group events;
  a group-info lookup only happens for an unknown group, one at a time,
  at least 2s apart, backing off a minute on errors.
- **Media on demand only,** one download at a time, capped by
  `WA_MEDIA_MAX_BYTES`. Expired media is reported, not re-requested from the phone.
- **Keep whatsmeow current.** WhatsApp periodically rejects old client
  versions (the Chamber shows "client outdated"). Fix: in this folder run
  `go get go.mau.fi/whatsmeow@latest && go mod tidy`, run `go test ./...`,
  then push.

## Build

CI builds static `bin/wa-reader-linux-{amd64,arm64}` on every push to main,
and `infra/deploy/remote-apply.sh` links `bin/wa-reader` to the one matching
the server. It restarts the service only when the binary changed. Locally:

```
cd services/chamber-whatsapp/reader
go test ./...
CGO_ENABLED=0 go build -o bin/wa-reader ./cmd/wa-reader
```

No cgo is needed: SQLite is the pure-Go `modernc.org/sqlite`.

## One-time server setup

As root, after the first deploy containing this folder:

```
useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin wa-reader
usermod -aG wa-reader marin            # lets Congress reach the socket
install -d -o wa-reader -g wa-reader -m 0700 /srv/congress/services/chamber-whatsapp/data

cp /srv/congress/services/chamber-whatsapp/.env.example /srv/congress/services/chamber-whatsapp/.env
chown marin:marin /srv/congress/services/chamber-whatsapp/.env && chmod 0600 /srv/congress/services/chamber-whatsapp/.env

cp /srv/congress/infra/systemd/congress-wa-reader.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable congress-wa-reader    # don't start yet: pair first
systemctl restart congress-core        # picks up marin's new group
```

The existing sudoers rule (`systemctl restart congress-*`) already covers
deploy restarts of `congress-wa-reader`.

## Pairing (once)

**From Congress (normal way):** open WhatsApp in Congress (Search → WhatsApp)
on a computer or tablet, tap **Link WhatsApp**, and scan the code with your
phone (WhatsApp → Settings → Linked devices → Link a device). The code
refreshes by itself while it's shown. Behind it: `POST /pairing` starts a QR
session in the running daemon (the API's only non-GET) and `GET /pairing`
returns the current code as a module matrix the page draws. If the device
is ever unlinked, the daemon exits, systemd restarts it unpaired, and the
Link button appears again.

**From a terminal (fallback):** the service must be stopped; the lock
refuses a second process.

```
sudo systemctl stop congress-wa-reader
sudo systemd-run --pty --wait --collect --uid=wa-reader --gid=wa-reader -p UMask=0077 \
  -p WorkingDirectory=/srv/congress/services/chamber-whatsapp \
  -p EnvironmentFile=/srv/congress/services/chamber-whatsapp/.env \
  /srv/congress/services/chamber-whatsapp/reader/bin/wa-reader login
```

On the phone: WhatsApp → Settings → Linked devices → Link a device, and scan
the QR in the terminal (it refreshes every ~20s). After "Paired" it stays
connected until the first history sync goes quiet (at most 3 minutes), then
exits. Then:

```
sudo systemctl start congress-wa-reader
journalctl -u congress-wa-reader -f
```

`WA_FULL_HISTORY=true` asks the phone for your full history. That only
happens at pairing and can't be triggered again later. To re-pair: remove
"Congress" from Linked devices on the phone, stop the service, delete
`data/session.sqlite3`, and run `login` again. Stored messages survive.

## The phone must come online

A linked device only works while the phone is alive. **If the phone doesn't
connect for about 14 days, WhatsApp unlinks every companion device.** Open
WhatsApp on the phone at least every ~12 days. Messages from other people
reach this device even while the phone is off. So the daemon tracks "last
sign of the phone" separately: your own messages, history syncs and
app-state changes. The Chamber warns after 10 days, and the journal warns
after 12.

## Backups

`data/session.sqlite3` is the pairing. Losing it means re-pairing, not data
loss. `data/messages.sqlite3` is your archive, and history before the pairing
can't be fetched again. Both are plain SQLite in WAL mode, not encrypted at
rest, so treat every copy as sensitive.

```
sudo -u wa-reader sqlite3 /srv/congress/services/chamber-whatsapp/data/messages.sqlite3 ".backup '/tmp/messages.bak'"
sudo -u wa-reader sqlite3 /srv/congress/services/chamber-whatsapp/data/session.sqlite3  ".backup '/tmp/session.bak'"
# then encrypt before it leaves the box, e.g.
age -r <your-age-public-key> -o messages.bak.age /tmp/messages.bak && shred -u /tmp/messages.bak
```

`.backup` is safe while the daemon runs. To restore, stop the service, put
the files back owned `wa-reader:wa-reader` with mode 0600, and start it. Don't
run a restored session copy on two machines at once; that's the
`StreamReplaced` fight above.

## States (GET /status, shown in the Chamber)

| state | meaning | action |
| --- | --- | --- |
| `connected` | receiving | none |
| `connecting` / `disconnected` | network blip; whatsmeow reconnects | wait |
| `not_paired` | no session yet | Pairing, above |
| `logged_out` | unlinked on the phone, or 14 days offline | re-pair |
| `stream_replaced` | another process used this session | stop the other one, restart the service |
| `client_outdated` | WhatsApp rejected the whatsmeow version | update whatsmeow, push |
| `temporary_ban` | WhatsApp blocked this device for a while | wait it out; keep the service stopped |
| `offline` | started with `serve -offline` (dev) | none |

## Local development

```
cd services/chamber-whatsapp/reader
go run ./cmd/wa-seed ../data/messages.sqlite3        # fake chats, no WhatsApp involved
WA_READER_SOCKET=/tmp/wa-reader.sock go run ./cmd/wa-reader serve -offline
# services/chamber-whatsapp/.env: WA_READER_SOCKET=/tmp/wa-reader.sock
pnpm --filter congress dev:server
```

## Configuration (`services/chamber-whatsapp/.env`)

| key | default | |
| --- | --- | --- |
| `WA_READER_SOCKET` | `/run/wa-reader/api.sock` | read by both daemon and Chamber |
| `WA_SESSION_DB` | `./data/session.sqlite3` | |
| `WA_MESSAGES_DB` | `./data/messages.sqlite3` | |
| `WA_MEDIA_MAX_BYTES` | `26214400` | larger attachments aren't downloaded |
| `WA_FULL_HISTORY` | `true` | only affects pairing |
| `WA_DEVICE_NAME` | `Congress` | label in Linked devices |
| `WA_LOG_LEVEL` | `INFO` | DEBUG/INFO/WARN/ERROR |
| `WA_SOCKET_MODE` | `0660` | octal |

There are no secrets in it. The session keys live in `session.sqlite3`.
