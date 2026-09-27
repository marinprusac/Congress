#!/usr/bin/env node
// Scaffolds a new Chamber from scripts/create-chamber/template/, substituting
// the chamber's name everywhere it needs to line up (manifest, env defaults,
// Vite base paths, resolveApiBase...), then adds it to the list of modules
// Congress loads. See docs/creating-a-chamber.md for the full guide.
//
// Usage: pnpm create-chamber <name> "<Display Name>"
// Example: pnpm create-chamber budget "Budget"

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const TEMPLATE_DIR = join(__dirname, "create-chamber", "template");
const CONGRESS_DIR = join(REPO_ROOT, "services", "congress");

// Extensions substituted as UTF-8 text. Everything else (icons, etc.) is
// copied byte-for-byte.
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".json", ".html", ".css", ".md"]);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function usage() {
  console.error('Usage: pnpm create-chamber <name> "<Display Name>"');
  console.error('Example: pnpm create-chamber budget "Budget"');
}

const [rawName, displayName] = process.argv.slice(2);

if (!rawName || !displayName) {
  usage();
  fail("missing arguments");
}

if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(rawName)) {
  fail(`chamber name "${rawName}" must be lowercase kebab-case (e.g. "budget", "reading-list")`);
}

const chamberDirName = `chamber-${rawName}`;
const servicesDir = join(REPO_ROOT, "services");
const targetDir = join(servicesDir, chamberDirName);

if (existsSync(targetDir)) {
  fail(`services/${chamberDirName} already exists`);
}

// Collision check: package name, scanned across every existing service.
const existingServiceDirs = readdirSync(servicesDir).filter((name) => statSync(join(servicesDir, name)).isDirectory());

for (const dir of existingServiceDirs) {
  const pkgPath = join(servicesDir, dir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.name === chamberDirName) fail(`package name "${chamberDirName}" is already used by services/${dir}`);
  }

}

function substitute(content) {
  return content
    .replaceAll("__CHAMBER_NAME__", rawName)
    .replaceAll("__CHAMBER_DISPLAY__", displayName);
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
    // ".env.example"'s "extension" is ".example" - special-cased so its
    // placeholders get substituted too.
    if (TEXT_EXTENSIONS.has(ext) || entry === ".env.example") {
      writeFileSync(destPath, substitute(readFileSync(srcPath, "utf8")));
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

copyTemplateDir(TEMPLATE_DIR, targetDir);

// .env is untracked everywhere else in the repo; seed it from .env.example so
// Congress can load the new Chamber immediately.
copyFileSync(join(targetDir, ".env.example"), join(targetDir, ".env"));

// Congress loads every Chamber in its own process: add the workspace
// dependency and the module import.
const congressPkgPath = join(CONGRESS_DIR, "package.json");
const congressPkg = JSON.parse(readFileSync(congressPkgPath, "utf8"));
congressPkg.dependencies[chamberDirName] = "workspace:*";
congressPkg.dependencies = Object.fromEntries(Object.entries(congressPkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(congressPkgPath, `${JSON.stringify(congressPkg, null, 2)}\n`);

const modulesPath = join(CONGRESS_DIR, "src", "chambers", "modules.ts");
const importName = rawName.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
let modulesSource = readFileSync(modulesPath, "utf8");
modulesSource = modulesSource.replace(
  /(\nimport [^\n]+ from "chamber-[^"]+\/module";)(?![\s\S]*import [^\n]+ from "chamber-)/,
  `$1\nimport ${importName} from "${chamberDirName}/module";`
);
modulesSource = modulesSource.replace(/(CHAMBER_MODULES: ChamberModule\[\] = \[[^\]]*)\]/, `$1, ${importName}]`);
writeFileSync(modulesPath, modulesSource);

console.log(`Created services/${chamberDirName} and added it to ${relative(REPO_ROOT, modulesPath)}.\n`);
console.log("What's next:");
console.log(`  1. pnpm install`);
console.log(`  2. Edit services/${chamberDirName}/src/db/schema.ts, items.ts, types.ts, mcp/tools.ts, and`);
console.log(`     frontend/src/pages/*.tsx and src/feedRules.ts to replace the generic "item" example`);
console.log(`     with your real domain.`);
console.log(`  3. pnpm --filter chamber-${rawName} db:generate   # after any schema.ts change`);
console.log(`  4. pnpm --filter congress dev:server   (loads every Chamber, this one included)`);
console.log(`  5. pnpm typecheck && pnpm test`);
console.log(`\nSee docs/creating-a-chamber.md for the full walkthrough, including production rollout.`);
