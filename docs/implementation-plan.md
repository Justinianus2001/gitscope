# GitScope Implementation Plan

**Product:** GitScope  
**Status:** In Progress (Milestones 0, 1, 2, 3, 4, and 5 Completed)  
**Last Updated:** 2026-10-29

---

## 1. Executive Summary & Workspace Findings

- **Workspace State at Inspection:** Workspace contained only `GitScope_BRD.md` and `GitScope_PRD.md`. Git was not initialized.
- **Environment:**
  - OS: Windows 11
  - Node.js: `v22.22.1`
  - Package Manager: `pnpm` `10.32.1` (`pnpm.cmd`)
  - Git CLI: `2.45.1.windows.1`
- **Architecture Strategy:**
  - Monorepo using `pnpm` workspaces:
    - `packages/shared`: Shared TypeScript types, Zod validation schemas, API contracts.
    - `apps/api`: Fastify API service with SQLite (`better-sqlite3`), strict input validation, safe Git execution wrapper (`child_process.execFile`/`spawn`), deterministic analytics computation.
    - `apps/web`: Next.js frontend with Tailwind CSS, React Flow (commit graph), Recharts (activity/metrics).
  - Persistence: SQLite with strictly enforced foreign keys (`PRAGMA foreign_keys = ON;`), prepared parameterized statements, and transactional batch ingestion.
  - Security: Canonical path validation against `ALLOWED_REPOSITORY_ROOTS`, zero shell interpolation, sanitized error outputs, zero external network leakage.

---

## 2. Document Analysis & Conflict Resolution

| Topic                             | BRD / PRD Context                                                                                  | Resolution                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Persistence Driver**            | "SQLite with Drizzle ORM or parameterized SQL"                                                     | Use `better-sqlite3` with strict parameterized SQL and a migration manager. Provides synchronous, high-performance, deterministic operations without monorepo bundle complexity.                                   |
| **Timestamps**                    | PRD 6.2: "ISO timestamp or integer Unix timestamp, consistently chosen"                            | Standardize on **ISO 8601 UTC strings** (`YYYY-MM-DDTHH:mm:ss.sssZ`). Formats directly into the API contracts, supports lexicographical index ordering in SQLite, and avoids runtime millisecond/second confusion. |
| **Duplicate Repo Registration**   | PRD FR-01: "Duplicate canonical paths return the existing repository or a clear conflict response" | Return HTTP 200 with the existing repository record and `{ isExisting: true }`. Idempotent, safe, and convenient for frontend navigation.                                                                          |
| **Git Ingestion & Missing Stats** | PRD 6.5: "Do not treat unknown additions/deletions as zero"                                        | Store `NULL` in `additions` and `deletions` for binary files, untracked diff sizes, or merge commits where standard numstat is omitted.                                                                            |
| **Co-Change Thresholds**          | PRD FR-08 / Section 16                                                                             | Commits touching more than `COCHANGE_MAX_FILES_PER_COMMIT` (default: 200) files are skipped from quadratic co-change calculations to prevent combinatorial explosion; reported in query metadata.                  |
| **Graph Bounds**                  | PRD FR-05                                                                                          | Bounded queries default to 300 commits. Unbounded rendering is explicitly prohibited.                                                                                                                              |

---

## 3. Milestones & Progress

### Milestone 0: Workspace Reconnaissance & Setup

- [x] Inspect existing workspace files and dependencies.
- [x] Initialize Git repository and `.gitignore`.
- [x] Verify Node.js, pnpm, and Git CLI runtime.
- [x] Create `.env.example` with non-secret defaults.
- [x] Summarize architecture, MVP scope, technical constraints, and resolve ambiguities.

### Milestone 1: Foundation (Initial Portion Completed)

