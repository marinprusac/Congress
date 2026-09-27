#!/bin/bash
set -euo pipefail

# Invoked over SSH by the GitHub Actions deploy workflow right after it
# rsyncs a freshly built tree into /srv/congress - see
# .github/workflows/deploy.yml and infra/README.md's "Deploy" section.
#
# Building happens in CI, not here - this script only does what has to
# happen on the target machine itself: installing runtime deps (better-
# sqlite3's native binary must be compiled against *this* machine's libc/
# Node ABI) and restarting Congress. Every Chamber runs inside Congress's own
# process now, so congress-core is the only service.

REPO_DIR="/srv/congress"
cd "$REPO_DIR"

pnpm install --frozen-lockfile

# Chambers used to be their own systemd units. Before Congress starts running
# them in-process, make sure no old Chamber process is still alive (two sets
# of pollers on one SQLite file). The deploy user may only `restart`
# congress-* units, so restart each one: it stops the old process and runs
# the Chamber's `start` script, now a no-op that exits cleanly, leaving the
# unit inactive. Disabling them for good is a one-time manual step - see
# infra/README.md's "Chambers moved into Congress".
for unit in congress-chamber-notes congress-chamber-calendar congress-chamber-documents congress-chamber-tasks congress-chamber-map congress-chamber-fitness; do
  if systemctl cat "$unit" >/dev/null 2>&1 && systemctl is-enabled "$unit" >/dev/null 2>&1; then
    sudo /usr/bin/systemctl restart "$unit" || true
  fi
done

# Retired Chambers (best-effort: needs a sudoers entry for stop/disable;
# otherwise done once by hand, see infra/README.md).
for retired in congress-chamber-capitol congress-chamber-logs congress-chamber-automation congress-chamber-deputy; do
  sudo /usr/bin/systemctl disable --now "$retired" 2>/dev/null || true
done

sudo /usr/bin/systemctl restart congress-core

echo "$(date -Is) deployed, restarted: congress-core"
