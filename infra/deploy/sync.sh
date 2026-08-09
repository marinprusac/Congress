#!/bin/bash
set -euo pipefail

REPO_DIR="/srv/congress"
BRANCH="main"
SERVICES=(congress-capitol congress-chamber-notes congress-chamber-calendar)

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
pnpm --filter capitol build:web
pnpm --filter chamber-notes build:web
pnpm --filter chamber-calendar build:web

for svc in "${SERVICES[@]}"; do
  sudo /usr/bin/systemctl restart "$svc"
done

echo "$(date -Is) synced to $remote_sha, restarted: ${SERVICES[*]}"