- [x] Workspace structure configured (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `.prettierrc`).
- [x] `@gitscope/shared` package initialized with Zod schemas for config, models, and API DTOs.
- [x] `@gitscope/api` scaffolded:
  - [x] App factory (`buildApp`) with Fastify, CORS, and sensible error handling.
  - [x] Configuration loader with Zod validation.
  - [x] SQLite connection helper (`PRAGMA foreign_keys = ON;`, WAL mode).
  - [x] Database migration engine with initial schema (`repositories`, `analysis_runs`, `commits`, `commit_parents`, `refs`, `file_changes`).
  - [x] Health check endpoint (`GET /api/health`).
  - [x] Unit & integration tests for health check and database initialization.
  - [x] Verification of lint, typecheck, and test commands (100% passing).
  - [x] Root `README.md` and initial setup documentation.

### Milestone 2: Git Adapter & Importer (Completed)

- [x] Safe Git process execution wrapper (`runner.ts`) via `execFile` with argument arrays, explicit `cwd`, timeout, output buffer limit, cancellation, and error sanitization.
- [x] Path canonicalization & security validation (`path-validator.ts`) defending against path traversal, symlink escapes, and arbitrary directory access outside `ALLOWED_REPOSITORY_ROOTS`.
- [x] Structured Git parser for log, refs, and numstat with NUL delimiter support (`parser.ts`) handling renames, binary files, Unicode/spaces in filenames, and merge commits with parent ordering preserved.
- [x] In-process background analysis coordinator and transactional importer (`importer.ts`) with concurrency protection, status tracking, idempotency, and transactional recovery preserving existing records upon failure.
- [x] Test fixture helpers (`fixture-helper.ts`) creating real on-the-fly Git repositories for unit and integration tests.
- [x] 100% passing tests across runner, path validator, parser, and importer (26 tests in `apps/api`, 4 in `packages/shared`, 30 total).

### Milestone 3: Commit Explorer & Web Foundation (Completed)

- [x] Production REST API endpoints:
  - [x] `POST /api/repositories`: register repository with allowlist validation and idempotent duplicate handling.
  - [x] `GET /api/repositories`: list repositories with latest analysis status and commit counts.
  - [x] `GET /api/repositories/:id`: get repository details.
  - [x] `POST /api/repositories/:id/analyze`: asynchronous analysis run with `202 Accepted` and `409 Conflict` concurrency prevention.
  - [x] `GET /api/repositories/:id/analysis`: poll latest analysis status.
  - [x] `GET /api/repositories/:id/commits`: deterministic cursor pagination with tie-breaking (`author_time DESC, hash DESC`), author, path, date range, and branch reachability filters.
  - [x] `GET /api/repositories/:id/commits/:hash`: full commit details with parent hashes, refs, and changed file numstats.
  - [x] `GET /api/repositories/:id/files/:path/history`: file change history across commits, supporting renamed files and path normalization.
- [x] Comprehensive test suite covering repository management, cursor pagination, path traversal defense, and commit details (53 total passing tests).
- [x] Next.js Web Application (`apps/web`):
  - [x] Next.js 15, React 19, Tailwind CSS, Lucide icons.
  - [x] Typed API client (`src/lib/api.ts`) with centralized error handling.
  - [x] Application shell with responsive navigation (`layout.tsx`).
  - [x] Repository dashboard with registration form, analysis trigger, and empty states (`page.tsx`).
  - [x] Repository detail & commit explorer page with filter bar, commit table, cursor pagination, and commit detail drawer showing file diff stats (`repositories/[id]/page.tsx`).
  - [x] Successful static & dynamic production build (`next build`).

### Milestone 4: Interactive Commit Graph (Completed)

