# GitScope Milestone 7: Portfolio & Release Polish — Audit Report

**Date:** October 30, 2026  
**Audited Commit:** `4adbc0d` (`perf(api): optimize recursive commit graph query` on top of `0ab4299`)  
**Repository State:** Clean working tree, 0 uncommitted changes.

---

## 1. Executive Summary & Baseline Verification

This audit evaluates GitScope against professional software engineering portfolio standards, focusing on usability, visual consistency, documentation quality, reproducible local setup, and reliability during live demonstrations.

### Verification Matrix Baseline

All five monorepo verification commands were executed from the repository root:

| Command                     | Exit Code | Status | Details                                                                                                                                                                                           |
| :-------------------------- | :-------: | :----: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd run format:check` |  **`0`**  |  PASS  | All files adhere to Prettier standards.                                                                                                                                                           |
| `pnpm.cmd run lint`         |  **`0`**  |  PASS  | `tsc --noEmit` passed on `@gitscope/shared`, `@gitscope/api`, and `@gitscope/web`. _(Note: Lint script runs TypeScript checks; ESLint is not installed in the workspace)._                        |
| `pnpm.cmd run typecheck`    |  **`0`**  |  PASS  | 0 TypeScript compilation or diagnostic errors.                                                                                                                                                    |
| `pnpm.cmd test`             |  **`0`**  |  PASS  | **20 test files passed (100%), 130 tests passed** (0 failing, 0 flaky):<br>• `@gitscope/shared`: 1 file, 6 tests<br>• `@gitscope/web`: 2 files, 7 tests<br>• `@gitscope/api`: 17 files, 117 tests |
| `pnpm.cmd run build`        |  **`0`**  |  PASS  | Shared packages compiled with `tsc -b`; Next.js 15 production build compiled successfully in 5.6s with static and dynamic routes.                                                                 |

---

## 2. Current Implementation Status

### Monorepo Architecture

- **Workspace Tooling:** `pnpm` workspaces with strict TypeScript project references (`tsc -b`).
- **`@gitscope/shared`**: Pure TypeScript contracts and Zod schemas defining DTOs for repositories, commits, file history, graph ancestry DAGs, activity metrics, hotspots, and co-changes.
- **`@gitscope/api`**: Fastify 5 REST API, `better-sqlite3` running in WAL mode with relational foreign key enforcement, safe `child_process.execFile` Git CLI runner, streaming log parser, idempotent importer, and analytics engine.
- **`@gitscope/web`**: Next.js 15 App Router, React 19, Tailwind CSS, Lucide icons, `@xyflow/react` commit graph visualization, and Recharts analytics dashboards.

### Core Feature Inventory

1. **Repository Lifecycle**: Register local repository by path (validated against `ALLOWED_REPOSITORY_ROOTS`), background analysis triggering, real-time polling, and idempotent re-analysis.
2. **Commit Explorer**: Deterministic cursor-based pagination (`author_time DESC, hash DESC`), filtering by author, path, and date range.
3. **Interactive Commit Graph**: Bounded ancestry DAG layout via topological lane assignment, rendered with `@xyflow/react` using SVG curved links, ref badges, and mini-map.
4. **Commit Detail Drawer**: Metadata inspector showing author, committer, date, parent hashes, ref tags, and full file change list with additions/deletions/renames.
5. **Analytics & Insights Dashboard**:
   - Time-series commit activity volume and distinct contributor trends (day, week, month intervals).
   - Contributor ranking with identity normalization.
   - File hotspot analysis ranking files by modification frequency and churn.
   - File co-change coupling mining with canonical pair ordering and combinatorial safety ceilings (`COCHANGE_MAX_FILES_PER_COMMIT = 200`).

---

## 3. Real-World Product UX Audit

Reviewing the end-to-end user workflows revealed several usability friction points:

### Critical & High-Priority UX Issues

1. **UX-1: Disruptive Browser `alert()` Dialogs**
   - **Location:** `apps/web/src/app/page.tsx` (line 85) and `apps/web/src/app/repositories/[id]/page.tsx` (line 148).
   - **Problem:** If repository analysis fails, the UI calls `alert(err.message)`. Native browser alert dialogs block the main thread, look unpolished, and are considered poor UX in modern web applications.
   - **Remediation:** Replace native `alert()` calls with inline error banners and toast notifications.

2. **UX-2: First-Time Launch Cold-Start Friction**
   - **Location:** `apps/web/src/app/page.tsx` (Empty State).
   - **Problem:** When launching the app for the first time, `repos` is empty. The form instructs the user to enter a path within `ALLOWED_REPOSITORY_ROOTS` (default: `./sample-repositories`). However, `./sample-repositories` does not exist on disk, and no sample repository is provided. A new evaluator or interviewer is immediately blocked unless they manually create a directory and run `git init`.
   - **Remediation:**
     - Provide an automated sample fixture generator (`scripts/create-demo-repo.js` / `pnpm demo:setup`) that synthesizes a realistic repository with multiple branches, tags, merges, and file churn.
     - Add an interactive "Quick Demo" button or guided quick-start card on the empty state.

3. **UX-3: Broken Navigation Link from Analytics to Commit Explorer**
   - **Location:** `apps/web/src/app/repositories/[id]/analytics/page.tsx` (lines 222–228).
   - **Problem:** On the Analytics page, the header provides two navigation buttons: "Interactive Graph" and "Commit Explorer". Both buttons link directly to `/repositories/${repoId}`. However, `/repositories/${repoId}` hardcodes `useState<'graph' | 'commits'>('graph')` without reading URL search parameters. As a result, clicking "Commit Explorer" lands the user on the Graph view instead of the Commit list.
   - **Remediation:** Support `?view=commits` and `?view=graph` in the URL query string, syncing tab state bidirectionally.

4. **UX-4: Commit Detail Drawer Accessibility & Dismissal Gaps**
   - **Location:** `apps/web/src/app/repositories/[id]/page.tsx` (lines 445–456).
   - **Problem:** The drawer overlay does not close when clicking the backdrop, and pressing the `Escape` key does nothing. The user is forced to aim for the small `X` icon.
   - **Remediation:** Add backdrop click handler and a global `Escape` keyboard listener to dismiss the drawer cleanly.

5. **UX-5: Visual Palette Inconsistency (Zinc vs Neutral)**
   - **Location:** `apps/web/src/components/graph/commit-graph.tsx` and `commit-node.tsx`.
   - **Problem:** The shell and other pages use Tailwind's `neutral-*` grayscale palette (`neutral-800`, `neutral-900`, `neutral-950`), whereas the graph component uses `zinc-*` (`zinc-800`, `zinc-900`, `zinc-950`). This creates a visible mismatch in dark-mode background tones and borders.
   - **Remediation:** Unify all graph components to the `neutral-*` palette.

6. **UX-6: Fixed Graph Height Causes Viewport Overflow on Laptop Displays**
   - **Location:** `apps/web/src/components/graph/commit-graph.tsx` (line 172).
   - **Problem:** The graph container has a hardcoded height of `h-[750px]`. Combined with the header and repo metadata bar, the total height exceeds 950px, forcing vertical scrolling on standard 1080p and 1366x768 screens to reach controls.
   - **Remediation:** Use responsive height `h-[calc(100vh-240px)] min-h-[550px]`.

7. **UX-7: Missing Analysis Polling on Repositories List Page**
   - **Location:** `apps/web/src/app/page.tsx`.
   - **Problem:** When triggering analysis from the home page, the card status briefly updates, but no polling loop exists. The status badge stays on "running" or fails to show completion until the user manually refreshes the page.
   - **Remediation:** Add lightweight polling on the home page when any repository has status `running` or `queued`.

---

## 4. Documentation & Presentation Audit

### Gaps Identified

1. **Root `README.md`**:
   - Needs executive-level portfolio framing: problem statement, clear design principles (local-first, deterministic, privacy-preserving), and key features.
   - Lacks embedded Mermaid architecture diagrams illustrating the client-server-storage pipeline.
   - Lacks an updated performance benchmark table reflecting the 902x `CROSS JOIN` optimization.
   - Lacks a concrete demonstration walkthrough for reviewers.

2. **`docs/architecture.md`**:
   - Section 5.3 displays the pre-optimization `JOIN` query instead of the verified `CROSS JOIN` query.
   - Section 2 references `apps/web/src/lib/api-client.ts`, whereas the actual file is `apps/web/src/lib/api.ts`.
   - Needs a dedicated Mermaid sequence diagram illustrating the recursive ancestry traversal mechanics.

3. **`docs/security.md`**:
   - References outdated file names: `apps/api/src/git/repo-validator.ts` (actual: `path-validator.ts`) and `apps/api/src/git/git-runner.ts` (actual: `runner.ts`).

4. **Missing Demo Guide (`docs/demo.md`)**:
   - Evaluators currently have no guided script showing which commands to run, which repositories to import, and which views to highlight.

---

## 5. Build, Setup & Reliability Risks

| Risk Area                          | Severity | Root Cause                                                                                   | Impact                                               | Mitigation Strategy                                                                |
| :--------------------------------- | :------: | :------------------------------------------------------------------------------------------- | :--------------------------------------------------- | :--------------------------------------------------------------------------------- |
| **Missing Sample Repo Directory**  |   High   | `.env.example` points to `./sample-repositories`, but the directory is not committed to git. | First-time registration fails with `PATH_NOT_FOUND`. | Create `sample-repositories/.gitkeep` and a turnkey script `pnpm demo:setup`.      |
| **Port Conflicts (3000 / 4000)**   |  Medium  | Next.js defaults to 3000, Fastify to 4000. If either is occupied, startup fails.             | Developer confusion during multi-service testing.    | Document port override options clearly in README and handle EADDRINUSE gracefully. |
| **Windows Process Spawn Warnings** |   Low    | `git.exe` emits `LF will be replaced by CRLF` warnings on stdout/stderr during test runs.    | Clutters test logs.                                  | Harmless on Windows, but document as expected OS behavior.                         |

---

## 6. Recommended Improvements Ranked by Priority

### Priority 0 — Critical Usability & Demo Blockers

1. **Turnkey Demo Setup Script**: Create `scripts/setup-demo-repo.js` and add `pnpm demo:setup` to root `package.json`. This script programmatically initializes a rich, realistic Git fixture in `./sample-repositories/gitscope-demo` with multiple authors, branches (`feature/auth`, `bugfix/tokens`), merge commits, tags (`v0.1.0`, `v1.0.0`), and file changes.
2. **Replace `alert()` with Inline Alerts**: Implement professional error state indicators in `apps/web/src/app/page.tsx` and `repositories/[id]/page.tsx`.
3. **URL Tab Synchronization**: Read and update `?view=commits` vs `?view=graph` on `/repositories/[id]` to fix navigation from Analytics.

### Priority 1 — Visual & Interaction Polish

4. **Color Palette Alignment**: Replace all `zinc-*` classes with `neutral-*` in `commit-graph.tsx` and `commit-node.tsx` for consistent dark-mode styling.
5. **Drawer Keyboard & Backdrop Handling**: Add `Escape` key dismissal and backdrop click-to-close on the commit details drawer.
6. **Responsive Graph Viewport**: Adjust commit graph height to `calc(100vh - 240px)` with a `min-h-[550px]` fallback.
7. **Home Page Analysis Polling**: Poll analysis status on `/` when repos are in `running` or `queued` state.

### Priority 2 — Portfolio Documentation & Demo Guide

8. **Comprehensive `README.md` Overhaul**: Add problem statement, Mermaid diagrams, performance benchmarks, technology rationale, setup instructions, and roadmap.
9. **Documentation Alignment**: Fix file paths and update the recursive query plan in `docs/architecture.md` and `docs/security.md`.
10. **Dedicated Demo Script (`docs/demo.md`)**: Provide step-by-step demonstration instructions for portfolio reviewers.

### Priority 3 — Testing & Verification

11. **Demo Fixture Test**: Add integration test verifying that `pnpm demo:setup` creates a valid Git repository that imports cleanly into GitScope without errors.
12. **Full Monorepo Re-verification**: Verify format, lint, typecheck, tests, and production build exit with code `0`.
