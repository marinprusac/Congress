# Deployment

Congress runs on a single Hetzner VPS (`178.105.180.7`), one plain `systemd`
unit per service bound to `127.0.0.1`, no Docker.

This deviates from the project brief's original access model (Tailscale-only,
no public listener, network membership as the sole access control — brief
section 7). That was tried first and worked, but was abandoned in favor of
public access at `congress.marinprusac.com` gated by a master-password
session cookie (`services/congress/src/sessionAuth.ts`), by explicit user
decision. See "Access control" below for what that means in practice.

## Layout on the server

- Repo lives at `/srv/congress`, owned by `marin`, cloned over SSH using a
  repo-scoped GitHub deploy key with write access (`~/.ssh/congress_deploy_key`
  on the server, configured via `core.sshCommand` in that clone's git config —
  not the user's own key, and not added to the server's default SSH agent).
- Ports: this VPS already runs other services on `3000` and `4000`, so
  Congress's production port differs from its dev default: **Congress
  `8000`**, **Notes Chamber `8011`**, **Calendar Chamber `8012`**, **Documents
  Chamber `8013`**, **Tasks Chamber `8014`**, **Capitol Chamber `8015`** (each
  Chamber matches its dev default). All bind `127.0.0.1` only — the only
  thing reachable from outside the box at all is Caddy, on 80/443.
- Each service's `.env` (untracked, created by hand on the server) sets
  `NODE_ENV=production` and a shared `CONGRESS_INTERNAL_TOKEN`. Congress's
  `.env` additionally sets `CONGRESS_MASTER_PASSWORD_HASH` and
  `SESSION_SECRET` (see `services/congress/.env.example` for how to generate
  each).

## Process management

Every service (`congress-core`, `congress-chamber-notes`,
`congress-chamber-calendar`, `congress-chamber-documents`,
`congress-chamber-tasks`, `congress-chamber-capitol`) has its own discrete
unit under `infra/systemd/`, installed at `/etc/systemd/system/` and enabled
(`systemctl enable --now`). All six share the same body: `User=marin`,
`WorkingDirectory=` the service dir, `ExecStart=/usr/bin/pnpm run start`,
`Restart=on-failure`.

Running `pnpm create-chamber <name> "<Display Name>" <port>` (see
`docs/creating-a-chamber.md`) generates a new Chamber's unit file
automatically, following this same pattern — copy it to the server the same
way as any other and `systemctl enable --now` it (see "Adding a new
Chamber's infra" below).

`infra/systemd/congress-chamber@.service` is an optional systemd
*instance*-unit template (`%i` = the chamber directory suffix, e.g.
`systemctl enable --now congress-chamber@notes.service`) if you'd rather
manage one templated unit than N discrete files. Adopting it on an
already-running server is a manual, one-time migration (stop/disable each
discrete unit, enable the corresponding `congress-chamber@<name>` instance
instead) — not something to mix with the discrete units, since
`infra/deploy/sync-deploy.sh` restarts services by exact unit name.

`sync-deploy.sh`'s restart/build step requires **passwordless `sudo` for
`systemctl restart` and `systemctl reload`** for the `marin` user (it calls
`sudo /usr/bin/systemctl restart <service>` non-interactively on every
sync). This isn't set up by any script here — add it by hand once, e.g. via
`sudo visudo -f /etc/sudoers.d/congress-sync`:

```
marin ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart congress-*, /usr/bin/systemctl reload caddy
```

## Adding a new Chamber's infra

Registering a new Chamber with Congress itself is automatic and requires no
code change on Congress's side at all — see `docs/creating-a-chamber.md`. The
only genuinely manual, per-Chamber steps are on the infra side, and running
`pnpm create-chamber` already does the first of them for you:

1. **Systemd unit** — generated for you at `infra/systemd/congress-chamber-<name>.service`
   by the scaffold script. On the server: `sudo cp infra/systemd/congress-chamber-<name>.service /etc/systemd/system/ && sudo systemctl daemon-reload`.
2. **`infra/deploy/sync-deploy.sh`** — nothing to edit. It discovers Chambers
   by globbing `services/chamber-*/`, so a new Chamber directory is picked
   up on the very next sync with zero changes to that script.
3. **Caddy** — nothing to edit. Caddy only ever proxies to Congress
   (`127.0.0.1:8000`); Chamber ports are never referenced there, since
   path-based routing to each Chamber happens inside Congress's own gateway.
4. **On the server, by hand:**
   - Pick a port that doesn't collide with an existing Chamber (`pnpm
     create-chamber` already checks this locally against every
     `.env.example` in the repo, but a port only reserved on the server —
     e.g. by another, unrelated project — won't be caught).
   - Create `services/chamber-<name>/.env` on the server (untracked, same
     as every other service) from the generated `.env.example`, with
     `NODE_ENV=production`, the real production `PORT`, the shared
     `CONGRESS_INTERNAL_TOKEN`, and — important, easy to miss — `CAPITOL_URL`
     corrected to `http://127.0.0.1:8000` (every `.env.example` defaults to
     the dev value `:3000`, which is wrong in production).
   - `sudo systemctl enable --now congress-chamber-<name>`.

