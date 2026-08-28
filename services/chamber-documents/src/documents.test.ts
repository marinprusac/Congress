import { mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { migrationsDir, waitFor } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { documents } from "./db/schema.js";
import {
  createDocument,
  deleteDocument,
  FileTooLargeError,
  getDocument,
  getDocumentFile,
  MAX_FILE_SIZE_BYTES,
} from "./documents.js";
import { env } from "./env.js";

beforeAll(() => {
  runMigrations(migrationsDir("chamber-documents"));
  mkdirSync(env.FILES_DIR, { recursive: true });
});

beforeEach(() => {
  db.run(sql`delete from documents`);
  for (const f of readdirSync(env.FILES_DIR)) {
    // Best-effort cleanup between tests; a leftover file from a prior test
    // would otherwise make the "no file written on rejection" assertions
    // ambiguous about which file they're looking at.
    try {
      unlinkSync(join(env.FILES_DIR, f));
    } catch {
      // ignore
    }
  }
});

// A real ReadableStream<Uint8Array>, since Readable.fromWeb requires a
// genuine Web stream, not a Node Readable.
function streamOf(chunks: Uint8Array[], sizeBytes?: number): CreateDocumentInputFile {
  const total = sizeBytes ?? chunks.reduce((n, c) => n + c.byteLength, 0);
  return {
    filename: "test.txt",
    mimeType: "text/plain",
    sizeBytes: total,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
  };
}

type CreateDocumentInputFile = Parameters<typeof createDocument>[0]["file"];

function chunk(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

describe("MAX_FILE_SIZE_BYTES boundary", () => {
  it("succeeds when the declared size is exactly at the limit", async () => {
    const file = streamOf([chunk([1, 2, 3])], MAX_FILE_SIZE_BYTES);
    const doc = await createDocument({ title: "Big", description: "", file });
    expect(doc.sizeBytes).toBe(MAX_FILE_SIZE_BYTES);

    const stored = await getDocumentFile(doc.id);
    expect(readFileSync(stored!.path)).toEqual(Buffer.from([1, 2, 3]));
  });

  it("throws FileTooLargeError when the declared size is one byte over the limit, and writes nothing", async () => {
    const before = readdirSync(env.FILES_DIR);
    const file = streamOf([chunk([1, 2, 3])], MAX_FILE_SIZE_BYTES + 1);

    await expect(createDocument({ title: "TooBig", description: "", file })).rejects.toThrow(FileTooLargeError);
    // The message names both numbers, since that's what a caller sees.
    await expect(createDocument({ title: "TooBig2", description: "", file })).rejects.toThrow(
      new RegExp(`${MAX_FILE_SIZE_BYTES + 1}.*${MAX_FILE_SIZE_BYTES}`)
    );

    // The check reads only the caller-declared sizeBytes - a 3-byte stream
    // declared as over-limit is rejected on the metadata alone, before the
    // stream is ever touched.
    expect(readdirSync(env.FILES_DIR)).toEqual(before);
    expect(db.select().from(documents).all()).toHaveLength(0);
  });
});

describe("streamed write", () => {
  it("reassembles multi-chunk content byte-for-byte on disk", async () => {
    const file = streamOf([chunk([1, 2, 3]), chunk([4, 5]), chunk([6])]);
    const doc = await createDocument({ title: "Multi", description: "", file });

    const stored = await getDocumentFile(doc.id);
    expect(readFileSync(stored!.path)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
  });

  it("is actually streamed to disk incrementally, not buffered until the whole body arrives", async () => {
    let releaseSecondChunk!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });

    const file: CreateDocumentInputFile = {
      filename: "test.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      stream: () =>
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(chunk([1, 2]));
            await gate;
            controller.enqueue(chunk([3, 4]));
            controller.close();
          },
        }),
    };

    const created = createDocument({ title: "Streamed", description: "", file });

    let path: string | undefined;
    await waitFor(() => {
      const files = readdirSync(env.FILES_DIR);
      const candidate = files.find((f) => {
        try {
          return readFileSync(join(env.FILES_DIR, f)).length === 2;
        } catch {
          return false;
        }
      });
      if (candidate) path = join(env.FILES_DIR, candidate);
      return path !== undefined;
    }, 2_000, "first chunk flushed to disk before the second arrives");

    expect(readFileSync(path!)).toEqual(Buffer.from([1, 2]));

    releaseSecondChunk();
    const doc = await created;
    const stored = await getDocumentFile(doc.id);
    expect(readFileSync(stored!.path)).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});

describe("deleteDocument", () => {
  it("removes the on-disk file in addition to the DB row", async () => {
    const file = streamOf([chunk([1, 2, 3])]);
    const doc = await createDocument({ title: "ToDelete", description: "", file });
    const stored = await getDocumentFile(doc.id);

    await deleteDocument(doc.id);

    expect(await getDocument(doc.id)).toBeNull();
    expect(() => readFileSync(stored!.path)).toThrow();
  });
});
