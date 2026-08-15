#!/bin/bash
set -euo pipefail

REPO_DIR="/srv/congress"
BRANCH="main"

cd "$REPO_DIR"

git fetch origin "$BRANCH" --quiet

local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse "origin/$BRANCH")

if [ "$local_sha" = "$remote_sha" ]; then
  exit 0
fi

echo "$(date -Is) syncing $local_sha -> $remote_sha"

git merge --ff-only "origin/$BRANCH"

# This script is tracked in git, and the merge above can rewrite it
# mid-run - bash reads a running script incrementally, not fully into
# memory upfront, so anything after this point in *this* process can end
# up executing stale content it had already buffered before the merge,
# silently ignoring whatever the merge just changed here (confirmed by a
# real incident: a build-step addition to what used to be the rest of this
# file never ran on the deploy that pulled it in, despite the file on disk
# being correct immediately afterward). `exec` into a separate file next -
# a fresh process reading it from disk for the first time - sidesteps the
# whole hazard for the part that actually needs to reflect this sync's own
# changes. Keep this file (the poller) itself minimal and rarely-changed;
# put anything that evolves (build steps, service list) in sync-deploy.sh.
exec bash "$REPO_DIR/infra/deploy/sync-deploy.sh" "$remote_sha"
