# GitScope

**Local-First Git Repository Analytics, Interactive Commit Visualizations, and Structural Insights.**

GitScope is a high-performance, developer-centric analysis tool that transforms local Git repositories into rich, interactive historical and architectural intelligence. Operating 100% locally, GitScope gives engineering teams and individual developers deep visibility into codebase evolution without transmitting source code, commit metadata, or credentials to third-party cloud services.

---

## The Problem GitScope Solves

Modern software systems evolve across complex branching topologies, frequent merges, and distributed contributor teams. Understanding this history with standard Git CLI commands (`git log`, `git blame`, `git shortlog`) is painful:

- **Topology blindness:** Complex merges, diverging feature branches, and tag releases are difficult to untangle in a linear terminal output.
- **Hidden coupling:** Files that frequently change together (logical co-change coupling) indicate architectural friction or missing abstractions, but Git CLI provides no built-in way to surface these relationships.
- **Churn hotspots:** Identifying which modules undergo the highest rate of change and churn requires tedious log processing scripts.
- **Privacy & enterprise compliance:** Cloud-based analytics SaaS platforms require uploading proprietary code and history to external servers, violating corporate security policies and IP boundaries.

GitScope solves this by providing **instant, local-first repository intelligence** directly on your workstation: zero cloud dependencies, zero external network traffic, and zero AI/LLM API calls.

---

## Key Features

- **Interactive Commit Ancestry Graph:**
  - Bounded topological DAG visualization powered by `@xyflow/react` (`ReactFlow`).
  - Deterministic lane assignment, branch tracking, merge commit indicators, and release tag badges.
  - Interactive Minimap, smooth pan/zoom controls, and ref selector (switch between default branch, feature branches, and release tags).
- **Accessible Commit Explorer:**
  - Fast, tabular commit browser with real-time author, file path, and UTC date-range filtering.
  - Stable, cursor-based pagination with deterministic tie-breaking.
  - Slide-over commit inspection drawer detailing commit message body, parent hashes, ref tags, and per-file addition/deletion metrics.
  - Full keyboard accessibility with focus trapping, `Escape` key handling, and focus restoration to the triggering row.
- **Contributor Activity Analytics:**
  - Interactive area chart visualizing commit frequency and active contributor volume over time.
  - Contiguous, zero-filled UTC time buckets (`day`, `week`, `month`) powered by Recharts.
  - Contributor leaderboard with normalized email identities and commit share percentages.
- **File Hotspots Detection:**
  - Identifies the most frequently modified modules in the repository.
  - Ranks files by distinct modifying commits, lines added, lines deleted, and last modification timestamp.
- **Co-Change Coupling Mining:**
  - Uncovers architectural dependencies by identifying pairs of files committed together across multiple independent changes.
  - Configurable minimum support threshold ($\ge 2$ commits).
  - Combinatorial safety ceiling: bulk commits touching over 200 files are excluded from quadratic pairing to prevent CPU/memory spikes.
- **Local-First & Privacy-Preserving Architecture:**
  - Operates purely in-process using SQLite (`better-sqlite3`) in WAL mode.
  - Strict filesystem sandboxing against `ALLOWED_REPOSITORY_ROOTS` to prevent symlink escapes and path traversal.

---

## Technology Stack

