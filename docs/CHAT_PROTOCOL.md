# Chat Protocol

## Core objects

- `Conversation`: workspace-scoped chat with `ask` or `act` mode and stable ID.
- `Message`: append-only message with structured `MessagePart` values and optional parent for branches.
- `Run`: one execution attempt, with terminal states `completed`, `partial`, `failed`, `cancelled`, or `interrupted`.
- `RunEvent`: replayable event keyed by `(runId, seq)`, with a separate conversation-wide `cursor`.
- `Source`: immutable evidence snapshot containing paper ID, document version, locator and snippet.
- `ToolCall`: validated arguments, operation ID, result, sources, artifacts and status.

## Submission

A turn sends `conversationId`, stable `clientMessageId`, parent message ID, text, context refs, `modelBindingId + reasoning`, mode, and `promptKind` (`ask` or `translation`). Reader selection and full-page translation persist as unified `ask` runs with the translation prompt. Replaying the same client message ID returns the original run instead of creating a duplicate. `retryTurn` creates a sibling branch from the original user message parent; `editAndResubmit` also creates a sibling branch and never mutates the old message.

## Events

Events are persisted before fan-out. `seq` starts at 1 for each run; `cursor` increases across every run in a conversation. Conversation `afterSeq` requests use the **conversation cursor**, never a run's sequence. Migration 005 assigns cursors to existing events in persisted row order.

`chat.snapshot` reads the conversation, recent messages, their runs/sources/artifacts, and event cursor in one SQLite transaction. The renderer registers a targeted WebContents subscriber before replay. The shared renderer store installs its listener before loading a snapshot, buffers events during loading, discards events already covered by its cursor and reloads on gaps. Main sends chat events only to registered subscribers and removes destroyed WebContents.

The full-screen, reader-sidebar and task conversation surfaces share `conversation-store.ts` through `useSyncExternalStore`. Sources belong to a run and their display order comes from message `sources.sourceIds`. Code, math and existing links are excluded from citation-node transformation.

## Context and evidence boundaries

Context is object identity based: paper ID, selection with page/document version, collection, paper or standalone note, saved search, artifact, or Web URL/title/snippet/version. Cross-workspace refs are rejected into diagnostics. Exact selections and notes become persisted `Source` records before hybrid retrieval.

Retrieval is workspace-scoped and collection refs are expanded to exact member paper IDs. A record-only Zotero item becomes a citable page-one metadata Source and the prompt explicitly forbids inferring full-text conclusions from it. A real PDF without chunks gets a bounded page-one Source and is requeued for indexing. PDF extraction and hybrid retrieval honor AbortSignal and timeouts; cancellation is not swallowed by fallback behavior.

Citation display numbers are per-message. Persisted source IDs remain immutable. The message UI compares the saved source document stamp with the current paper stamp and shows a version-change warning; the citation viewer repeats that warning before locating the stored snippet.

## Tools

Act runs validate generated plans. A failed tool triggers one validated revision, persisted as `plan.updated` with a revision number and reason; revised calls receive distinct IDs so retries cannot replay the failed call. Act runs may pause in `awaiting_approval`. The approval event carries the exact tool call ID, step ID, arguments, impact and reason. Approval covers that persisted call alone; later writes still require their own approval. Successful calls replay their stored result instead of writing again. Rejecting records a cancelled terminal state.

`note.append` retains the existing note, supports a note-content version and carries a stable operation ID. A stale version fails while preserving the file. The same protocol backs text and binary Zotero PDF repair operations.

Tools return `success`, `partial`, `failed`, or `cancelled`; include sources, artifacts and domain changes; and declare read/reversible-write/batch/external/destructive risk. Destructive operations require approval even in automatic mode.

## Prompt ownership

`src/main/chat/prompts.ts` owns ask, act, translation, explain, full-paper, RAG, deep reading, comparison and synthesis prompts. Compatibility functions in `llm.ts` and insight services delegate to these templates instead of maintaining independent system prompts.

## Release gate

Implemented locally: interrupted-run recovery, retry/edit branches, provider-ID model binding, record/collection evidence, version-aware citations, cancellation, migration rollback, real Agnes JSON and the three-paper task. GitHub Actions CI must pass after push before a release tag is promoted.
