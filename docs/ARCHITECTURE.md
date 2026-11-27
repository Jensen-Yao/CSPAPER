# CSPAPER Architecture

CSPAPER is an Electron, React, SQLite desktop research workspace organized in four layers:

1. **Renderer surfaces** render library, reader, compare, notes, Work and chat views. They never own authoritative run state; they subscribe to persisted conversations through the shared store.
2. **Preload contract** exposes typed `window.api` methods. Chat uses structured requests and `chat:event`, not renderer-owned request IDs.
3. **Main services** own workspaces, conversations, model runs, retrieval, citations, tools and file operations. IPC modules validate inputs, call services and return results.
4. **Storage** consists of SQLite plus Markdown/CSL/PDF files. Markdown remains the metadata source of truth; tracked migrations and the operation journal govern schema and multi-representation writes.

## Chat flow

```text
ChatView / SidePanel / TaskChat / legacy Work
  -> window.api.chat
  -> ipc/chat.ts
  -> ChatRepository + ChatRuntime
  -> provider + retrieval/tools
  -> chat_messages / chat_runs / chat_run_events / tool calls / sources / artifacts
```

Legacy Work tasks are linked to a conversation and mirrored into `chat_run_events` for compatibility. New Work submissions use the unified act runtime directly: selected papers/collections become context refs, model plans are validated, risky tools pause for approval, and artifacts remain linked to runs. The legacy Work API is a compatibility facade only. Reader question, selection translation and full-page translation also use the unified runtime.

The full, sidebar and task surfaces share `conversation-store.ts`, `ChatWorkspace` and `MessageList`. Long lists use measured virtual rows, history pagination and an explicit new-message action when the user is reading earlier content.

## Evidence and model layer

When exactly one PDF is in focus, retrieval switches to full-text mode: a compact metadata source followed by one source per page (every page when the paper fits a 48k-character budget, otherwise the opening, section starts, the ending and the pages most relevant to the question, selected by `selectContextPages`). Hybrid chunks only add pages the window did not include. Web context refs whose snippet is a bare search result are enriched by reading the page body, and URLs pasted into a question are read as well (`enrichWebSources`).

A turn that carries no context objects inherits the nearest ancestor run's context in the same conversation unless `inheritContext` is false; the resolved snapshot is persisted on the run with a `context_inherited` diagnostic.

### Ask-mode tools

Ask runs may call read-only tools before answering (`ASK_READ_TOOLS`: paper.read, library.search, library.list, web_fetch, web_search, research.search_web, citation.format, note reads). The ask prompt appends a JSON tool protocol; when the model answers with a single JSON object `{tool,args}` the runtime executes it through the same `ToolExecutor` (read-only permission), feeds the observation back as a user message and asks again, up to four rounds. Tool calls, sources added by tools and events are persisted exactly like act runs, so every surface shows the same timeline.

### Act continuation

After the initial plan (and its single failure revision) completes, the planner is asked whether more steps are needed (`plannerContinuationPrompt`). Returned steps are validated, filtered against the stable `tool|args` keys of already executed steps, appended with a `plan.updated` event (`reason: 根据执行结果追加步骤`) and executed. The loop ends on an empty list, invalid output, no fresh steps, 30 executed steps or 6 rounds; approval pauses inside appended steps resume through the existing plan/revision mechanism.

### Background jobs and recorded extraction

`chat/jobs.ts` is the single model entry point for everything that is not a conversation turn: structured extraction (deep reading, comparison cells, synthesis), import metadata, reference parsing and the compatibility planner. Jobs are recorded runs in hidden `work`+`ask` conversations (excluded from lists), share the Paper model binding, honor caller cancellation and a timeout, and stream `message.delta` events. Translation without a configured model runs through the `free:translation` binding inside the normal runtime.

### Network and web reading

`net.ts` is the single outbound path: Electron `net.fetch` (system proxy by default, optional `proxyUrl`), public-HTTPS-only URLs (`net-guard.ts`, shared with OpenAccess repair), per-hop redirect validation, bounded time (20s default) and size (20MB), readable failure reasons and an optional built-in-browser cookie session (`persist:cspaper-web`). `web-reader.ts` turns HTML into Markdown (Readability + Turndown with citation meta tags) and PDFs into page-marked text, caching snapshots in `web_snapshots` (migration 012). `web-search.ts` aggregates Bing, DuckDuckGo, Semantic Scholar, arXiv, PubMed plus the Crossref/OpenAlex translator scripts with DOI/URL deduplication. `web-import.ts` imports any link or rendered DOM (PDF → library, otherwise a record from page metadata); site translator scripts remain an enhancement.

Retrieval is scoped by workspace and exact context objects. Collections expand to member IDs; record-only Zotero items produce bounded metadata sources; real PDFs without chunks use page-one evidence and are requeued. Sources persist paper ID, document version, locator and snippet. The renderer warns when the source stamp differs from the current file.

`models/provider.ts` owns SDK transport and error normalization. Settings resolve models by `profileId + modelId`, snapshot capabilities and reasoning level into each run, and never persist credentials in conversation records. AI SDK v7 system messages are converted to top-level `instructions`.

## Library and operation flow

Filesystem discovery runs in a worker, reports progress, and can be terminated through an AbortSignal. Reconciliation commits at most 160 records per batch, yields between batches, and rechecks row stamps so user edits are not overwritten. Rebuilding an index clears only rows in the current `active_papers` workspace; other libraries retain chunks, FTS rows and paper vectors.

Metadata, note and binary PDF writes pass through `runFileOperation()`:

```text
record before/after digests + backup -> replace files -> commit DB -> mark committed
```

A failed commit marks the operation failed and leaves evidence. At startup, pending operations become `rolled_back`, `needs_review`, or `conflict`; startup code never assumes success. Zotero PDF repair uses deterministic operation IDs, exact Zotero keys and preserved pre-replacement backups. OpenAccess repair first queries OpenAlex in read-only mode, then downloads only user-selected public-HTTPS OA PDFs after redirect, size and PDF-header validation; replacement follows the same journaled operation path.

## Research hub, projects and tasks

The Paper home is the research hub (`ResearchHub`). It owns no storage: on every visit it reads the current workspace through existing APIs (reading positions, focus summary, calendar, standalone notes, conversations) plus the v0.22 project/task APIs, so the hub never shows placeholder data. Quick capture (`Ctrl/Cmd+Shift+N`) writes a standalone note and broadcasts `cspaper:notes-changed`; the command palette searches papers, notes and conversations in parallel.

Projects and tasks live in `research_projects` / `research_tasks` (migration 011) behind `ResearchProjects`, a small main-process service that validates input with shared Zod schemas, enforces workspace ownership for the project, linked paper and linked conversation, and relies on foreign-key cascades when a project is deleted. Cross-view navigation uses DOM events (`cspaper:open-note`, `cspaper:open-conversation`, `cspaper:work-open-projects`, `cspaper:tasks-changed`) so the hub, the Work today pane and the project board stay in sync without a new global store.

## Verification

`npm run check` performs typecheck, Electron core regression, production build, lifecycle regression, UI regression and both benchmarks. UI tests launch the actual Electron renderer with isolated files and a mock model service. They include the fixed three-paper research flow, exact citation opening, version-change warning, source boundaries, graph zoom, pane resizing, restart/follow-up and 600-message history. `npm run dist:win`, `npm run test:installer`, packaged-app UI and real Agnes model tests are required for a release candidate. GitHub Actions CI must pass after push before a tag/release is promoted.