| Layer                   | Technology           | Version   | Purpose                                           |
| ----------------------- | -------------------- | --------- | ------------------------------------------------- |
| **Monorepo**            | `pnpm` workspaces    | `10.x`    | Multi-package workspace management                |
| **Language**            | TypeScript           | `5.8.2`   | Strict-mode type safety across all packages       |
| **Frontend Framework**  | Next.js (App Router) | `15.2.1`  | Server and client component rendering             |
| **UI Library**          | React                | `19.0.0`  | Reactive component architecture                   |
| **Styling**             | Tailwind CSS         | `3.4.17`  | Consistent dark-theme design system (`neutral-*`) |
| **Graph Visualization** | `@xyflow/react`      | `12.12.0` | Interactive commit ancestry DAG canvas            |
| **Charts**              | Recharts             | `3.10.1`  | Time-series commit activity visualization         |
| **Icons**               | Lucide React         | `0.475.0` | Accessible vector iconography                     |
| **Backend API**         | Fastify              | `5.2.1`   | High-throughput local REST API                    |
| **Persistence**         | `better-sqlite3`     | `11.8.1`  | Embedded synchronous SQLite storage engine        |
| **Schema Validation**   | Zod                  | `3.24.2`  | Shared DTO and request parameter validation       |
| **Testing**             | Vitest               | `3.0.7`   | Monorepo test runner (152 automated tests)        |

---

## Architecture Overview

```mermaid
graph TD
    subgraph Browser ["Web Client (Next.js 15 — Port 3000)"]
        UI[Repository & Commit Views]
        GraphView["Interactive Commit Graph (@xyflow/react)"]
        AnalyticsView["Analytics Dashboard (Recharts)"]
        ApiClient["Typed API Client (apps/web/src/lib/api.ts)"]
        UI --> ApiClient
        GraphView --> ApiClient
        AnalyticsView --> ApiClient
    end

    subgraph Server ["Backend API (Fastify 5 — Port 4000)"]
        Router[Fastify Routes]
        Validator["Path Allowlist & Validator (path-validator.ts)"]
        Runner["Safe Git CLI Runner (runner.ts)"]
        Parser["Streaming Git Log Parser (parser.ts)"]
        Importer["Atomic SQLite Importer (importer.ts)"]
        AnalyticsEngine["Analytics Aggregator (routes/analytics.ts)"]

        Router --> Validator
        Validator --> Importer
        Validator --> AnalyticsEngine
        Importer --> Runner
        Runner --> Parser
        Parser --> Importer
    end

    subgraph Storage ["Local Machine Storage"]
        GitRepo[("Target Local Git Repository (.git)")]
        SqliteDB[("SQLite Database (WAL Mode — better-sqlite3)")]
    end

    ApiClient -->|HTTP / JSON (REST)| Router
    Runner -->|execFile argument array| GitRepo
    Importer -->|Atomic Transactions| SqliteDB
    AnalyticsEngine -->|Indexed Recursive CTEs| SqliteDB
```

---

## Screenshots

<!-- Screenshot placeholder: Interactive Commit Ancestry Graph with Multi-Branch Topology -->

> _Placeholder: Interactive commit ancestry graph showing branch divergence, two-parent merge node, ref badges, Minimap, and zoom controls._

<!-- Screenshot placeholder: Commit Explorer & Slide-Over Inspector Drawer -->

> _Placeholder: Accessible commit explorer table with author search filter, date range picker, and slide-over commit detail drawer._

<!-- Screenshot placeholder: Contributor Activity Over Time Chart & File Hotspots Table -->

> _Placeholder: Analytics dashboard showing chronological commit volume chart, contributor leaderboard, and ranked file hotspots._

<!-- Screenshot placeholder: Structural Co-Change Coupling Analysis -->

> _Placeholder: Co-change coupling table displaying ranked pairs of files frequently modified together in shared commits._

---

## Quick Start

### 1. Prerequisites

- **Node.js**: `>= 20.0.0` (developed and tested with Node.js `v22.22.1`)
- **pnpm**: `>= 9.0.0` (tested with pnpm `10.32.1`)
- **Git CLI**: Installed and available in system `PATH` (`git --version`)

### 2. Clone and Install

```bash
git clone https://github.com/your-username/gitscope.git
cd gitscope
pnpm install
```

### 3. Configure Environment

Copy the example environment configuration:

```bash
cp .env.example .env
```

Ensure `ALLOWED_REPOSITORY_ROOTS` includes the path where your repositories reside (defaults to `./sample-repositories`):

