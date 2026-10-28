# Database Migrations

Schema migrations are registered in `src/main/migrations/index.ts` and recorded in `schema_migrations`. Each migration runs once inside a SQLite transaction.

| Version | Name | Purpose |
|---|---|---|
| 1 | `library_scope_v1` | Stable workspaces, library exclusions and scoped indexes |
| 2 | `conversations_v1` | Conversations, messages, runs, events, tool calls, sources and artifacts |
| 3 | `operations_journal_v1` | Crash-recoverable file/DB operation journal |
| 4 | `legacy_agent_links_v1` | Links legacy Work tasks to unified conversations/runs |
| 5 | `conversation_event_cursor` | Monotonic conversation replay cursor spanning multiple runs |
| 6 | `interrupted_run_state` | Rebuilds run status constraints while preserving all dependent records |
| 7 | `active_library_order` | Partial index for responsive scoped library ordering |
| 8 | `paper_source_kind` | Identifies generated record-only title pages and requeues real PDFs without chunks |

Each registered migration carries a SHA-256 checksum recorded in `schema_migrations`; changing an already applied migration is rejected. Legacy tables without the checksum column are upgraded and backfilled once. Repeated initialization, WAL-inclusive legacy backup through `VACUUM INTO`, checksum-drift rejection, and failed-migration rollback/retry are covered by Electron tests.

Migration 008 recognizes CSPAPER's generated title-page PDF by its exact structural signature (794px-wide, DCTDecode-only single-page layout), not by file size alone. It preserves real one-page PDFs, marks generated title pages as `source_kind='record'`, and requeues full-text PDFs that have no chunks. On a copy of the current 105-item user library it classified **91 records and 14 PDFs**; all 14 PDFs already had chunks.

Legacy library databases are backed up with `VACUUM INTO` before the scoped library migration. Do not add ad-hoc `CREATE TABLE` calls in feature modules; add and register a migration.
