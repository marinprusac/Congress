# Deputy Chamber — Plan

This is the design plan for **Deputy** (`services/chamber-deputy`), an AI Chamber that runs headless Claude Code on the server — periodically, on cross-Chamber events, and on demand from a chat page in the Congress PWA — with full MCP access to every other Chamber. It follows the same Chamber contract as everything else in the system (see `docs/creating-a-chamber.md`); this doc covers what's specific to Deputy: how it decides what to do, how it's told what's expected of it, and the guardrails around giving one agent unrestricted cross-Chamber write access.

Status: planning, not yet scaffolded. Decisions below marked **Decided** came out of discussion with the owner; the rest are proposed defaults, called out as such, meant to be cheap to change later via Settings rather than requiring a redeploy.

## 1. What Deputy is, and isn't

Deputy is **not** a chat companion and **not** where deep thinking happens — that's the Claude app. Deputy is a functional operator over Congress's own data and Chambers: check things, act on standing instructions, do small management tasks on request ("archive last month's done tasks," "what's overdue"). Chat with it should read as terse and transactional, not conversational.

Deputy is also **not** another Automation Chamber. Automation Chamber is a rigid trigger→action table: one event type maps to one MCP call with templated arguments, entirely mechanical. Deputy is a reasoning agent: it's handed context and a standing mandate, and decides for itself what — if anything — is worth doing. This is why it needs a fundamentally different "what should I do" mechanism than Automation's trigger/condition table (see §3).

## 2. Chamber shape

Scaffolded normally: `pnpm create-chamber deputy "Deputy" 8018`. Gets the standard contract for free — manifest/health/mcp, own SQLite file, own systemd unit, registry visibility, shell-hosted nav. The pieces of `chamber-kit` it actually leans on: `fetchRegistry` and `callChamberTool` (to build the MCP surface it hands to headless Claude Code — see §5), `createPublishEvent` (§7), `createSingleRowSettings` (§9), `createChamberBootstrap`.

**Decided: Deputy exposes no MCP tools of its own in v1.** It's a pure consumer of every other Chamber's tools. No `ask_deputy` delegation tool, no self-status tool. This avoids a second unattended-trigger surface (something else deciding to wake Deputy up) and the self-modification risk of Deputy being callable by, say, an Automation. Worth revisiting once the rest of the system is trusted (see §14).

## 3. Directives — how Deputy knows what to do

A new Exhibit type, `directives`, is Deputy's mandate. Each one:

| Field | Purpose |
|---|---|
| `title` | Shown in the list/search, e.g. "Morning overdue-task check." |
| `body` | Markdown, `[[wikilink]]`-able like every other Exhibit body — a directive can reference specific notes/chambers/entities. This is the actual instruction, written in plain English. |
| `enabled` | Toggle without deleting, same as Automations/Log Rules. |

That's the whole schema — deliberately thinner than Automation's `automations` table (no `triggerEventType`/`conditionField`/`argsTemplate`). Automation Chamber needs that structure because its executor is dumb code matching an event type to a fixed call. Deputy's executor is Claude itself: every enabled directive is handed to it as context on every run, and it decides relevance and action itself. A directive can be purely time-based ("every morning, do X" — no event corresponds to this at all) or event-reactive ("if a flight event starts within 24h, remind me") in the same free-text field, because nothing downstream needs to parse it structurally.

List/detail pages mirror Automations/Log Rules exactly (same list-search-form primitives from `congress-ui`). Directives show up in global search and Connections panels like any Exhibit.

**Decided: Directives are UI-owned only.** No MCP tool exposes directive CRUD (consistent with §2), so nothing — including Deputy itself during an unattended run — can rewrite its own mandate without the owner going through the Directives page by hand. A future "propose a new directive" *chat-only* path is plausible (§14) but isn't in v1.

## 4. Prompt assembly

Every headless invocation builds a prompt from three layers, freshly, every time — nothing is baked into a static system prompt file:

