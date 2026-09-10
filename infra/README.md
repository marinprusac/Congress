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

- The app lives at `/srv/congress`, owned by `marin`. It is **not** a git
  clone — deploys are push-based (see "Deploy: GitHub Actions → server"
  below), so the server only ever receives a tree of files over rsync and
  never runs `git` itself.
- Ports: this VPS already runs other services on `3000` and `4000`, so
  Congress's production port differs from its dev default: **Congress
  `8000`**, **Notes Chamber `8011`**, **Calendar Chamber `8012`**, **Documents
  Chamber `8013`**, **Tasks Chamber `8014`**, **Capitol Chamber `8015`**,
  **Logs Chamber `8016`**, **Automation Chamber `8017`**, **Deputy Chamber
  `8018`**, **Map Chamber `8019`**, **Fitness Chamber `8020`** (each Chamber
  matches its dev default). All bind `127.0.0.1` only — the only thing
  reachable from outside the box at all is Caddy, on 80/443.
- Each service's `.env` (untracked, created by hand on the server) sets
  `NODE_ENV=production` and a shared `CONGRESS_INTERNAL_TOKEN`. Congress's
  `.env` additionally sets `CONGRESS_MASTER_PASSWORD_HASH` and
  `SESSION_SECRET` (see `services/congress/.env.example` for how to generate
  each).

## Process management

Every service (`congress-core`, `congress-chamber-notes`,
`congress-chamber-calendar`, `congress-chamber-documents`,
`congress-chamber-tasks`, `congress-chamber-capitol`, `congress-chamber-logs`,
`congress-chamber-automation`, `congress-chamber-deputy`,
`congress-chamber-map`, `congress-chamber-fitness`) has its own discrete unit
under `infra/systemd/`, installed at `/etc/systemd/system/` and enabled
(`systemctl enable --now`). All share the same body: `User=marin`,
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
`infra/deploy/remote-apply.sh` restarts services by exact unit name.

`remote-apply.sh`'s restart step requires **passwordless `sudo` for
`systemctl restart` and `systemctl reload`** for the `marin` user (it calls
`sudo /usr/bin/systemctl restart <service>` non-interactively on every
deploy). This isn't set up by any script here — add it by hand once, e.g. via
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
2. **`infra/deploy/build-artifacts.sh`/`remote-apply.sh`** — nothing to
   edit. Both discover Chambers by globbing `services/chamber-*/`, so a new
   Chamber directory is picked up on the very next deploy with zero changes
   to either script.
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
   for the server) and `sudo systemctl restart` on every affected unit.

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

# Create every service's .env by hand (untracked) from the .env.example
# rsync just delivered: services/congress/.env, services/chamber-notes/.env,
# .../chamber-calendar/.env, .../chamber-documents/.env,
# .../chamber-tasks/.env, .../chamber-capitol/.env, and so on for every
# chamber-*/ directory present. Set NODE_ENV=production, the real
# production PORT (8000/8011/8012/...), one shared CONGRESS_INTERNAL_TOKEN
# across every file, and - for every Chamber - CAPITOL_URL=http://127.0.0.1:8000
# (the .env.example default of :3000 is the dev value and is wrong here).
# Congress's own .env additionally needs CONGRESS_MASTER_PASSWORD_HASH and
# SESSION_SECRET (see .env.example).

cd /srv/congress
sudo cp infra/systemd/congress-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now $(for d in services/chamber-*/; do echo "congress-$(basename "$d")"; done) congress-core

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
