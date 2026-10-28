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

Retrieval is scoped by workspace and exact context objects. Collections expand to member IDs; record-only Zotero items produce bounded metadata sources; real PDFs without chunks use page-one evidence and are requeued. Sources persist paper ID, document version, locator and snippet. The renderer warns when the source stamp differs from the current file.

`models/provider.ts` owns SDK transport and error normalization. Settings resolve models by `profileId + modelId`, snapshot capabilities and reasoning level into each run, and never persist credentials in conversation records. AI SDK v7 system messages are converted to top-level `instructions`.

## Library and operation flow

Filesystem discovery runs in a worker, reports progress, and can be terminated through an AbortSignal. Reconciliation commits at most 160 records per batch, yields between batches, and rechecks row stamps so user edits are not overwritten. Rebuilding an index clears only rows in the current `active_papers` workspace; other libraries retain chunks, FTS rows and paper vectors.

Metadata, note and binary PDF writes pass through `runFileOperation()`:

```text
record before/after digests + backup -> replace files -> commit DB -> mark committed
```

A failed commit marks the operation failed and leaves evidence. At startup, pending operations become `rolled_back`, `needs_review`, or `conflict`; startup code never assumes success. Zotero PDF repair uses deterministic operation IDs, exact Zotero keys and preserved pre-replacement backups. OpenAccess repair first queries OpenAlex in read-only mode, then downloads only user-selected public-HTTPS OA PDFs after redirect, size and PDF-header validation; replacement follows the same journaled operation path.

## Verification

`npm run check` performs typecheck, Electron core regression, production build, lifecycle regression, UI regression and both benchmarks. UI tests launch the actual Electron renderer with isolated files and a mock model service. They include the fixed three-paper research flow, exact citation opening, version-change warning, source boundaries, graph zoom, pane resizing, restart/follow-up and 600-message history. `npm run dist:win`, `npm run test:installer`, packaged-app UI and real Agnes model tests are required for a release candidate. GitHub Actions CI must pass after push before a tag/release is promoted.
