#!/bin/bash
set -euo pipefail

REPO_DIR="/srv/congress"
BRANCH="main"
SERVICES=(congress-capitol congress-chamber-notes congress-chamber-calendar congress-chamber-documents congress-chamber-tasks)

cd "$REPO_DIR"

git fetch origin "$BRANCH" --quiet

local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse "origin/$BRANCH")

if [ "$local_sha" = "$remote_sha" ]; then
  exit 0
fi

echo "$(date -Is) syncing $local_sha -> $remote_sha"

git merge --ff-only "origin/$BRANCH"

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
