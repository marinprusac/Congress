#!/bin/bash
set -euo pipefail

# Invoked by sync.sh via `exec` right after it fast-forwards the repo, as a
# fresh process - see sync.sh's comment for why that matters. Safe to edit
# freely (add/remove build steps, change the service list): being a
# separate file, a change to this one takes effect on the very deploy that
# introduces it, unlike sync.sh itself.

REPO_DIR="/srv/congress"
remote_sha="$1"

cd "$REPO_DIR"

pnpm install --frozen-lockfile

# build:web must run before build:vendor/build:remote for every service -
# they share one dist/ and only build:web empties it (build:vendor/
# build:remote add their extra artifacts alongside with emptyOutDir:
# false). build:vendor is Congress-only: the shared React/router/query-client
# build every Chamber's remote entry (and Congress's own build:web output)
# resolves at runtime via the importmap in Congress's index.html - see
# services/congress/frontend/vite.vendor.config.ts.
#
# Chambers are discovered from services/chamber-*/ rather than hardcoded, so
# a new Chamber (e.g. via `pnpm create-chamber`) is picked up here with zero
# edits to this file - it just needs to exist as services/chamber-<name>/
# with the standard build:web/build:remote scripts and a matching
# infra/systemd/congress-chamber-<name>.service unit already installed on
# the server (see docs/creating-a-chamber.md).
SERVICES=(congress-core)
pnpm --filter congress build:web
pnpm --filter congress build:vendor

for dir in "$REPO_DIR"/services/chamber-*/; do
  name="$(basename "$dir")"
  pnpm --filter "$name" build:web
  pnpm --filter "$name" build:remote
  SERVICES+=("congress-$name")
done

for svc in "${SERVICES[@]}"; do
  sudo /usr/bin/systemctl restart "$svc"
done

echo "$(date -Is) synced to $remote_sha, restarted: ${SERVICES[*]}"
