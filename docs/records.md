# Records: references and search

A "record" is any addressable piece of content (today: every record, namespace `e`). `services/congress/src/recordSources.ts` lets a namespace be served in-process (`registerLocalSource`: `search`, `resolve`, `chip`, manual refs, `feedCandidates`); the type engine registers `e` (`typeEngine/source.ts`), and `records.ts`' `searchRecords`/`resolveRecords`/`getRecordChip`/`getConnections` read only those sources.

- Congress's own SQLite DB keeps `exhibit_cache` and `exhibit_refs` — a cache of every known record's name/url and a reverse-reference graph, written by `syncRecord` on every record write.
- In bodies, `[[record:e:<id>|Label]]` tokens (`packages/congress-ui/src/token.ts`) render as clickable chips (`RecordChip`) via `RecordAnnotatedText`/`useResolvedRecords`. A record's Connections panel — every other record it's connected to, undirected — is computed live from `exhibit_refs`, not stored redundantly.

Record Sharing (granting outside, no-login access to a record and everything it recursively references) previously lived here as a Congress-owned feature. It was removed rather than relocated — no `shares` table, share token auth, public viewer, or per-record Share button/badge exist in this codebase today. It may return later; don't read its absence as an oversight.
