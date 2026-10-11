# Exhibits: references and search

An "exhibit" is any addressable piece of content (today: every record, namespace `e`). `services/congress/src/exhibitSources.ts` lets a namespace be served in-process (`registerLocalSource`: `search`, `resolve`, `chip`, manual refs, `feedCandidates`); the type engine registers `e` (`typeEngine/source.ts`), and `exhibits.ts`' `searchExhibits`/`resolveExhibits`/`getExhibitChip`/`getConnections` read only those sources.

- Congress's own SQLite DB keeps `exhibit_cache` and `exhibit_refs` — a cache of every known exhibit's name/url and a reverse-reference graph, written by `syncExhibit` on every record write.
- In bodies, `[[exhibit:e:<id>|Label]]` tokens (`packages/congress-ui/src/token.ts`) render as clickable chips (`ExhibitChip`) via `ExhibitAnnotatedText`/`useResolvedExhibits`. A record's Connections panel — every other exhibit it's connected to, undirected — is computed live from `exhibit_refs`, not stored redundantly.

Exhibit Sharing (granting outside, no-login access to an exhibit and everything it recursively references) previously lived here as a Congress-owned feature. It was removed rather than relocated — no `shares` table, share token auth, public viewer, or per-exhibit Share button/badge exist in this codebase today. It may return later; don't read its absence as an oversight.