```ini
NODE_ENV=development
API_HOST=127.0.0.1
API_PORT=4000
WEB_PORT=3000
DATABASE_PATH=./data/gitscope.sqlite
ALLOWED_REPOSITORY_ROOTS=./sample-repositories
GIT_COMMAND_TIMEOUT_MS=30000
MAX_GIT_OUTPUT_BYTES=50000000
COCHANGE_MAX_FILES_PER_COMMIT=200
NEXT_PUBLIC_API_URL=http://127.0.0.1:4000
```

### 4. Generate the Deterministic Demo Repository

GitScope provides an automated, idempotent fixture generator that constructs a realistic multi-branch repository under `./sample-repositories/gitscope-demo`:

```bash
pnpm demo:setup
```

This builds a 15-commit repository with 3 contributors, feature branches (`feature/auth-service`, `feature/metrics-pipeline`), a merge commit, release tags (`v0.1.0`, `v0.2.0`, `v1.0.0`), renames, deletions, and co-change pairings.

### 5. Start Development Servers

Open two terminal windows:

**Terminal 1 (Backend API on port 4000):**

```bash
pnpm dev:api
```

**Terminal 2 (Frontend Web on port 3000):**

```bash
pnpm dev:web
```

### 6. Explore GitScope

1. Navigate to **`http://localhost:3000`** in your browser.
2. Under **Register a Local Repository**, enter:
   ```text
   ./sample-repositories/gitscope-demo
   ```
3. Click **Register**. The home page status polling will track the ingestion process.
4. Click **Explore Commits** to inspect the repository history, view the interactive ancestry graph, and open the analytics dashboard.

---

## Performance & Benchmark Highlights

All benchmarks were empirically measured on Windows 11 Enterprise x64 (NTFS, Node.js v22.22.1, SQLite 3.48.0 via `better-sqlite3`). For full methodology and query plans, see [docs/benchmark.md](docs/benchmark.md).

### Measured Operation Latencies

| Operation                           | 100 Commits | 500 Commits | 1,000 Commits | 10,000 Commits | Target SLA |
| ----------------------------------- | :---------: | :---------: | :-----------: | :------------: | :--------: |
| **Database Size on Disk**           |  418.3 KB   |   1.0 MB    |    1.3 MB     |    22.4 MB     |  Bounded   |
| **Cold Initial Import**             |   ~186 ms   |   ~560 ms   |    ~195 ms    |    ~880 ms     | < 5,000 ms |
| **Incremental Import (+5 commits)** |   ~190 ms   |   ~558 ms   |    ~179 ms    |   ~1,005 ms    | < 2,000 ms |
| **Commit Pagination (Median)**      |   4.96 ms   |   2.52 ms   |    3.12 ms    |    3.52 ms     |  < 20 ms   |
| **File History Query (Median)**     |   0.93 ms   |   0.77 ms   |    0.81 ms    |    0.96 ms     |  < 20 ms   |
| **Commit Graph Query (Median)**     |   2.01 ms   |   4.33 ms   |    6.84 ms    |    78.40 ms    |  < 100 ms  |
| **Activity Aggregation (Median)**   |   0.90 ms   |   1.72 ms   |    2.45 ms    |    4.22 ms     |  < 50 ms   |
| **Hotspots Calculation (Median)**   |   1.01 ms   |   1.57 ms   |    2.08 ms    |    5.34 ms     |  < 50 ms   |
| **Co-Change Mining (Median)**       |   2.56 ms   |   5.61 ms   |    8.92 ms    |    18.45 ms    |  < 100 ms  |

> [!NOTE]
> **Commit Graph SQL Optimization:** At 10,000 commits, SQLite's recursive CTE previously took over 32,000 ms due to an unindexed query plan. By introducing a `CROSS JOIN` ordering constraint (`FROM ancestry a CROSS JOIN commit_parents cp ...`), the execution plan forces index `idx_commit_parents_lookup` (`repo_id, commit_hash, parent_order`), reducing raw database execution time to **~35 ms** and end-to-end HTTP response latency to **~78 ms**.

