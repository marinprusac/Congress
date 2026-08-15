# Deployment

Congress runs on a single Hetzner VPS (`178.105.180.7`), one plain `systemd`
unit per service bound to `127.0.0.1`, no Docker.

This deviates from the project brief's original access model (Tailscale-only,
no public listener, network membership as the sole access control — brief
section 7). That was tried first and worked, but was abandoned in favor of
public access at `congress.marinprusac.com` gated by a master-password
session cookie (`services/capitol/src/sessionAuth.ts`), by explicit user
decision. See "Access control" below for what that means in practice.

## Layout on the server

- Repo lives at `/srv/congress`, owned by `marin`, cloned over SSH using a
  repo-scoped GitHub deploy key with write access (`~/.ssh/congress_deploy_key`
  on the server, configured via `core.sshCommand` in that clone's git config —
  not the user's own key, and not added to the server's default SSH agent).
- Ports: this VPS already runs other services on `3000` and `4000`, so
  Capitol's production port differs from its dev default: **Capitol `8000`**,
  **Notes Chamber `8011`**, **Calendar Chamber `8012`**, **Documents Chamber
  `8013`**, **Tasks Chamber `8014`** (each Chamber matches its dev default).
  All bind `127.0.0.1` only — the only thing reachable from outside the box
  at all is Caddy, on 80/443.
- Each service's `.env` (untracked, created by hand on the server) sets
  `NODE_ENV=production` and a shared `CONGRESS_INTERNAL_TOKEN`. Capitol's
  `.env` additionally sets `CONGRESS_MASTER_PASSWORD_HASH` and
  `SESSION_SECRET` (see `services/capitol/.env.example` for how to generate
  each).

## Process management

`infra/systemd/congress-capitol.service` and `congress-chamber-notes.service`
are installed at `/etc/systemd/system/` and enabled (`systemctl enable --now`).
Each Chamber added later gets its own unit following the same template:
`User=marin`, `WorkingDirectory=` the service dir, `ExecStart=/usr/bin/pnpm run start`,
`Restart=on-failure`.

## Access control

There is no network-level gate anymore — `congress.marinprusac.com` resolves
publicly and Caddy proxies it to Capitol like any other site on this server.
The **only** thing standing between the open internet and this data is the
master-password cookie:

- `POST /auth/login` checks the password (sha256'd, timing-safe compared)
  and sets a signed, `HttpOnly`, `Secure` session cookie. Rate-limited per
  source IP (5 attempts / 15 min lockout) — see `sessionAuth.ts`.
- Everything that carries real data — `/capitol/registry`, `/api/:chamber/*`
  (the gateway to every Chamber), and the frontend — requires that cookie.
  `/health`, `/manifest`, and the static frontend shell stay open (nothing
  sensitive, and the login page itself has to load unauthenticated).
- `/mcp` is gated separately, by the existing `CONGRESS_INTERNAL_TOKEN`
  header rather than the session cookie, since MCP clients are machines, not
  browsers with cookies.

Changing the password: update `CONGRESS_MASTER_PASSWORD_HASH` in
`services/capitol/.env` on the server and `sudo systemctl restart congress-capitol`.

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
  (every 90s) run it on a loop.

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

## First-time server bootstrap (reference, already done for this VPS)

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
pnpm --filter capitol build:web && pnpm --filter chamber-notes build:web
# create services/capitol/.env and services/chamber-notes/.env by hand (see above)
sudo cp infra/systemd/congress-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now congress-capitol congress-chamber-notes
sudo cp infra/systemd/congress-sync.timer /etc/systemd/system/
sudo systemctl enable --now congress-sync.timer
# add congress.marinprusac.com A record -> this VPS's public IP in Hetzner DNS
sudo cp infra/caddy/congress.caddy /etc/caddy/
echo 'import /etc/caddy/congress.caddy' | sudo tee -a /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