## Access control

There is no network-level gate anymore — `congress.marinprusac.com` resolves
publicly and Caddy proxies it to Congress like any other site on this server.
The **only** thing standing between the open internet and this data is the
master-password cookie:

- `POST /auth/login` checks the password (sha256'd, timing-safe compared)
  and sets a signed, `HttpOnly`, `Secure` session cookie. Rate-limited per
  source IP (5 attempts / 15 min lockout) — see `sessionAuth.ts`.
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

## Sync: laptop → GitHub → server

No webhook (would need its own public endpoint and auth story); the server
polls instead:

- `infra/deploy/sync.sh` — fetches `origin/main`; if it moved, fast-forwards
  (never rebases/force-merges) then `exec`s into `infra/deploy/sync-deploy.sh`
  (reinstalls deps with `--frozen-lockfile`, rebuilds every service's
  frontend, restarts the affected `systemd` services). Split into two files
  deliberately: `sync.sh` is tracked in git and rewrites itself via the
  merge above, and bash can keep executing content it already buffered from
  before that rewrite for the rest of *that* process - `exec`ing into a
  separate file makes the actual build/restart logic a fresh process that
  reads its file from disk for the first time, so a change to it always
  takes effect on the very deploy that introduces it. Keep new build steps
  in `sync-deploy.sh`, not `sync.sh`.
- `infra/systemd/congress-sync.service` (oneshot) + `congress-sync.timer`
  (every 30s) run it on a loop.

Installed once with:

```
sudo cp infra/systemd/congress-sync.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now congress-sync.timer
```

Push to `main` from the laptop as usual — the server picks it up within
~90 seconds, no manual deploy step.

## An AI running on the server

The server's deploy key has **write** access to this repo (so an on-server
AI can commit and push its own work), but the server's clone has a
`pre-push` hook (source at `infra/deploy/pre-push-hook`, installed at
`.git/hooks/pre-push`) that refuses any push to `main` or `master` from that
machine. Server-side AI work must go to a `server-ai/*` branch and get
reviewed/merged from the laptop — `main` is the only branch the sync timer
trusts, and it should only ever move via a reviewed merge.

## First-time server bootstrap

This is what setting up a fresh VPS from scratch looks like today, for all
five current services. (The very first VPS setup only had Capitol + Notes
live at this stage and the reference block here used to reflect that
snapshot rather than the current system — since corrected. If you're adding
a *new* Chamber to an already-running server rather than bootstrapping from
zero, see "Adding a new Chamber's infra" above instead.)

```
sudo mkdir -p /srv/congress && sudo chown marin:marin /srv/congress
ssh-keygen -t ed25519 -f ~/.ssh/congress_deploy_key -N "" -C "congress-vps-deploy"
# add ~/.ssh/congress_deploy_key.pub as a repo deploy key with write access
GIT_SSH_COMMAND="ssh -i ~/.ssh/congress_deploy_key -o IdentitiesOnly=yes" \
  git clone git@github.com:marinprusac/Congress.git /srv/congress
cd /srv/congress
git config core.sshCommand "ssh -i ~/.ssh/congress_deploy_key -o IdentitiesOnly=yes"
cp infra/deploy/pre-push-hook .git/hooks/pre-push && chmod +x .git/hooks/pre-push
sudo corepack enable && corepack prepare pnpm@11.3.0 --activate
sudo apt-get install -y build-essential python3   # better-sqlite3 native build
pnpm install

# build:web must run before build:vendor/build:remote (shared dist/, see
# sync-deploy.sh's comment); build:vendor is Congress-only.
pnpm --filter congress build:web
pnpm --filter congress build:vendor
for name in chamber-notes chamber-calendar chamber-documents chamber-tasks chamber-capitol; do
  pnpm --filter "$name" build:web
  pnpm --filter "$name" build:remote
done

# Create every service's .env by hand (untracked) from its .env.example:
# services/congress/.env, services/chamber-notes/.env, .../chamber-calendar/.env,
# .../chamber-documents/.env, .../chamber-tasks/.env, .../chamber-capitol/.env.
# Set NODE_ENV=production, the real production PORT
# (8000/8011/8012/8013/8014/8015), one shared CONGRESS_INTERNAL_TOKEN across
# all six files, and - for every Chamber - CAPITOL_URL=http://127.0.0.1:8000
# (the .env.example default of :3000 is the dev value and is wrong here).
# Congress's own .env additionally needs CONGRESS_MASTER_PASSWORD_HASH and
# SESSION_SECRET (see .env.example).

sudo cp infra/systemd/congress-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now congress-core congress-chamber-notes \
  congress-chamber-calendar congress-chamber-documents congress-chamber-tasks \
  congress-chamber-capitol

# Passwordless sudo for the sync timer's restarts - see "Process management"
# above for the exact sudoers line; sync-deploy.sh will fail at the restart
# step without it.

sudo cp infra/systemd/congress-sync.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now congress-sync.timer
# add congress.marinprusac.com A record -> this VPS's public IP in Hetzner DNS
sudo cp infra/caddy/congress.caddy /etc/caddy/
echo 'import /etc/caddy/congress.caddy' | sudo tee -a /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
