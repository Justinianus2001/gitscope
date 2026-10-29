# GitScope Architecture

GitScope is a local-first, privacy-preserving Git repository analytics application. It operates entirely on the developer's local machine without third-party services, cloud dependencies, external telemetry, or AI/LLM components.

---

## 1. System Overview

```mermaid
graph TD
    subgraph Client ["Browser / Next.js Web App (Port 3000)"]
        UI[React UI Components]
        GraphView[Interactive SVG Commit Graph]
        AnalyticsView[Recharts Analytics Dashboard]
        ApiClient[Typed API Client]
        UI --> ApiClient
        GraphView --> ApiClient
        AnalyticsView --> ApiClient
    end

    subgraph Server ["Fastify REST API (Port 4000)"]
        Router[Fastify Route Handlers]
        AuthZ[Path Allowlist & Validation Boundary]
        GitRunner[Safe Git CLI Runner]
        GitParser[Streaming Git Log Parser]
        Importer[Idempotent SQLite Importer]
        AnalyticsEngine[Analytics & Aggregation Engine]

        Router --> AuthZ
        AuthZ --> Importer
        AuthZ --> AnalyticsEngine
        Importer --> GitRunner
        GitRunner --> GitParser
        GitParser --> Importer
    end

    subgraph Storage ["Local Filesystem & Storage"]
        GitRepo[(Target Git Repository)]
        SqliteDB[(SQLite Database - better-sqlite3)]
    end

    ApiClient -->|HTTP / JSON| Router
    GitRunner -->|child_process.execFile| GitRepo
    Importer -->|Parameterized Transactions| SqliteDB
    AnalyticsEngine -->|Optimized Indexed Queries| SqliteDB
```

---

## 2. Monorepo Structure & Module Boundaries

GitScope is organized as a pnpm workspace monorepo enforcing TypeScript strict mode across all packages:

```text
gitscope/
├── apps/
│   ├── api/                     # Fastify 5 REST API & SQLite persistence
│   │   ├── src/
│   │   │   ├── config.ts        # Environment & configuration validation (Zod)
│   │   │   ├── app.ts           # Fastify application factory & error handling
│   │   │   ├── db/              # SQLite connection, migrations & transactions
│   │   │   ├── git/             # Safe runner, streaming parser & importer
│   │   │   ├── routes/          # REST route controllers
│   │   │   └── __tests__/       # Unit, integration, security & benchmark tests
│   └── web/                     # Next.js 15 frontend application
│       ├── src/
│       │   ├── app/             # App Router pages (layout, dashboard, repo views)
│       │   ├── components/      # UI components (graph, activity, hotspots, co-changes)
│       │   └── lib/             # Typed API client & utilities
├── packages/
│   └── shared/                  # Shared TypeScript contracts & Zod DTO schemas
│       └── src/
│           ├── dto/             # Repositories, Commits, Graph, Analytics schemas
│           └── errors/          # Standardized error codes & structures
├── docs/                        # Architecture, security, metrics, benchmarks & plans
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

### Module Responsibilities & Invariants

1. **`@gitscope/shared`**: Contains zero runtime dependencies other than Zod. Defines the single source of truth for all API request parameters, query filters, and response payloads.
2. **`@gitscope/api`**: Owns all Git command execution and database persistence. Never returns raw stack traces or internal host filesystem paths outside the repository root.
3. **`@gitscope/web`**: Purely consumer of `@gitscope/shared` and the REST API. Contains no direct filesystem or Git access.

---

## 3. Ingestion Pipeline

The ingestion pipeline converts raw Git history into relational SQLite tables deterministically and idempotently.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant API as Fastify API
    participant Runner as Git Runner
    participant Git as Git CLI
    participant Parser as Git Parser
    participant DB as SQLite DB

    User->>API: POST /api/repositories/:id/analyze
    API->>API: Verify no active run for repo_id (409 if active)
    API->>DB: INSERT INTO analysis_runs (status = 'in_progress')

    API->>Runner: runGit(['rev-parse', '--is-inside-work-tree'])
    Runner->>Git: execFile('git', args, { cwd: repoPath })
    Git-->>Runner: 'true'

    API->>Runner: runGit(['for-each-ref', ...])
    Runner->>Git: execFile
    Git-->>Runner: Raw refs output

    API->>Runner: runGit(['log', '--topo-order', ...])
    Runner->>Git: execFile
    Git-->>Runner: Delimited log stream with numstat

    API->>Parser: parseGitLog(output)
    Parser-->>API: Structured CommitRecord[] & FileChangeRecord[]

    API->>DB: BEGIN TRANSACTION
    API->>DB: DELETE FROM commits WHERE repo_id = ? (History rewrite cleanup)
    API->>DB: Bulk INSERT commits, commit_parents, refs, file_changes
    API->>DB: UPDATE analysis_runs (status = 'completed')
    API->>DB: UPDATE repositories (last_analyzed_at = now)
    API->>DB: COMMIT TRANSACTION
    API-->>User: 202 Accepted / Completion polled
```

