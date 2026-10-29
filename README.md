# GitScope

GitScope is a local-first developer tool that analyzes a Git repository and presents its development history through interactive visualizations and repository analytics.

GitScope operates 100% locally: it requires no third-party accounts, performs no external network calls, uses no AI/LLM APIs, and keeps your source code and commit history under your control.

---

## Prerequisites

- **Node.js**: `>= 20.0.0` (developed and tested with Node.js v22)
- **Package Manager**: `pnpm` `>= 10.0.0`
- **Git CLI**: Git installed and available on your system `PATH`

---

## Quick Start

1. **Clone and Install Dependencies**

   ```bash
   pnpm install
   ```

2. **Configure Environment**

   ```bash
   cp .env.example .env
   ```

   Configure `ALLOWED_REPOSITORY_ROOTS` to specify directories where local Git repositories can be registered (e.g. `./sample-repositories` or your local workspace directory).

3. **Run Typecheck, Lint, and Tests**

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```

4. **Build All Packages**

   ```bash
   pnpm build
   ```

5. **Start Development Services**
   - In terminal 1 (Fastify API on `http://127.0.0.1:4000`):
     ```bash
     pnpm dev:api
     ```
   - In terminal 2 (Next.js Web on `http://localhost:3000`):
     ```bash
     pnpm dev:web
     ```

---

## Workspace Architecture

GitScope is structured as a modular monorepo using pnpm workspaces:

```text
gitscope/
├── apps/
│   ├── api/             # Fastify REST API, SQLite persistence, Git ingestion & analytics engine
│   └── web/             # Next.js 15 frontend with Tailwind CSS, Lucide icons, responsive shell
├── packages/
│   └── shared/          # Shared TypeScript contracts, Zod schemas, API DTOs
├── docs/
│   ├── implementation-plan.md  # Detailed progress, milestones, status & next steps
│   ├── architecture.md         # Component and data flow documentation
│   ├── security.md             # Threat model, security boundaries & hardening
│   ├── metrics.md              # Mathematical definitions of repository metrics
│   └── benchmark.md            # Benchmark methodology, query plans & scale results
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## REST API Specification

All endpoints return JSON responses. Errors follow a consistent structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable sanitized message"
  }
}
```

### 1. Health

- `GET /api/health`: Returns `{ "status": "ok" }`.

### 2. Repositories

- `POST /api/repositories`: Register a local repository.
  - Request: `{ "path": "./sample-repositories/my-repo" }`
  - Response (`201 Created` or `200 OK` if already registered):
    ```json
    {
      "data": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "name": "my-repo",
        "defaultBranch": null,
        "lastAnalyzedAt": null,
        "createdAt": "2026-10-29T14:00:00.000Z",
        "updatedAt": "2026-10-29T14:00:00.000Z",
        "analysisStatus": null,
        "commitsProcessed": 0
      },
      "isExisting": true
    }
    ```
- `GET /api/repositories`: List registered repositories with analysis status.
- `GET /api/repositories/:id`: Get single repository details.
- `POST /api/repositories/:id/analyze`: Trigger analysis run in background.
  - Response: `202 Accepted` with `{ "data": { "runId": "uuid", "status": "queued" } }`.
  - Rejects simultaneous runs with `409 Conflict`.
- `GET /api/repositories/:id/analysis`: Get latest analysis status and processed commit count.

### 3. Commits & File History

- `GET /api/repositories/:id/commits?limit=50&cursor=...&branch=...&author=...&from=...&to=...&path=...`:
  - Deterministic cursor pagination ordered by `author_time DESC, hash DESC`.
  - Cursor is a base64url-encoded token with stable tie-breaking.
  - Response:
    ```json
    {
      "data": [
        {
          "hash": "c0ffee1234567890c0ffee1234567890c0ffee12",
          "abbreviatedHash": "c0ffee1",
          "authorName": "Alice Dev",
          "authorEmail": "alice@example.com",
          "authorTime": "2026-10-29T10:00:00.000Z",
          "committerTime": "2026-10-29T10:00:00.000Z",
          "subject": "Initial commit",
          "body": null,
          "parentHashes": [],
          "parentCount": 0,
          "refs": ["main"]
        }
      ],
      "page": {
        "nextCursor": "eyJ0IjoiMjAyNi...In0"
      }
    }
    ```
