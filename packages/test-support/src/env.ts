import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Vitest runs this setup file once per test file, *before* that file's own
// imports are evaluated. That ordering is the whole trick: every service
// opens its SQLite handle and parses its env at module load (see any
// service's src/db/client.ts and src/env.ts), so the only way to point them
// somewhere disposable is to have the environment already in place by the
// time the first `import` runs.
//
// Combined with Vitest's per-file module isolation, each test file therefore
// gets its own fresh database with no cleanup step and no cross-file bleed.
//
// chamber-kit's env.ts does `import "dotenv/config"` at module load. dotenv
// never overwrites an already-set variable, so everything assigned here wins
// over any .env a developer happens to have locally.

// The passphrase whose digest is installed below. Session-auth tests log in
// with this; nothing else should need it.
export const TEST_MASTER_PASSWORD = "correct-horse-battery-staple";
export const TEST_INTERNAL_TOKEN = "test-internal-token";

const tempDir = mkdtempSync(join(tmpdir(), "congress-test-"));

// A path, not a directory that exists - createDb mkdir -p's the parent
// itself, and better-sqlite3 creates the file.
process.env.DB_PATH = join(tempDir, "test.sqlite3");

process.env.NODE_ENV = "test";
process.env.HOST = "127.0.0.1";
process.env.CONGRESS_INTERNAL_TOKEN = TEST_INTERNAL_TOKEN;

// Congress-only auth fields. The hash has to be a real 64-char sha256 hex
// digest of TEST_MASTER_PASSWORD - the env schema enforces the length, and
// sessionAuth.ts compares actual digests.
process.env.CONGRESS_MASTER_PASSWORD_HASH = createHash("sha256").update(TEST_MASTER_PASSWORD).digest("hex");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";

// Pointed at a port nothing listens on: a Chamber's background registration
// and heartbeat calls are best-effort and swallow their own failures, so
// leaving this unreachable keeps tests from accidentally talking to a real
// dev Congress on :3000.
process.env.CAPITOL_URL = "http://127.0.0.1:9";
process.env.HEARTBEAT_INTERVAL_MS = "30000";

// Per-service required fields, set unconditionally so importing any service
// under test never fails env validation on a field that suite doesn't care
// about.
process.env.FILES_DIR = join(tempDir, "files");
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://127.0.0.1:9/oauth/callback";
process.env.TRACCAR_URL = "http://127.0.0.1:9";
process.env.TRACCAR_TOKEN = "test-traccar-token";
process.env.TRACCAR_DEVICE_ID = "1";