1. **Base identity prompt** (code-owned, not editable via UI): who Deputy is, the "you only act through MCP tools, never Bash/filesystem" framing (§6), the current server time, and — importantly — for chat specifically, an explicit instruction that this is a short functional exchange about app/data management, not an open-ended conversation.
2. **Persona/tone settings** — one free-text field via `createSingleRowSettings` (e.g. "be terse," "always double check before anything irreversible"). Owner-tunable without a code change, same pattern every other Chamber's settings uses.
3. **All `enabled` Directives**, concatenated, plus trigger-specific context (below).

### Trigger-specific context

- **Chat message** → + the message text, + prior messages in the current session if within the resume window (§8).
- **Periodic checkup** → + every event published since the last cursor (§7), even if the batch is empty — a checkup always runs regardless of whether anything happened, because time-based directives ("every morning...") have no corresponding event at all. Deputy is expected to consult its own journal (§10) to avoid re-doing a same-day task on every tick.
- **Urgent fast path** → + the one triggering event, run immediately rather than waiting for the next checkup tick.

## 5. Execution engine

**Decided: shell out to the `claude` CLI in headless/print mode**, not the Agent SDK in-process. Per invocation:

1. Call `fetchRegistry` for the live chamber list; write a temp `.mcp.json` with one `type: "http"` MCP server entry per active chamber (`url: <mcpUrl>`, header `X-Congress-Internal-Token`) — same registry lookup Automation Chamber already does, just every chamber instead of one resolved target.
2. Spawn:
   ```
   claude -p "<assembled prompt>" \
     --mcp-config <tmp file> \
     --output-format stream-json \
     --allowedTools "mcp__*" \
     --dangerously-skip-permissions \
     [--resume <sessionId>]
   ```
3. Stream-parse the JSON events into the audit log (§10) as they arrive — every tool call, its arguments, and its result — and capture the final assistant message as the run's outcome / chat reply.

One non-negotiable detail:

- **`--allowedTools "mcp__*"` restricted to the MCP namespace, explicitly excluding Claude Code's built-in Bash/Read/Write/Edit/WebFetch tools.** Without this, "call all functions" silently becomes "root shell on the production VPS," which is a categorically bigger blast radius than "every Chamber's MCP tool" and not what was asked for. Chamber↔Chamber access stays MCP-mediated, same as Automation Chamber, even fully unrestricted.

**Revised (was originally Decided the other way): auth defaults to the owner's own Claude subscription, not a dedicated Console API key.** The supported mechanism for an unattended service is `CLAUDE_CODE_OAUTH_TOKEN` — a one-year token from `claude setup-token`, the officially documented "script/CI, no browser available" path (it prints the token to the terminal rather than writing it to any credential store; generate it on any machine with a browser, not necessarily the one running Deputy, and paste it into Deputy's `.env`). If neither that nor `ANTHROPIC_API_KEY` is set, `claude` falls back to an ambient credential store left by an interactive `claude auth login` for that OS user instead — what local dev typically relies on. Verified directly: this environment's own headless `claude -p --output-format stream-json` run authenticated with zero interactive step via ambient OAuth credentials, and the VPS's own `claude` does the same purely from `ANTHROPIC_API_KEY` when one is set — both paths work with zero prompts once the credential exists. The trade-off, and the reason this was originally decided the other way: subscription usage is metered against the account's own shared rate limits, not a separate pay-per-token pool — Deputy's periodic checkups/chat/urgent runs draw from the *same* quota as the owner's own everyday Claude Code use, unlike a Console key, which is fully isolated and just costs money instead. The owner chose to accept that shared-quota risk over the metered cost. Setting `ANTHROPIC_API_KEY` still switches a given Deputy instance back to isolated, metered Console billing with no other code change. `total_cost_usd` (and therefore the budget cap, §11) is reported by the CLI either way — under subscription auth it's a notional dollar-equivalent, not a real charge, but still a usable throttle on run volume.