- [x] Production Graph & Ref REST API (`apps/api/src/routes/graph.ts`):
  - [x] `GET /api/repositories/:id/graph?ref=...&limit=300`: recursive CTE ancestry query bounded by `limit + 1` to reliably detect history truncation, ordered deterministically by `author_time DESC, hash DESC`.
  - [x] Preserves ordered commit parents (`commit_parents`) and associated branch/tag references (`refs`).
  - [x] Supports explicit branch or tag ref selection, falling back gracefully to repository `default_branch`, first branch, or latest commit.
  - [x] Strict input validation (`UUID_REGEX`, `getGraphQuerySchema`), sanitized errors (`REPOSITORY_NOT_FOUND`, `REF_NOT_FOUND`), and repository isolation.
  - [x] `GET /api/repositories/:id/refs`: endpoint returning all available branches and tags for repo.
  - [x] Comprehensive integration tests in `apps/api/src/__tests__/graph.test.ts` (9 tests covering linear history, branch divergence, multi-parent merge commits, invalid refs, empty repositories, limit bounding/truncation, and repository isolation).
- [x] Standalone Graph Layout Engine (`apps/web/src/lib/graph-layout.ts`):
  - [x] Pure, deterministic function (`computeGraphLayout`) independent of UI components.
  - [x] Topological sort using Kahn's algorithm with priority queue resolving children strictly before parents.
  - [x] Branch lane allocation algorithm tracking active branch paths across forks and multi-parent merge converges.
  - [x] Graceful truncation handling without dangling edges to truncated parents.
  - [x] Unit test suite in `apps/web/src/__tests__/graph-layout.test.ts` (5 tests covering linear paths, merge convergence, disconnected/truncated graphs, and 100% deterministic layout guarantee).
- [x] Interactive Frontend (`apps/web`):
  - [x] `@xyflow/react` integration with custom `CommitNode` component featuring lane color accents, abbreviated commit hash, merge badge, and branch/tag badges.
  - [x] `CommitGraph` component with zoom/pan controls, minimap, background grid, ref/branch selector dropdown, loading skeleton, error banner, and truncation indicator banner.
  - [x] Selection interaction: clicking a commit node opens the existing `CommitDrawer` slide-over view with file diff statistics.
  - [x] Accessible list view fallback allowing seamless toggling between interactive visual graph and tabular commit explorer.
- [x] Total passing test suite across monorepo: 68 tests (100% pass rate).

### Milestone 5: Analytics & Insights (Completed)

- [x] Defined metric formulas, normalization rules, data coverage, and interpretive guidelines in `docs/metrics.md`.
- [x] Production Analytics REST APIs (`apps/api/src/routes/analytics.ts`):
  - [x] `GET /api/repositories/:id/activity`: contiguous zero-filled UTC buckets (`day`, `week`, `month`), commit count, distinct contributors with email normalization, range validation (`INVALID_DATE_RANGE`, `DATE_RANGE_TOO_LARGE`).
  - [x] `GET /api/repositories/:id/hotspots`: ranked files by distinct commit count descending, additions/deletions (treating binary modifications as `NULL`), and last changed timestamp.
  - [x] `GET /api/repositories/:id/co-changes`: mined file co-change pairs with canonical ordering (`pathA < pathB`), self-pair exclusion, minimum support count (`minCount`), and combinatorial safety ceiling (`COCHANGE_MAX_FILES_PER_COMMIT: 200`).
  - [x] Complete integration test suite in `apps/api/src/__tests__/analytics.test.ts` (11 tests covering zero-filling, intervals, bounds, binary files, path traversal rejection, thresholds, and isolation).
  - [x] Synthetic benchmark in `apps/api/src/__tests__/benchmark.test.ts` testing 250-file bulk commit safety exclusion and sub-4ms query latencies.
- [x] Responsive Analytics Dashboard UI (`apps/web/src/app/repositories/[id]/analytics/page.tsx`):
  - [x] Recharts interactive activity area chart with day/week/month aggregation and zero-filled time series.
  - [x] Contributor overview ranking top authors, emails, and contribution percentages.
  - [x] Ranked file hotspots table with churn statistics and path filtering.
  - [x] Co-change coupling table with minCount support selector and large commit exclusion notice.
  - [x] Navigation bar connecting Overview, Commit Explorer, Interactive Graph, and Analytics Dashboard.
