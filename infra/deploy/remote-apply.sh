#!/bin/bash
set -euo pipefail

# Invoked over SSH by the GitHub Actions deploy workflow right after it
# rsyncs a freshly built tree into /srv/congress - see
# .github/workflows/deploy.yml and infra/README.md's "Deploy" section.
#
# Building happens in CI now, not here - this script only does what has to
# happen on the target machine itself: installing runtime deps (better-
# sqlite3's native binary must be compiled against *this* machine's libc/
# Node ABI, so node_modules can't just be shipped over from CI as part of
# the rsync) and restarting services.
#
# Chambers are discovered from services/chamber-*/ rather than hardcoded, so
# a new Chamber is picked up here with zero edits - it just needs to exist
# as services/chamber-<name>/ with a matching
# infra/systemd/congress-chamber-<name>.service unit already installed on
# this server (see docs/creating-a-chamber.md).

REPO_DIR="/srv/congress"
cd "$REPO_DIR"

pnpm install --frozen-lockfile

SERVICES=(congress-core)
for dir in "$REPO_DIR"/services/chamber-*/; do
  # A retired Chamber's directory can linger (rsync --delete keeps its
  # untracked data/, .env and node_modules) - only real ones have a package.json.
  [ -f "$dir/package.json" ] || continue
  name="$(basename "$dir")"
  SERVICES+=("congress-$name")
done

# Capitol and Logs were folded into Congress. Their directories are gone from
# the pushed tree, so the discovery loop above no longer restarts them - stop
# them explicitly if a unit is still around (best-effort: needs a sudoers
# entry for stop/disable; otherwise do it once by hand, see infra/README.md's
# "Retiring the Capitol and Logs Chambers").
for retired in congress-chamber-capitol congress-chamber-logs congress-chamber-automation; do
  sudo /usr/bin/systemctl disable --now "$retired" 2>/dev/null || true
done

for svc in "${SERVICES[@]}"; do
  sudo /usr/bin/systemctl restart "$svc"
done

echo "$(date -Is) deployed, restarted: ${SERVICES[*]}"
