# GitScope Implementation Plan

**Product:** GitScope  
**Status:** In Progress (Milestones 0, 1, 2, and 3 Completed)  
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

### Milestone 4: Interactive Commit Graph (Next)

- [ ] Bounded graph endpoint (`GET /api/repositories/:id/graph`).
- [ ] Topological sorting and coordinate assignment utility.
- [ ] React Flow interactive commit ancestry graph with branch and tag ref badges.
- [ ] Node selection syncing with commit detail panel.

### Milestone 5: Analytics & Insights (Pending)

- [ ] Commit activity aggregation (`GET /api/repositories/:id/activity`) with day/week buckets and zero-fill.
- [ ] File hotspot calculations (`GET /api/repositories/:id/hotspots`).
- [ ] Co-change pair mining (`GET /api/repositories/:id/co-changes`) with safety threshold.
- [ ] Analytics dashboard UI with Recharts.

### Milestone 6: Reliability, Hardening & Release (Pending)

- [ ] Incremental re-analysis & rewritten history handling.
- [ ] End-to-end testing with Playwright.
- [ ] Documentation (`docs/architecture.md`, `docs/metrics.md`, `docs/benchmark.md`, `README.md`).
- [ ] Performance profiling and benchmark report.

---

## 4. Known Issues & Limitations

- Scripts on Windows PowerShell require `.cmd` extensions (e.g. `pnpm.cmd`) when execution policies restrict `.ps1` invocations.
- Native binary builds for `better-sqlite3` require prebuild installation on Windows environments where build scripts are restricted by default in pnpm 10. `onlyBuiltDependencies` is configured in `package.json`.
- Browser-based Next.js applications cannot directly access the local filesystem due to standard browser sandboxing; repository registration must always be validated through the local Fastify API.

---

## 5. Next Steps

1. Begin Milestone 4: implement `GET /api/repositories/:id/graph?ref=...&limit=300` bounded ancestry endpoint.
2. Implement topological graph layout generator.
3. Install and integrate `@xyflow/react` (React Flow) in `apps/web` for interactive commit graph visualization.