- [x] Total passing test suite across monorepo: 84 tests (100% pass rate).

### Milestone 6: Reliability, Hardening & Release (In Progress)

- [x] **Phase 1 — Baseline Audit & Data Correctness (Completed)**:
  - [x] Verified monorepo baseline: 0 formatting warnings, 0 lint errors, 0 typecheck errors, successful production build (`next build` & `tsc -b`).
  - [x] Audited repository re-analysis and edge cases in `apps/api/src/__tests__/reanalysis.test.ts` (8 tests):
    - [x] Incremental updates when new commits are added to existing branches.
    - [x] Newly created branches and tags correctly reflected in refs table.
    - [x] Moved branches or tags updated in refs table `target_hash`.
    - [x] Unreachable/reset commits pruned cleanly upon re-analysis inside transaction (`DELETE FROM commits WHERE repo_id = ?`).
    - [x] No-op re-import idempotency with zero duplicate rows.
    - [x] Aborted/failed imports preserving previous state without data corruption.
    - [x] Deleted or inaccessible repository directories caught gracefully with error status.
    - [x] Concurrent analysis requests rejected with `ANALYSIS_ALREADY_RUNNING` (409 Conflict).
  - [x] Audited analytics correctness against `docs/metrics.md` in `apps/api/src/__tests__/analytics-audit.test.ts` (8 tests):
    - [x] Contiguous zero-filled daily buckets and inclusive timestamp boundaries.
    - [x] Weekly bucketing aligned to Monday and ISO week transitions across year boundaries (e.g. 2025-W53 / 2026-W01).
    - [x] Contributor identity normalization (lowercase trimmed email, display name updated to latest active name, `author_name` fallback).
    - [x] Binary files additions/deletions returning `null` (not 0), and UI rendering `binary` instead of `+0 / -0`.
    - [x] Co-change pair deduplication for multiple edits to the same path within a single commit.
    - [x] Combinatorial safety threshold (`COCHANGE_MAX_FILES_PER_COMMIT`), commit exclusion, and `excludedLargeCommitsCount` reporting.
    - [x] Empty repositories and 0-commit ranges returning clean zero states without errors.
  - [x] Monorepo test suite expanded from 84 to 100 passing tests (100% pass rate).
- [x] **Phase 2 — Security & Reliability Hardening (Completed)**:
  - [x] Audited Git process execution: verified all Git commands are invoked via explicit argument arrays with `options.cwd`, strictly preventing shell interpolation and CLI option injection.
  - [x] Verified path boundaries & traversal defense: `validateRepositoryPath` enforces canonicalization before checking membership within `ALLOWED_REPOSITORY_ROOTS`, rejecting `../`, `..\\`, symlinks escaping roots, and non-git folders.
  - [x] Error sanitization: 500 errors return sanitized `INTERNAL_SERVER_ERROR` without stack traces or SQL internals; background analysis failure sanitizes raw host paths in `errorMessage` (`[repo_root]`).
  - [x] SQLite integrity: verified `PRAGMA foreign_keys = ON;` on all connections, verified cascade deletion of child tables on repository delete, and verified atomic transaction rollback on write failures.
  - [x] Query plan inspection: evaluated `EXPLAIN QUERY PLAN` across hotspots, commit pagination, file history, graph ancestry CTE, and co-change mining; identified missing index on `file_changes(repo_id, old_path)`.
  - [x] Added migration `002_add_old_path_index.sql` enabling SQLite `MULTI-INDEX OR` optimization for renamed file history queries, improving lookup from $O(N)$ commit scans to $O(K \log N)$ indexed lookups.
  - [x] Verified Unicode, spaces, and special characters in Git filenames are parsed and persisted without byte corruption.
  - [x] Created `apps/api/src/__tests__/security.test.ts` (16 tests, 100% pass rate).
  - [x] Monorepo test suite expanded from 100 to 116 passing tests.