- `GET /api/repositories/:id/commits/:hash`:
  - Returns commit metadata, ordered parents, branch/tag refs, and changed files with additions/deletions.
  - Supports 40-character full hash or abbreviated hash (7-40 hex chars).
- `GET /api/repositories/:id/files/:path/history?limit=50&cursor=...`:
  - Returns commits modifying the URL-decoded relative file path, preserving history across renames.

### 4. Interactive Graph & Refs

- `GET /api/repositories/:id/graph?ref=...&limit=300`:
  - Returns a bounded ancestry commit DAG with full hashes, ordered parents, subjects, timestamps, and refs.
  - Returns `{ "data": { "nodes": [...], "truncated": boolean, "ref": string | null } }`.
  - Supports default branch or explicit branch/tag refs.
- `GET /api/repositories/:id/refs`:
  - Returns all branch and tag references for the repository.

### 5. Repository Analytics & Insights

- `GET /api/repositories/:id/activity?from=...&to=...&interval=day|week|month`:
  - Returns contiguous zero-filled UTC time buckets (`commitCount`, `distinctContributors`), total commit counts, and ranked contributor summaries with normalized email identities.
- `GET /api/repositories/:id/hotspots?from=...&to=...&path=...&limit=50`:
  - Returns file paths ranked by distinct modifying commits, total known line additions/deletions (treating binary modifications as `NULL`/unknown), and last modified timestamp.
- `GET /api/repositories/:id/co-changes?from=...&to=...&path=...&minCount=2&limit=50`:
  - Mines file pairs frequently modified in the same commit with canonical ordering (`pathA < pathB`).
  - Enforces combinatorial safety threshold: commits touching more than `COCHANGE_MAX_FILES_PER_COMMIT` (default: 200) files are excluded from quadratic pairing, reported in `excludedLargeCommitsCount`.

### Standard Error Codes

| HTTP Status | Error Code                                                                                                                            | Description                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `400`       | `INVALID_REQUEST` / `INVALID_ID` / `INVALID_HASH` / `INVALID_PATH` / `INVALID_CURSOR` / `INVALID_DATE_RANGE` / `DATE_RANGE_TOO_LARGE` | Request validation error                              |
| `403`       | `PATH_NOT_ALLOWED`                                                                                                                    | Path is outside configured `ALLOWED_REPOSITORY_ROOTS` |
| `404`       | `PATH_NOT_FOUND` / `REPOSITORY_NOT_FOUND` / `COMMIT_NOT_FOUND` / `REF_NOT_FOUND`                                                      | Resource not found                                    |
| `409`       | `ANALYSIS_ALREADY_RUNNING`                                                                                                            | An analysis run is already in progress                |
| `422`       | `NOT_A_GIT_REPOSITORY`                                                                                                                | Path exists but does not contain a Git working tree   |
| `500`       | `INTERNAL_SERVER_ERROR`                                                                                                               | Unexpected internal server error (sanitized)          |

---

## Security & Privacy Model

- **Local-first**: Zero telemetry, zero cloud synchronizations, zero external AI APIs.
- **Path allowlisting**: Strict enforcement of `ALLOWED_REPOSITORY_ROOTS`. Paths are resolved with `fs.realpathSync` to defeat symlink escapes and traversal before any Git operations.
- **Safe process invocation**: Git CLI commands execute via argument arrays without shell interpolation. Execution timeouts and max buffer caps are enforced.
- **Data persistence**: Stored locally in a single SQLite database (`better-sqlite3`) with foreign key constraints enabled.

For full architectural details, see [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).
For metrics definitions and benchmark performance, see [docs/metrics.md](docs/metrics.md) and [docs/benchmark.md](docs/benchmark.md).

---

## License

MIT
