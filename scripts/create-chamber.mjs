#!/usr/bin/env node
// Scaffolds a new Chamber from scripts/create-chamber/template/, substituting
// the chamber's name/port everywhere those need to line up (manifest, env
// defaults, Vite base paths, the ChamberMark name, resolveApiBase, the
// systemd unit...) in one pass instead of by hand. See
// docs/creating-a-chamber.md for the full guide.
//
// Usage: pnpm create-chamber <name> "<Display Name>" <port>
// Example: pnpm create-chamber budget "Budget" 8015

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const TEMPLATE_DIR = join(__dirname, "create-chamber", "template");
const SYSTEMD_TEMPLATE = join(__dirname, "create-chamber", "systemd.service.template");

// Extensions substituted as UTF-8 text. Everything else (icons, etc.) is
// copied byte-for-byte.
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".json", ".html", ".css", ".md"]);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function usage() {
  console.error('Usage: pnpm create-chamber <name> "<Display Name>" <port>');
  console.error('Example: pnpm create-chamber budget "Budget" 8015');
}

const [rawName, displayName, rawPort] = process.argv.slice(2);

if (!rawName || !displayName || !rawPort) {
  usage();
  fail("missing arguments");
}

if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(rawName)) {
  fail(`chamber name "${rawName}" must be lowercase kebab-case (e.g. "budget", "reading-list")`);
}

const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  fail(`port "${rawPort}" must be an integer between 1024 and 65535`);
}

const chamberDirName = `chamber-${rawName}`;
const servicesDir = join(REPO_ROOT, "services");
const targetDir = join(servicesDir, chamberDirName);

if (existsSync(targetDir)) {
  fail(`services/${chamberDirName} already exists`);
}

// Collision checks: package name and port, scanned across every existing
// service so a typo'd new Chamber can't silently clash with one that's
// already running.
const existingServiceDirs = readdirSync(servicesDir).filter((name) => statSync(join(servicesDir, name)).isDirectory());

for (const dir of existingServiceDirs) {
  const pkgPath = join(servicesDir, dir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.name === chamberDirName) fail(`package name "${chamberDirName}" is already used by services/${dir}`);
  }

  const envExamplePath = join(servicesDir, dir, ".env.example");
  if (existsSync(envExamplePath)) {
    const match = readFileSync(envExamplePath, "utf8").match(/^PORT=(\d+)/m);
    if (match && Number(match[1]) === port) {
      fail(`port ${port} is already used by services/${dir} (.env.example)`);
    }
  }
}

function substitute(content) {
  return content
    .replaceAll("__CHAMBER_NAME__", rawName)
    .replaceAll("__CHAMBER_DISPLAY__", displayName)
    .replaceAll("__CHAMBER_PORT__", String(port));
}

function copyTemplateDir(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (statSync(srcPath).isDirectory()) {
      copyTemplateDir(srcPath, destPath);
      continue;
    }
    const ext = entry.slice(entry.lastIndexOf("."));
    // ".env.example" is a dotfile whose "extension" (by lastIndexOf(".")) is
    // ".example", not in TEXT_EXTENSIONS - special-cased so its
    // __CHAMBER_PORT__/__CHAMBER_NAME__ placeholders actually get
    // substituted instead of being copied through verbatim.
    if (TEXT_EXTENSIONS.has(ext) || entry === ".env.example") {
      writeFileSync(destPath, substitute(readFileSync(srcPath, "utf8")));
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

copyTemplateDir(TEMPLATE_DIR, targetDir);

// .env is untracked everywhere else in the repo (see every other Chamber's
// .gitignore); seed it from .env.example so `pnpm --filter chamber-<name>
// dev:server` works immediately without an extra manual copy.
copyFileSync(join(targetDir, ".env.example"), join(targetDir, ".env"));

const systemdUnitPath = join(REPO_ROOT, "infra", "systemd", `congress-${chamberDirName}.service`);
writeFileSync(systemdUnitPath, substitute(readFileSync(SYSTEMD_TEMPLATE, "utf8")));

console.log(`Created services/${chamberDirName} and ${relative(REPO_ROOT, systemdUnitPath)}.\n`);
console.log("What's next:");
console.log(`  1. pnpm install`);
console.log(`  2. Edit services/${chamberDirName}/src/db/schema.ts, items.ts, types.ts, mcp/tools.ts, and`);
console.log(`     frontend/src/pages/*.tsx and frontend/src/widgets/*.tsx to replace the generic "item" example`);
console.log(`     with your real domain.`);
console.log(`  3. pnpm --filter chamber-${rawName} db:generate   # after any schema.ts change`);
console.log(`  4. Set a real CONGRESS_INTERNAL_TOKEN in services/${chamberDirName}/.env, matching Capitol's.`);
console.log(`  5. pnpm --filter chamber-${rawName} dev:server   (and, separately, dev:web)`);
console.log(`  6. pnpm -r typecheck`);
console.log(`\nCapitol picks this Chamber up automatically once it registers - no Capitol-side edit needed.`);
console.log(`See docs/creating-a-chamber.md for the full walkthrough, including production rollout.`);
