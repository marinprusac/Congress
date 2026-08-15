#!/bin/bash
set -euo pipefail

# Invoked by sync.sh via `exec` right after it fast-forwards the repo, as a
# fresh process - see sync.sh's comment for why that matters. Safe to edit
# freely (add/remove build steps, change the service list): being a
# separate file, a change to this one takes effect on the very deploy that
# introduces it, unlike sync.sh itself.

REPO_DIR="/srv/congress"
SERVICES=(congress-capitol congress-chamber-notes congress-chamber-calendar congress-chamber-documents congress-chamber-tasks)
remote_sha="$1"

cd "$REPO_DIR"

pnpm install --frozen-lockfile
# build:web must run before build:vendor/build:remote for every service -
# they share one dist/ and only build:web empties it (build:vendor/
# build:remote add their extra artifacts alongside with emptyOutDir:
# false). build:vendor is Capitol-only: the shared React/router/query-client
# build every Chamber's remote entry (and Capitol's own build:web output)
# resolves at runtime via the importmap in Capitol's index.html - see
# services/capitol/frontend/vite.vendor.config.ts.
pnpm --filter capitol build:web
pnpm --filter capitol build:vendor
pnpm --filter chamber-notes build:web
pnpm --filter chamber-notes build:remote
pnpm --filter chamber-calendar build:web
pnpm --filter chamber-calendar build:remote
pnpm --filter chamber-documents build:web
pnpm --filter chamber-documents build:remote
pnpm --filter chamber-tasks build:web
pnpm --filter chamber-tasks build:remote

for svc in "${SERVICES[@]}"; do
  sudo /usr/bin/systemctl restart "$svc"
done

echo "$(date -Is) synced to $remote_sha, restarted: ${SERVICES[*]}"
