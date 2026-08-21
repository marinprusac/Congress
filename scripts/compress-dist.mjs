#!/usr/bin/env node
// Emits .br/.gz siblings for every compressible file under each service's
// frontend/dist, so chamber-kit's mountStaticFrontend (serveStatic with
// precompressed: true) can stream pre-compressed bytes instead of Caddy
// re-running zstd/gzip over the same file on every single request. Run once
// after all of a deploy's build:web/build:remote/build:vendor steps finish
// (see infra/deploy/sync-deploy.sh) - safe to run repeatedly, and safe if
// never run at all (serveStatic just falls back to the uncompressed file
// when a sibling doesn't exist).
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { gzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib";

const COMPRESSIBLE_EXTENSIONS = new Set([".js", ".css", ".html", ".svg", ".json", ".txt", ".map"]);
// Below this, the header/framing overhead of two extra files on disk isn't
// worth it for the handful of bytes a compressor would actually save.
const MIN_SIZE_BYTES = 1024;

function shouldCompress(path) {
  if (!COMPRESSIBLE_EXTENSIONS.has(extname(path))) return false;
  if (path.endsWith(".gz") || path.endsWith(".br")) return false;
  return statSync(path).size >= MIN_SIZE_BYTES;
}

function compressFile(path) {
  const input = readFileSync(path);
  writeFileSync(`${path}.gz`, gzipSync(input, { level: 9 }));
  writeFileSync(
    `${path}.br`,
    brotliCompressSync(input, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: input.length,
      },
    })
  );
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && shouldCompress(path)) out.push(path);
  }
}

const repoRoot = new URL("..", import.meta.url).pathname;
const servicesDir = join(repoRoot, "services");
const chamberDirs = readdirSync(servicesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("chamber-"))
  .map((entry) => join(servicesDir, entry.name, "frontend/dist"));
const distDirs = [join(servicesDir, "congress/frontend/dist"), ...chamberDirs];

let count = 0;
for (const dir of distDirs) {
  if (!existsSync(dir)) continue;
  const files = [];
  walk(dir, files);
  for (const file of files) {
    compressFile(file);
    count++;
  }
}
console.log(`compress-dist: wrote .gz/.br siblings for ${count} file(s) across ${distDirs.length} dist dir(s)`);