- [x] **Phase 3 — End-to-End Tests & Performance (Completed)**:
  - [x] Implemented comprehensive end-to-end user journey test suite in `apps/api/src/__tests__/e2e-journey.test.ts`:
    - [x] Creates realistic multi-branch repository fixture with merge commits, tags, Unicode filenames, binary files, and file renames.
    - [x] Exercises repository registration via `POST /api/repositories`.
    - [x] Triggers analysis and polls status until completion (`POST /api/repositories/:id/analyze`, `GET /api/repositories/:id/analysis`).
    - [x] Verifies repository overview and metadata (`GET /api/repositories/:id`).
    - [x] Verifies cursor-based commit pagination and stable ordering across pages (`GET /api/repositories/:id/commits`).
    - [x] Verifies commit detail view with changed file stats, additions/deletions, and binary file NULL handling (`GET /api/repositories/:id/commits/:hash`).
    - [x] Verifies file rename history tracking through previous paths (`GET /api/repositories/:id/files/:path/history`).
    - [x] Verifies commit graph ancestry DAG bounded retrieval (`GET /api/repositories/:id/graph`).
    - [x] Verifies analytics activity time-series aggregation (`GET /api/repositories/:id/activity`).
    - [x] Verifies file churn hotspots ranking (`GET /api/repositories/:id/hotspots`).
    - [x] Verifies co-change file coupling pairs and large-commit exclusion (`GET /api/repositories/:id/co-changes`).
    - [x] Verifies incremental commit addition and re-indexing synchronization.
    - [x] Verifies history rewrite / `git reset` pruning of orphaned commits upon re-analysis.
    - [x] Verifies empty repository handling and invalid path rejection.
  - [x] Implemented multi-scale performance benchmark suite in `apps/api/src/__tests__/benchmark-scale.test.ts`:
    - [x] Measures cold initial import, no-op re-import, incremental re-import, history rewrite re-import, commit pagination, file history, commit graph, activity aggregation, hotspots, and co-changes on Small (~100 commits) and Medium (~500 commits) repositories.
    - [x] Measures total database disk size including WAL and SHM auxiliary files.
    - [x] Yields event loop execution to prevent vitest worker RPC timeouts during intensive Git generation.
  - [x] Documented empirical benchmarks, test methodology, and query execution plans in `docs/benchmark.md`.
  - [x] Total passing test suite across monorepo: 127 tests (100% pass rate).

- [x] **Phase 4 — Release Readiness & Documentation (Completed)**:
  - [x] Created `docs/architecture.md` detailing system architecture, data flow, ER diagrams, SQLite engine pragmas, and ingestion pipeline.
  - [x] Created `docs/security.md` detailing the threat model, canonical path validation boundary, safe process execution, error sanitization, and relational integrity.
  - [x] Created `docs/benchmark.md` with measured latency tables and query execution plan analysis.
  - [x] Updated `README.md` with documentation index, architecture overview, security model, and benchmarking instructions.
  - [x] Ran full monorepo verification: formatting, linting, typechecks, and complete test suites.

---

## 4. Known Issues & Limitations

- Scripts on Windows PowerShell require `.cmd` extensions (e.g. `pnpm.cmd`) when execution policies restrict `.ps1` invocations.
- Native binary builds for `better-sqlite3` require prebuild installation on Windows environments where build scripts are restricted by default in pnpm 10. `onlyBuiltDependencies` is configured in `package.json`.
- Windows NTFS file operations introduce ~120ms latency per `git commit` process invocation during synthetic fixture creation. Database ingestion and query operations remain sub-5ms.
- Browser-based Next.js applications cannot directly access the local filesystem due to standard browser sandboxing; repository registration must always be validated through the local Fastify API.

---

## 5. Next Steps

1. Review working tree diffs and commit status.
2. Maintain clean, production-ready release state.