### Safe Process Invocation

- Process execution uses `node:child_process.execFile` with explicit argument arrays.
- Shell interpolation (`child_process.exec`, shell: true) is strictly forbidden.
- Command execution enforces `GIT_COMMAND_TIMEOUT_MS` (default: 30s) and `MAX_GIT_OUTPUT_BYTES` (default: 50MB) to prevent hung processes and memory exhaustion.
- The working directory `options.cwd` is explicitly pinned to the validated repository path.

### Idempotency & History Rewrites

- Imports are atomic: all writes occur within a single SQLite transaction.
- When re-analyzing a repository that underwent a `git reset`, `git rebase`, or force push, unreachable commits are pruned by clearing existing commit records for that `repo_id` before inserting the updated topological commit graph.
- If an import fails or is aborted, the entire transaction rolls back cleanly, leaving previously indexed data intact.

---

## 4. SQLite Storage Engine

GitScope uses `better-sqlite3` operating synchronously in-process.

### Core Pragmas

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -64000; -- 64MB memory cache
```

### Relational Schema

```mermaid
erDiagram
    REPOSITORIES ||--o{ COMMITS : owns
    REPOSITORIES ||--o{ REFS : contains
    REPOSITORIES ||--o{ ANALYSIS_RUNS : tracks
    COMMITS ||--o{ COMMIT_PARENTS : references
    COMMITS ||--o{ FILE_CHANGES : contains
    COMMITS ||--o{ COMMIT_REFS : tagged_by
    REFS ||--o{ COMMIT_REFS : points_to

    REPOSITORIES {
        string id PK "UUIDv4"
        string canonical_path UK "Normalized absolute path"
        string name "Repository display name"
        string default_branch "Primary branch"
        datetime last_analyzed_at "Last completed sync"
        datetime created_at
        datetime updated_at
    }

    COMMITS {
        string hash PK "40-character hex SHA-1"
        string repo_id PK, FK "References repositories(id)"
        string author_name "Author display name"
        string author_email "Normalized author email"
        datetime author_time "UTC ISO-8601 timestamp"
        string committer_name "Committer display name"
        string committer_email "Normalized committer email"
        datetime committer_time "UTC ISO-8601 timestamp"
        string subject "First line of commit message"
        string body "Extended commit description"
        int parent_count "Number of direct parents"
    }

    COMMIT_PARENTS {
        string repo_id PK, FK
        string commit_hash PK, FK
        string parent_hash PK
        int parent_order PK "0 for primary, 1 for merge parent"
    }

    REFS {
        string repo_id PK, FK
        string name PK "Branch or tag name"
        string type "branch | tag"
        string target_hash FK "Commit hash"
    }

    FILE_CHANGES {
        int id PK "Autoincrement"
        string repo_id FK
        string commit_hash FK
        string path "Repository-relative file path"
        string old_path "Previous path if renamed"
        string change_type "A | M | D | R | C"
        int additions "Lines added (NULL if binary)"
        int deletions "Lines deleted (NULL if binary)"
    }

    ANALYSIS_RUNS {
        string id PK "UUIDv4"
        string repo_id FK
        string status "queued | in_progress | completed | failed"
        int commits_processed
        datetime started_at
        datetime completed_at
        string error_message "Sanitized failure reason"
    }
```

### Multi-Index Strategy

To maintain sub-10ms query execution across 10,000+ commit repositories:

- `idx_commits_repo_time_hash`: `(repo_id, author_time DESC, hash DESC)` — Powers cursor-based pagination.
- `idx_commits_repo_author`: `(repo_id, author_email)` — Powers contributor analytics.
- `idx_file_changes_repo_path`: `(repo_id, path)` — Powers file history and hotspot frequency.
- `idx_file_changes_repo_old_path`: `(repo_id, old_path)` — Enables SQLite `MULTI-INDEX OR` optimization for rename tracking.
- `idx_commit_parents_lookup`: `(repo_id, commit_hash, parent_order)` — Powers DAG ancestry graph extraction.

---

## 5. Query & Analytics Engine

### 1. Cursor-Based Pagination

Pagination avoids `OFFSET` performance degradation. It uses compound keys:

```sql
SELECT ... FROM commits
WHERE repo_id = :repoId
  AND (author_time < :cursorTime OR (author_time = :cursorTime AND hash < :cursorHash))
ORDER BY author_time DESC, hash DESC
LIMIT :limit;
```

Cursors are base64url-encoded JSON tokens `{"t": "2026-10-29T10:00:00.000Z", "h": "hash"}` ensuring stable navigation regardless of concurrent insertions.

### 2. File Rename Tracking

File history queries track renames without full repository re-parsing using SQLite's multi-index union:

```sql
SELECT c.*, fc.change_type, fc.path, fc.old_path, fc.additions, fc.deletions
FROM file_changes fc
JOIN commits c ON c.repo_id = fc.repo_id AND c.hash = fc.commit_hash
WHERE fc.repo_id = :repoId
  AND (fc.path = :targetPath OR fc.old_path = :targetPath)
ORDER BY c.author_time DESC, c.hash DESC
LIMIT :limit;
```

### 3. Interactive Commit DAG

Graph generation retrieves bounded topological ancestry using a recursive CTE starting from the selected ref or HEAD:

```sql
WITH RECURSIVE ancestry(hash, depth) AS (
    SELECT target_hash, 0 FROM refs WHERE repo_id = :repoId AND name = :refName
    UNION
    SELECT cp.parent_hash, a.depth + 1
    FROM ancestry a
    JOIN commit_parents cp ON cp.repo_id = :repoId AND cp.commit_hash = a.hash
    WHERE a.depth < :maxDepth
)
SELECT c.*, GROUP_CONCAT(cp.parent_hash, ',') as parents
FROM ancestry a
JOIN commits c ON c.repo_id = :repoId AND c.hash = a.hash
LEFT JOIN commit_parents cp ON cp.repo_id = :repoId AND cp.commit_hash = c.hash
GROUP BY c.hash
ORDER BY c.author_time DESC;
```

### 4. Co-Change Mining & Combinatorial Safety

Co-change analysis calculates how often pairs of files are modified in the same commit:

- Canonical ordering (`pathA < pathB`) prevents double-counting pairs.
- **Safety Ceiling (`COCHANGE_MAX_FILES_PER_COMMIT = 200`)**: Commits modifying more than 200 files (e.g. bulk formatting, dependency lock updates, vendored imports) would generate $\binom{N}{2} > 20,000$ pairs each, causing CPU and memory spikes. The engine skips pairing for commits exceeding this limit and reports the count in `excludedLargeCommitsCount`.

---

## 6. Frontend Architecture

The web application is built with Next.js 15 (App Router) and React 19:

- **Server & Client Component Separation**: Layouts and shell containers render on the server; interactive graph canvases, metric filter bars, and drawers operate as client components (`'use client'`).
- **Responsive Layout**: Sidebar navigation, sticky commit header with search/filter, multi-column metrics dashboard, and slide-over commit detail drawer.
- **Deterministic Commit Graph Visualizer**: Pure client-side SVG rendering calculating column tracks, branch divergence lanes, and Bezier merge curves without external D3 dependencies.
- **Typed API Client**: Single centralized client (`apps/web/src/lib/api-client.ts`) with custom fetch wrappers, response typing derived from `@gitscope/shared`, and user-friendly error translation.
