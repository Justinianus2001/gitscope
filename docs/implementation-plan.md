# GitScope Implementation Plan

**Product:** GitScope  
**Status:** In Progress (Milestone 0 Completed, Milestone 1 In Progress)  
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

### Milestone 2: Git Adapter & Importer (Pending)

- [ ] Safe Git process execution wrapper (`runner.ts`).
- [ ] Path canonicalization & security validation (`ALLOWED_REPOSITORY_ROOTS`).
- [ ] Structured Git parser for log, refs, and numstat with NUL delimiter support (`parser.ts`).
- [ ] In-process background analysis coordinator and transactional importer (`importer.ts`).
- [ ] Fixture repositories and integration tests.

### Milestone 3: Commit Explorer & Web Foundation (Pending)

- [ ] Repository endpoints (`POST /api/repositories`, `GET /api/repositories`, `POST /api/repositories/:id/analyze`, `GET /api/repositories/:id/analysis`).
- [ ] Commit endpoints with cursor pagination and filters (`GET /api/repositories/:id/commits`, `GET /api/repositories/:id/commits/:hash`, `GET /api/repositories/:id/files/:path/history`).
- [ ] Next.js frontend setup with repository list, import dialog, and commit explorer table/detail views.

### Milestone 4: Interactive Commit Graph (Pending)

- [ ] Bounded graph endpoint (`GET /api/repositories/:id/graph`).
- [ ] React Flow graph component with branch/tag ref badges and merge commit distinctions.
- [ ] Graph selection and commit detail sync.

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

---

## 5. Next Steps

1. Begin Milestone 2: implement Git execution wrapper (`runner.ts`) with argument arrays, timeouts, output limits, and path canonicalization.
2. Implement structured Git log and numstat parser (`parser.ts`) with NUL-delimiter handling.
3. Implement repository ingestion service (`importer.ts`) and create Git test fixtures.