---

## Testing & Quality Assurance

GitScope maintains rigorous test coverage spanning unit, integration, benchmark, security, and user-flow tests.

```bash
# Run the complete test suite (152 tests across 22 test files)
pnpm test

# Run TypeScript type validation across all workspaces
pnpm typecheck

# Run workspace linter (executes tsc --noEmit per package)
pnpm lint

# Check code formatting with Prettier
pnpm format:check

# Produce optimized production bundles
pnpm build
```

### Quality Gate Summary

- **Unit & Schema Tests:** Validate all Zod DTO contracts, query pagination boundaries, date sanitization, and layout calculations.
- **Security Tests:** Verify path traversal defense, symlink boundary escape rejection, error sanitization, and parameter injection defense.
- **Scalability Benchmarks:** Validate execution times and disk footprints across synthetic repositories (100 to 10,000 commits).
- **Integration Tests:** Verify full end-to-end ingestion, status polling, and analytics calculations against deterministic Git repositories.

---

## Security & Privacy Design

1. **Local-First Boundary:** GitScope runs locally on `127.0.0.1`. It connects to no external servers, collects no metrics or telemetry, and requires no third-party accounts or cloud authentication.
2. **Path Sandboxing:** All target paths are checked against `ALLOWED_REPOSITORY_ROOTS`. Paths are canonicalized via `fs.realpathSync.native()` to defeat symlink escapes, relative path traversals (`../`), and Windows 8.3 short-name bypasses.
3. **Safe CLI Invocation:** Git operations execute exclusively via `child_process.execFile` with discrete argument arrays. Shell interpolation (`child_process.exec`, `{ shell: true }`) is strictly prohibited.
4. **Information Disclosure Prevention:** Sensitive host filesystem paths matching the target directory are sanitized to `[repo_root]` in all error responses and logs.
5. **Zero Dynamic SQL:** All database statements use SQLite parameterized placeholders (`?`). String concatenation into SQL queries is forbidden.
6. **Combinatorial Safety Limits:** Co-change mining enforces `COCHANGE_MAX_FILES_PER_COMMIT` (default: 200) to protect against quadratic pair explosion from large bulk commits.

For complete threat modeling and mitigation proofs, see [docs/security.md](docs/security.md).

---

## Known Limitations

- **Bounded Graph Canvas:** To prevent browser WebGL and DOM rendering stalls on very large histories, the commit graph visualizer bounds ancestry traversal to the most recent 300 commits per ref. The full history remains accessible through the Commit Explorer.
- **Single-User Workspace:** GitScope is designed as an engineer's personal diagnostic workstation tool; it does not include multi-tenant user accounts, team permissions, or RBAC.
- **Windows CLI Process Creation Overhead:** Spawning individual Git CLI processes on Windows NTFS is slower than on Linux ext4/tmpfs (~120ms per process). Synthetic test fixtures at scale are generated via `git fast-import` to avoid process-spawn bottlenecks during benchmarks.

---

## Documentation Index

- [Architecture & Data Flow Documentation](docs/architecture.md)
- [Security Model & Threat Hardening](docs/security.md)
- [Step-by-Step Demo Walkthrough Guide](docs/demo.md)
- [Benchmark Methodology & Performance Data](docs/benchmark.md)
- [Mathematical Metrics Definitions](docs/metrics.md)
- [Milestone 7 Audit Report](docs/milestone-7-audit.md)

---

## Contributing & Development

```bash
# Clone repository
git clone https://github.com/your-username/gitscope.git
cd gitscope

# Install dependencies
pnpm install

# Setup demo fixture
pnpm demo:setup

# Format code
pnpm format

# Run checks before submitting PR
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

---

## License

This project is licensed under the [MIT License](LICENSE).
