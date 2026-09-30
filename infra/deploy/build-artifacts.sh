#!/bin/bash
set -euo pipefail

# Builds Congress's frontend (dist/, vendor) so the CI
# workflow (.github/workflows/deploy.yml) can rsync pre-built artifacts to
# the server afterwards. Runs in CI, not on the production server - see
# infra/README.md's "Deploy" section for the full push-based flow this is
# part of.
#
# build:web must run before build:vendor - they share one dist/ and only
# build:web empties it (build:vendor adds the shared React/router/query-client
# build alongside with emptyOutDir: false, which Congress's own bundle
# resolves at runtime via the importmap in index.html).
#
REPO_DIR="$(git rev-parse --show-toplevel)"
cd "$REPO_DIR"

build_sha="${1:?usage: build-artifacts.sh <commit-sha>}"

# Bakes this deploy's commit into both the app bundle and the service worker
# (see sw.ts) - lets the worker name its runtime caches per-build and evict
# the previous deploy's on activate, since remote-entry.js/vendor bundle
# filenames are otherwise stable/unhashed. Also written to a static,
# always-fetch-fresh file so it's a cheap `curl`-able "what's actually
# live" signal independent of any of that.
export VITE_BUILD_ID="$build_sha"
echo "{\"buildId\": \"$build_sha\", \"builtAt\": \"$(date -Is)\"}" > services/congress/frontend/public/build-info.json

pnpm --filter congress build:web
pnpm --filter congress build:vendor

# Emits .br/.gz siblings for the build output - see the script's own comment
# and kit/static.ts's mountStaticFrontend (precompressed: true).
node scripts/compress-dist.mjs