Model: proposed default **claude-sonnet-5** for all runs, overridable via Settings if a particular checkup class turns out to need more reasoning depth. Not asked about explicitly — cheap to change later, flagging as a default.

## 6. Trigger model & scheduling

Three ways in, one queue out — all in-process on Deputy's own long-running service, no separate systemd timer:

- **Chat message** → runs immediately.
- **Periodic checkup** → an in-process `setInterval`, same idiom as Automation Chamber's `eventPoller.ts`. Proposed default interval: **20 minutes**, a Settings field, not asked about explicitly.
- **Urgent fast path** → an event with `payload.priority === "urgent"` (existing `PRIORITY_LEVELS` convention) preempts the next scheduled checkup and runs immediately instead of waiting.

All three funnel through a **single in-process job queue, concurrency 1** — never two `claude` subprocesses acting on Congress at once; a chat message arriving mid-checkup queues behind it rather than racing it.

**Decided: fully autonomous during unattended runs.** Periodic and event-triggered runs execute tool calls directly, with no propose-and-wait/approval step — matches the "call all functions now, restrict later" framing. The audit log (§10), kill switch (§11), and budget cap (§11) are the safety net, not a per-action approval gate.

## 7. Events: publishing and consuming

Deputy both listens to *and* publishes events, using the existing generic event log — no special-cased plumbing:

- **Consuming**: the periodic checkup's event batch (§4/§6) comes from polling `GET /congress/events?since=<cursor>` exactly like Automation Chamber's poller, except with no per-event trigger-type filtering — Deputy is simply handed everything since its last cursor and applies judgment itself.
- **Publishing (`deputy.report`)**: reports what it did. **Decided: report only when it took a real action, and tag each report's `payload.priority`** (the existing `PRIORITY_LEVELS` convention). Given the "don't spam me, only surface important stuff" requirement, the noise filter belongs where it already lives for every other Chamber: a Logs Chamber rule with `minPriority: "high"` (or wherever the owner sets it) decides what actually becomes a push notification, while `recordToHistory` can still keep a full lower-priority record for later review without paging anyone. Deputy doesn't need bespoke "how noisy should I be" logic of its own — it just judges each action's significance and sets the field, same contract every publishing Chamber already follows.

## 8. Chat continuity

