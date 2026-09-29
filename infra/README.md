# Deployment

Congress runs on a single Hetzner VPS (`178.105.180.7`) as **one** plain
`systemd` unit (`congress-core`) bound to `127.0.0.1`, no Docker. Every
Chamber is a module loaded into that one process - there are no Chamber
units or ports.

This deviates from the project brief's original access model (Tailscale-only,
no public listener, network membership as the sole access control — brief
section 7). That was tried first and worked, but was abandoned in favor of
public access at `congress.marinprusac.com` gated by a master-password
session cookie (`services/congress/src/sessionAuth.ts`), by explicit user
decision. See "Access control" below for what that means in practice.

## Layout on the server

- The app lives at `/srv/congress`, owned by `marin`. It is **not** a git
  clone — deploys are push-based (see "Deploy: GitHub Actions → server"
  below), so the server only ever receives a tree of files over rsync and
  never runs `git` itself.
- Port: this VPS already runs other services on `3000` and `4000`, so
  Congress's production port differs from its dev default: **`8000`**,
  bound to `127.0.0.1`. The only thing reachable from outside the box at all
  is Caddy, on 80/443. Chambers have no ports.
- `services/congress/.env` (untracked, created by hand on the server) sets
  `NODE_ENV=production`, `PORT=8000`, `CONGRESS_INTERNAL_TOKEN` (now only
  gating the MCP endpoints the AI's `claude` subprocess calls),
  `CONGRESS_MASTER_PASSWORD_HASH` and `SESSION_SECRET` (see
  `services/congress/.env.example`).
- Each Chamber keeps its own config in `services/chamber-<name>/.env`
  (Traccar, Google OAuth, ...), read by Congress for that Chamber only.
  Leftover keys from the process era (`PORT`, `HOST`, `CAPITOL_URL`, ...)
  are simply ignored. Each Chamber's SQLite file stays in its own
  `services/chamber-<name>/data/`.

## wa-reader (WhatsApp)

The one extra unit: `congress-wa-reader` (`infra/systemd/congress-wa-reader.service`)
runs the read-only WhatsApp daemon as its own `wa-reader` user, hardened, writing
only to `services/chamber-whatsapp/data/`. CI builds its Go binary;
`remote-apply.sh` restarts it only when the binary changed. One-time setup
(system user, group membership for `marin`, data dir, unit install) and
pairing are in `services/chamber-whatsapp/reader/README.md`.

## Process management

`congress-core` (`infra/systemd/congress-core.service`) is the only unit:
`User=marin`, `WorkingDirectory=/srv/congress/services/congress`,
`ExecStart=/usr/bin/pnpm run start`, `Restart=on-failure`. It starts every
Chamber in-process (`services/congress/src/chambers/loader.ts`); a Chamber
that fails to start (bad config, a crash in its `start()`) is logged, marked
offline, and skipped rather than taking Congress down.

`remote-apply.sh`'s restart step requires **passwordless `sudo` for
`systemctl restart` and `systemctl reload`** for the `marin` user (it calls
`sudo /usr/bin/systemctl restart <service>` non-interactively on every
deploy). This isn't set up by any script here — add it by hand once, e.g. via
`sudo visudo -f /etc/sudoers.d/congress-sync`:

```
marin ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart congress-*, /usr/bin/systemctl reload caddy
```

## Adding a new Chamber's infra

Nothing per-Chamber on the infra side. `pnpm create-chamber` adds the new
Chamber to Congress's module list, `build-artifacts.sh` discovers it by
globbing `services/chamber-*/`, and Caddy only ever points at Congress. The
one manual step: if the Chamber needs config, create
`services/chamber-<name>/.env` on the server (untracked) from its
`.env.example`, then deploy.

## Google connector and Mail (one-time)

Google sign-in moved from the Calendar Chamber into Congress (Settings →
Accounts), shared by Calendar and Mail. On first boot Calendar hands its
stored accounts to Congress (same ids), so Calendar keeps working with no
action. Congress reads `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`/`_REDIRECT_URI`
from its own `.env`, falling back to `services/chamber-calendar/.env`.

To connect accounts (or grant Mail its Gmail access), once:

1. Google Cloud console → the same OAuth client → add the authorized
   redirect URI `https://congress.marinprusac.com/congress/connectors/google/callback`.
2. Enable the **Gmail API** in that project (and add the
   `gmail.modify` scope to the consent screen if it lists scopes - Mail
   uses it to mark threads read when opened; it never sends or deletes).
3. Optionally move the three `GOOGLE_OAUTH_*` lines into
   `services/congress/.env` (with the new redirect URI) and drop them from
   Calendar's `.env`; restart `congress-core`.
4. Settings → Accounts → "Grant" (or Mail's settings → "Grant Gmail
   access" / "Grant read-sync") for each account.

Mail needs no `.env` of its own (it defaults to `./data/mail.sqlite3`).

## Chambers moved into Congress (one-time)

Chambers used to run as their own `congress-chamber-*` units. The deploy that
moved them in-process can't `stop`/`disable` those units (the sudoers entry
only allows `restart`), so `remote-apply.sh` restarts each old unit once
instead: that stops the old process, and each Chamber's `start` script is
now a no-op that exits 0, so the unit stays inactive. To remove them for
good, once, on the server:

```
sudo systemctl disable --now congress-chamber-notes congress-chamber-calendar congress-chamber-documents congress-chamber-tasks congress-chamber-map congress-chamber-fitness
sudo rm /etc/systemd/system/congress-chamber-*.service
sudo systemctl daemon-reload
```

After that, remove the matching loop from `remote-apply.sh` and the no-op
`start` scripts from each Chamber's `package.json`.

## Access control

There is no network-level gate anymore — `congress.marinprusac.com` resolves
publicly and Caddy proxies it to Congress like any other site on this server.
The **only** thing standing between the open internet and this data is the
master-password cookie:

- `POST /auth/login` checks the password (sha256'd, timing-safe compared)
  and sets a signed, `HttpOnly`, `Secure`, `SameSite=Strict` session cookie.
  Rate-limited per source IP (5 attempts / 15 min lockout; the IP is the
  last `X-Forwarded-For` entry, the one Caddy adds) and globally (30
  failures across all IPs in 15 min lock out everyone, the owner included,
  until the window passes) — see `sessionAuth.ts`.
- Because the cookie is `Strict`, the Google connector's OAuth callback
  (a cross-site redirect from Google) is exempt from the session check; its
  single-use `state`, minted only by the session-gated `/start`, authorises it.
- Everything that carries real data — `/congress/registry`, `/api/:chamber/*`
  (the gateway to every Chamber), and the frontend — requires that cookie.
  `/health`, `/manifest`, and the static frontend shell stay open (nothing
  sensitive, and the login page itself has to load unauthenticated).
- `/mcp` is gated separately, by the existing `CONGRESS_INTERNAL_TOKEN`
  header rather than the session cookie, since MCP clients are machines, not
  browsers with cookies.

Changing the password: update `CONGRESS_MASTER_PASSWORD_HASH` in
`services/congress/.env` on the server and `sudo systemctl restart congress-core`.

## Exposure: Caddy + public DNS

- Hetzner DNS (this domain's nameservers) has an A record:
  `congress.marinprusac.com` → `178.105.180.7`.
- `infra/caddy/congress.caddy` is a standard site block (same pattern as
  this server's other sites — see `dav.caddy`, `wiki.caddy`), reverse-proxying
  to `127.0.0.1:8000`. Caddy handles ACME/HTTPS automatically, same as every
  other site on this box. Installed by copying it to `/etc/caddy/` and adding
  `import /etc/caddy/congress.caddy` to the top-level Caddyfile, then
  `sudo systemctl reload caddy` (reload, not restart — this Caddy instance
  also serves marinprusac.com, Vaultwarden, and the Obsidian WebDAV sync,
  and a reload doesn't drop their connections).

An earlier iteration exposed Capitol tailnet-only via Tailscale (`tailscale
serve`, bound to `127.0.0.1:8000`). That's been fully torn down — Tailscale
is uninstalled from the VPS and the user's other devices — in favor of the
setup above.

## Deploy: GitHub Actions → server

Push-based, not pull-based: nothing on the server ever fetches from GitHub
or builds anything. A push to `main` triggers `.github/workflows/deploy.yml`
on a GitHub-hosted runner, which:

1. Checks out the commit, `pnpm install --frozen-lockfile`, then runs
   `pnpm typecheck` and `pnpm test` — the same two checks
   `infra/deploy/pre-push-hook-checks` already ran on the laptop before the
   push was even allowed, now re-run as a real gate: if either fails here,
   nothing below happens and production is untouched.
2. Runs `infra/deploy/build-artifacts.sh <sha>` — builds every service's
   frontend (`build:web`, Congress's `build:vendor`, every Chamber's
   `build:remote`) and precompresses the output, exactly what
   `sync-deploy.sh` used to do, just on the runner instead of on the VPS.
3. `rsync`s the whole working tree (minus `infra/deploy/rsync-exclude.txt`'s
   `.git`/`node_modules`/`.env`/`data`/`dev-dist`) to `/srv/congress` over
   SSH, with `--delete` so removed files actually disappear on the server —
   safe because everything excluded is either regenerated
   (`node_modules`) or the server's own state (`.env`, each service's
   `data/*.sqlite3`), never source.
4. SSHes in once more to run `infra/deploy/remote-apply.sh`, which is the
   only thing that still runs *on* the VPS: `pnpm install --frozen-lockfile`
   (native modules like `better-sqlite3` must be compiled against this
   machine's own libc/Node ABI — that's the one thing CI genuinely can't do
   for the server) and `sudo systemctl restart congress-core`.

The server needs no build toolchain beyond what `remote-apply.sh` itself
requires (`pnpm`, and whatever `better-sqlite3` needs to compile — see
"First-time server bootstrap" below) — no git, no repo-scoped deploy key.

### One-time setup (GitHub repo secrets)

The runner authenticates to the server as a dedicated SSH key with no
access beyond that one account — not the user's own key.

```
ssh-keygen -t ed25519 -f deploy_key -N "" -C "congress-gh-actions-deploy"
# append deploy_key.pub to ~/.ssh/authorized_keys for marin@178.105.180.7
ssh-keyscan -H 178.105.180.7   # -> value for DEPLOY_SSH_KNOWN_HOSTS
```

Then, in the GitHub repo's Settings → Secrets and variables → Actions, set:

- `DEPLOY_SSH_KEY` — `deploy_key`'s private key contents.
- `DEPLOY_SSH_KNOWN_HOSTS` — the `ssh-keyscan` output above.
- `DEPLOY_SSH_HOST` — `178.105.180.7`.
- `DEPLOY_SSH_USER` — `marin`.

Delete the local `deploy_key`/`deploy_key.pub` files once they're in place —
the private half only needs to exist as that GitHub secret from then on.

## First-time server bootstrap

This is what setting up a fresh VPS from scratch looks like today, for the
full current set of services (Congress plus every `chamber-*` service in
`services/`). (The very first VPS setup only had Capitol + Notes live at this
stage and the reference block here used to reflect that snapshot rather than
the current system — since corrected. If you're adding a *new* Chamber to an
already-running server rather than bootstrapping from zero, see "Adding a new
Chamber's infra" above instead.)

Nothing here is cloned from git anymore — the server only ever receives
files pushed by CI (see "Deploy: GitHub Actions → server" above), so
bootstrap is: get the toolchain and SSH access in place, let one deploy
populate `/srv/congress`, then do the parts that stay genuinely manual
(units, Caddy, `.env` files) with real files to point at.

```
sudo mkdir -p /srv/congress && sudo chown marin:marin /srv/congress
sudo corepack enable && corepack prepare pnpm@11.3.0 --activate
sudo apt-get install -y build-essential python3   # better-sqlite3 native build
sudo apt-get install -y rsync                     # if not already present

# Set up the GitHub Actions deploy key + secrets exactly as in
# "One-time setup (GitHub repo secrets)" above, then push to main (or
# manually re-run the workflow from the Actions tab). This populates
# /srv/congress via rsync and runs `pnpm install`. The workflow's final
# step (restarting services) will fail on this very first run - there's
# nothing to restart yet - that's expected; continue below.

# Create services/congress/.env by hand (untracked) from its .env.example:
# NODE_ENV=production, PORT=8000, CONGRESS_INTERNAL_TOKEN,
# CONGRESS_MASTER_PASSWORD_HASH and SESSION_SECRET. Then each Chamber's own
# services/chamber-<name>/.env from its .env.example, for the ones that
# need config (map's Traccar, fitness's Hevy key, ...).

cd /srv/congress
sudo cp infra/systemd/congress-core.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now congress-core

# Passwordless sudo for the deploy workflow's restarts - see "Process
# management" above for the exact sudoers line; remote-apply.sh will fail
# at the restart step without it.

# add congress.marinprusac.com A record -> this VPS's public IP in Hetzner DNS
sudo cp infra/caddy/congress.caddy /etc/caddy/
echo 'import /etc/caddy/congress.caddy' | sudo tee -a /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy

# Re-run the deploy workflow (or push an empty commit) now that units exist
# - this time the restart step succeeds too.
```

## Retiring the Capitol and Logs Chambers (one-time)

Capitol and Logs were folded into Congress. On the server, once, after the
first deploy that contains this change:

1. Copy `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` from the old
   `services/chamber-logs/.env` into `services/congress/.env` (Web Push now
   sends from Congress).
2. `sudo systemctl disable --now congress-chamber-capitol congress-chamber-logs`
   and remove `/etc/systemd/system/congress-chamber-{capitol,logs}.service`
   (deploys only restart directory-discovered services, so these would
   otherwise keep failing in a restart loop).
3. Congress imports the old `services/chamber-capitol/data/` and
   `services/chamber-logs/data/` SQLite files on its first boot
   (`legacyImport.ts`; both `data/` dirs survive the rsync `--delete` via
   `rsync-exclude.txt`). Check `journalctl -u congress-core` for the
   `Legacy Capitol/Logs import:` line. Once it has run, the old directories
   can be deleted, and so can `legacyImport.ts`.

## Retiring the Automation Chamber (one-time)

The Automation Chamber was deleted. After the deploy, on the server:

    sudo systemctl disable --now congress-chamber-automation
    sudo rm /etc/systemd/system/congress-chamber-automation.service
    sudo systemctl daemon-reload

Its `services/chamber-automation/` directory (`.env`, `data/`, `node_modules`)
lingers because rsync `--delete` protects those; delete it by hand when
convenient. Its stale `automation` row in Congress's chamber registry is
removed by migration `0019`.

## Retiring the Deputy Chamber (one-time)

Deputy's directives became Congress's own tracked items: on its first boot
after this deploy, Congress imports every directive from
`services/chamber-deputy/data/deputy.sqlite3` (`LEGACY_DEPUTY_DB_PATH`, read
only) into Memory, keeping each one's schedule, trigger event, enabled state
and references. Check Chats -> Memory afterwards. Then, on the server:

    sudo systemctl disable --now congress-chamber-deputy
    sudo rm /etc/systemd/system/congress-chamber-deputy.service
    sudo systemctl daemon-reload

Keep `services/chamber-deputy/data/` until the import has been checked; the
rest of that directory (`.env`, `node_modules`) can go right away. Migration
`0029` removes Deputy's registry row, cached exhibits and event settings.
Once the import has run in production, `ai/legacyDirectivesImport.ts` and
`ai/legacyImport.ts` can be deleted.
