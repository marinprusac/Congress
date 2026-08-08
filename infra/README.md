# Deployment

Congress runs on a single Hetzner VPS (`congress-vps` in Tailscale), following
section 7 of the project brief: each service is a plain `systemd` unit bound
to `127.0.0.1`, no Docker, no public HTTPS listener.

## Layout on the server

- Repo lives at `/srv/congress`, owned by `marin`, cloned over SSH using a
  repo-scoped GitHub deploy key with write access (`~/.ssh/congress_deploy_key`
  on the server, configured via `core.sshCommand` in that clone's git config —
  not the user's own key, and not added to the server's default SSH agent).
- Ports: this VPS already runs other services on `3000` and `4000`, so
  Capitol's production port differs from its dev default: **Capitol `8000`**,
  **Notes Chamber `8011`** (matches dev default). Both bind `127.0.0.1` only.
- Each service's `.env` (untracked, created by hand on the server) sets
  `NODE_ENV=production` and a shared `CONGRESS_INTERNAL_TOKEN`.

## Process management

`infra/systemd/congress-capitol.service` and `congress-chamber-notes.service`
are installed at `/etc/systemd/system/` and enabled (`systemctl enable --now`).
Each Chamber added later gets its own unit following the same template:
`User=marin`, `WorkingDirectory=` the service dir, `ExecStart=/usr/bin/pnpm run start`,
`Restart=on-failure`.

## Exposure: Tailscale Serve, not Caddy

The brief flagged this as a detail to confirm at build time. This server
already runs a shared public Caddyfile for unrelated sites
(marinprusac.com, Vaultwarden, the Obsidian WebDAV endpoint, etc.), all bound
to the same `0.0.0.0:443` listener. Adding a Congress site block to that same
Caddyfile would make it reachable by anyone who connects to the server's
public IP with the right SNI/Host header, regardless of DNS — Caddy doesn't
scope a site block to a specific network interface.

Instead, Capitol is exposed with `tailscale serve`:

```
sudo tailscale serve --bg 8000
```

This terminates HTTPS using Tailscale's own cert for the tailnet's `.ts.net`
MagicDNS name and only listens on the tailnet interface — it is never
reachable from the public internet, with no dependency on Caddy or the
existing public Caddyfile at all. Check current state with
`sudo tailscale serve status`.

## Sync: laptop → GitHub → server

There is no public webhook endpoint (would contradict the Tailscale-only
design), so the server polls instead:

- `infra/deploy/sync.sh` — fetches `origin/main`; if it moved, fast-forwards
  (never rebases/force-merges), reinstalls deps (`--frozen-lockfile`),
  rebuilds both frontends, and restarts the affected `systemd` services.
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

## First-time server bootstrap (reference, already done for congress-vps)

```
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up --ssh --hostname=congress-vps   # then open the printed auth URL
ssh-keygen -t ed25519 -f ~/.ssh/congress_deploy_key -N "" -C "congress-vps-deploy"
# add ~/.ssh/congress_deploy_key.pub as a repo deploy key with write access
sudo mkdir -p /srv/congress && sudo chown marin:marin /srv/congress
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
sudo tailscale serve --bg 8000
```
