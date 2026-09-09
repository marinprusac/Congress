#!/bin/bash
set -euo pipefail

# Builds every service's frontend (dist/, remote-entry, vendor) so the CI
# workflow (.github/workflows/deploy.yml) can rsync pre-built artifacts to
# the server afterwards. Runs in CI, not on the production server - see
# infra/README.md's "Deploy" section for the full push-based flow this is
# part of.
#
# build:web must run before build:vendor/build:remote for every service -
# they share one dist/ and only build:web empties it (build:vendor/
# build:remote add their extra artifacts alongside with emptyOutDir: false).
# build:vendor is Congress-only: the shared React/router/query-client build
# every Chamber's remote entry (and Congress's own build:web output)
# resolves at runtime via the importmap in Congress's index.html.
#
# Chambers are discovered from services/chamber-*/ rather than hardcoded, so
# a new Chamber (e.g. via `pnpm create-chamber`) needs zero edits here - it
# just needs the standard build:web/build:remote scripts.

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

for dir in "$REPO_DIR"/services/chamber-*/; do
  name="$(basename "$dir")"
  pnpm --filter "$name" build:web
  pnpm --filter "$name" build:remote
done

# Emits .br/.gz siblings for every service's build output - see the script's
# own comment and chamber-kit's mountStaticFrontend (precompressed: true).
# Runs once here, after every dist/ this deploy touches is final.
node scripts/compress-dist.mjs
