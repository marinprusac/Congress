# Adding to Congress: a type, a connector, a view

Congress is one service. There are no plug-in modules: what used to be
"Chambers" are now three kinds of thing, all code (or data) in
`services/congress`. This is how to add each.

## 1. A record type (no code)

A type is a SQLite table with real columns, defined at runtime and rendered
generically (list, editor, search, feed, AI tools). Ask the AI for builder
mode, or add a **premade** in `src/typeEngine/premade/<name>.ts`: an ordered
list of operation batches (`create_type`, `add_field`, `set_title_field`,
`set_feed_rules`, `set_binding`, `set_type_meta`, ...) applied once each at
boot, like migrations. A later batch is how you change a premade type (the
Mail, Chat and Place premades each end with an "unhide" batch).

You get for free: `/e/<id>` pages, Search, `[[exhibit:e:<id>|Title]]` chips,
relations, feed rules, time triggers, events (`<prefix>.created|updated|deleted`)
and MCP tools (`list_/get_/create_/update_/delete_/search_<type>`).

## 2. A connector (code)

A connector is hand-written sync code with its own cache DB, declared with
`defineConnector` (`src/connectors/contract.ts`). Look at `whatsapp/` (small,
read-only), `gmail/` (live content, search, one write) or `hevy/` (push) as
templates.

- **Source schema**: `source: [{ kind, fields, facts }]` - what it can give a
  type. A type is bound to it by a `set_binding` op: each field is `sync`
  (pulled and pushed back), `pull` (read-only on the record) or local.
- **`sync(ctx)`** pulls into the connector's own DB and calls
  `ctx.emitChange(kind, key, deleted, quiet)`; bindings turn changes into
  record writes. `intervalMs` sets the schedule. A first backfill should be
  `quiet` (no events).
- **`read`**: `get`/`list` (the cache), and optionally `detail` (live content
  for a record page and the AI), `search` (the whole source), `fetch`
  (one item into the cache, for on-demand records), `series` (time series
  that never become records).
- **`push`**: `create`/`update`/`delete`/`act`. Omit what the source must never
  receive: the binding's `delete: "never"` and refusing in `push` are how a
  read-only source stays read-only (WhatsApp refuses all but a local
  mark-read, and a test asserts it).
- **People**: `ctx.people.find({email|phone})` links to existing People;
  `ctx.people.resolve(key, "corresponded")` may create one - only from direct
  contact (the owner wrote to them), never from mere presence on a list.
- **Extras**: `routes(ctx)` (setup-panel API at `/congress/connectors/<name>/*`),
  `hooks(ctx)` (unauthenticated webhook at `.../hook/*` - check your own
  token), `events` (catalog) + `ctx.publish`, `tools(ctx, server)` (AI tools
  that aren't per-record), `feed(now)` (feed cards), `onRecordChange` and
  `ctx.records.list(type)` (react to records), `googleScopes`.
- Register it in `connectors/list.ts`. Its cache DB uses `createLazyDb` and
  its own `drizzle.<name>.config.ts`.

## 3. A view (frontend)

Only for a genuine screen that is not a list of records (a map, a timeline, a
chart). Put it in `frontend/src/views/<name>/`, add a route in `App.tsx`, list
it in `views/coreViews.ts` (`type` = the type whose use shows it; a `Card`
component puts it in the feed), add the path to the service worker's shell
allowlist (`sw.ts`) and an icon in `gateway.ts`'s `CORE_ICONS`. A live renderer
for a connector's `read.detail` goes in `connectors/live/` (keyed
`connector:kind`), and its setup panel in `connectors/panels.tsx`.

## Rules that apply to all of it

- Ship tests with it (CLAUDE.md): fake the upstream, assert the stateful bits.
- Verify the UI at 375px.
- Nothing is ever sent to WhatsApp; Gmail is never sent or deleted from.
- Production checks are read-only.