**Decided: resume within a short idle window.** A chat session ID (the `claude` CLI's own `session_id`) is persisted per open thread; a follow-up message within the idle window (proposed default **30 minutes**, a Settings field) passes `--resume <id>` so context carries ("delete that note" → "actually just rename it" works). After the window lapses, or the owner explicitly starts a new thread (a plain UI affordance — a "new" button — independent of the timeout), the next message starts a fresh session with no carried context.

## 9. Data model

| Table | Purpose |
|---|---|
| `directives` | The Exhibit type from §3. |
| `messages` | Chat log: role, text, session id, timestamp. Not an Exhibit (decided) — this is functional command traffic, not reference material. |
| `deputy_runs` | One row per headless invocation: trigger kind (chat/periodic/urgent), the assembled prompt, the full tool-call transcript (parsed from `stream-json`), final response, ok/error, token usage + estimated cost, duration. This is the audit log §11 depends on. |
| `pollerState` | Last event cursor considered by the periodic checkup — same shape as Automation Chamber's. |

Retention: proposed **prune `deputy_runs`/`messages` older than 30 days** on a sweep, since (unlike `automation_runs`) Deputy's runs aren't naturally grouped under a stable per-entity foreign key to cap by count instead. A Settings field, not asked about explicitly.

## 10. Memory across runs

No bespoke memory store. Deputy already has full MCP access to Notes Chamber, so it maintains its own working journal as an ordinary note ("Deputy's log") the same way the owner would — in keeping with the rest of this codebase's habit of not building new infrastructure where an existing Chamber already does the job. `pollerState`'s cursor prevents re-processing the same event twice; the journal is what lets Deputy avoid re-doing the same *time-based* directive ("every morning...") on every 20-minute tick within the same day.

## 11. Safety & guardrails

Not restrictions on *what* Deputy can call (that's explicitly deferred, see §14) — visibility and an off switch, which is a different axis:

- Full tool-call transcript audit log (`deputy_runs`, §9) — load-bearing given `--dangerously-skip-permissions` is otherwise a black box.
- A **pause/kill switch** in Settings that stops the periodic timer and chat processing immediately.
- A **soft budget cap** (daily $ or token ceiling, proposed default **$10/day**, a Settings field) that auto-pauses Deputy and reports why, so a bad loop can't run up an unbounded bill.
- Concurrency = 1 (§6).
- MCP-only tool restriction (§5) — the one item here that's a genuine capability boundary rather than pure observability, and treated as non-negotiable rather than deferred, since "no raw shell on the VPS" is a different thing entirely from "no restrictions on which Chamber tools it can call."

## 12. Settings & homepage

- **Settings page**: enable/disable, checkup interval, chat idle-window length, budget cap, model override, pause switch, link to run history.
- **Homepage widgets**: a small "message Deputy" quick-box (opens the chat page), and a recent-activity widget reading `deputy_runs` for a lightweight "what has Deputy been doing" glance without opening the audit log.

## 13. Deployment

Port `8018`, standard scaffold-generated systemd unit (`congress-chamber-deputy`, `User=marin`), following `infra/README.md`'s existing "Adding a new Chamber's infra" steps with no changes needed to `sync-deploy.sh`. Checkup interval, idle window, budget cap, model, and retention are all Settings-page fields (§12), not `.env` keys — the new `.env` keys are `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` (§5), both optional and left blank by default. **Verified directly** (not just before building, but against the real VPS, which already has `claude` installed and passwordless-sudo/SSH access set up): `claude` authenticates with zero interactive step from either env var when one is set. Production setup is then just pasting a `claude setup-token` token into the VPS's `services/chamber-deputy/.env` as `CLAUDE_CODE_OAUTH_TOKEN` — no interactive step has to happen on the VPS itself, since the token is generated elsewhere and copied in like any other secret. Until that's done, Deputy will report `errorMessage: "Invalid API key"`-shaped failures on every run — nothing else Congress-side depends on it.

## 14. Explicitly deferred (not v1)

- **Voice input.** Dropped per discussion — text only for now. If revisited, needs a speech-to-text dependency (Anthropic has none) regardless of channel; `MediaRecorder` in the PWA (works on iOS Safari, unlike the Web Speech API) uploading to a transcription endpoint is the likely shape.
- **Per-tool restriction system.** Deputy currently gets `mcp__*` — every tool on every Chamber. An allow/deny list (by chamber, by tool name pattern, maybe by directive) is future work once trust is established, not v1.
- **`ask_deputy` delegation tool / any MCP tools Deputy exposes.** Deferred per §2 — revisit once the rest of this design has run for a while without surprises.
- **Directive self-editing via chat.** A chat-only "remember to always do X" path that creates a Directive is plausible later; not building it now, and explicitly never wiring directive edits into unattended (periodic/event) runs even later, per §3's reasoning.
- **Self-hosted STT**, if voice comes back and hosted API cost/latency becomes a problem.

## 15. Open questions for you

A few things I picked reasonable-sounding defaults for above, flagged as Settings fields specifically so they're cheap to override — but if any of these are obviously wrong, better to fix now:

1. Checkup interval default of 20 minutes, chat idle-window of 30 minutes, budget cap of $10/day, model default Sonnet 5 — any of these off?
2. `deputy_runs`/`messages` retention of 30 days — too long, too short, or should it not auto-prune at all (keep everything, storage is cheap for text)?
3. Do you already have concrete Directives in mind that should exist from day one (e.g. specific morning checks, specific event reactions), or is this a "build it empty, populate it as you go" launch?
