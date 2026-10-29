---
product: GitScope
status: Implementation specification
title: GitScope --- Product Requirements Document (PRD)
version: 1.0
---

# 1. Purpose and Implementation Guidance

This PRD translates GitScope's business goals into implementable product
behavior, functional requirements, data structures, API contracts, UX
states, and acceptance criteria.

**Instructions for the coding agent:** - Treat this document as the
source of truth for the MVP. - Implement in small, working increments.
Do not generate the entire application in one pass. - Before coding,
inspect the existing repository and report its current structure.
Preserve useful existing work. - Do not add AI/LLM features or call
external AI services from the product. - Prefer a modular monolith: one
web app, one API service, one SQLite database. - Do not introduce Redis,
message brokers, Kubernetes, microservices, or cloud authentication for
the MVP. - Use strict TypeScript and validate external inputs. - Keep
secrets and local repository paths out of client-side code and public
logs. - Add tests alongside implementation. - If a requirement is
ambiguous, choose the simplest secure behavior and document the
decision. - Maintain a `docs/implementation-plan.md` with completed
work, current work, known limitations, and next steps. - At the end of
each milestone, run relevant tests and report what passed, what failed,
and what remains.

# 2. Product Summary

GitScope is a local-first web application that analyzes local Git
repositories and presents: - Commit explorer - Interactive commit/branch
graph - Activity analytics - File change hotspots - Co-change analysis -
Repository import and re-analysis status

No source code or repository metadata should be uploaded to external
services by the MVP.

# 3. Scope

## 3.1 MVP features

1.  Repository registration and validation.
2.  Git history ingestion and metadata indexing.
3.  Commit list, commit detail, and file history.
4.  Commit graph for a bounded range of commits.
5.  Commit activity analytics.
6.  File hotspots.
7.  Co-change analysis.
8.  Filters and pagination.
9.  Import status, error handling, and re-analysis.
10. Automated tests, documentation, and reproducible benchmarks.

## 3.2 Out of scope

-   User registration, cloud sync, teams, billing.
-   GitHub/GitLab API integration.
-   AI/LLM summaries or predictions.
-   Editing source code or staging commits.
-   Full diff viewer with syntax highlighting (can be a later
    enhancement).
-   Git server hosting.
-   Claims about individual developer productivity, competence, or code
    quality.

# 4. Recommended Technical Stack

Use current stable versions compatible with each other and pin them
through the package manager lockfile.

-   Language: TypeScript, strict mode.
-   Frontend: Next.js, React, Tailwind CSS, shadcn/ui.
-   Backend: Node.js and Fastify.
-   Validation: Zod.
-   Database: SQLite with Drizzle ORM or parameterized SQL.
-   Charts: Recharts.
-   Graph: React Flow for an MVP graph layout; use D3 only if custom
    graph layout becomes necessary.
-   Testing: Vitest for unit/integration tests; Playwright for critical
    E2E flows.
-   Tooling: pnpm workspaces, ESLint, Prettier.
-   Packaging: Docker Compose for a repeatable local development
    environment.

Avoid coupling business logic to framework-specific route handlers. Keep
Git parsing and analytics in standalone modules.

# 5. Architecture

## 5.1 Components

### Web application

Responsibilities: - Repository selection and import initiation. -
Polling/displaying analysis status. - Commit explorer and filters. -
Graph and analytics visualizations. - Loading, empty, and error states.

### API service

Responsibilities: - Validate requests. - Enforce allowed repository
roots. - Orchestrate imports and report status. - Serve paginated and
filtered data from SQLite. - Coordinate analytics calculations.

### Git adapter

Responsibilities: - Invoke Git CLI through `spawn` or `execFile` with an
argument array. - Set working directory explicitly. - Apply timeout and
output limits. - Capture exit code and stderr safely. - Parse structured
output without assuming filenames are newline-safe. - Never construct a
shell command by concatenating user-controlled values.

### Importer

Responsibilities: - Discover repository metadata, commits, parent
relationships, refs, and file changes. - Write records transactionally
or in well-defined batches. - Be idempotent. - Record run status and
errors. - Support full re-indexing as a recovery path.

### Analytics modules

Responsibilities: - Calculate activity series. - Calculate file hotspot
scores. - Calculate co-change counts and rankings. - Define
deterministic, documented metric semantics. - Remain independent from
HTTP and UI layers.

### Persistence

Responsibilities: - Store repository metadata and analysis state. -
Enforce uniqueness and foreign keys. - Provide indexes for common
queries. - Use migrations and parameterized queries.

## 5.2 Suggested repository structure

``` text
gitscope/
  apps/
    web/
      app/
      components/
      features/
      lib/
    api/
      src/
        routes/
        services/
        git/
          runner.ts
          parser.ts
          importer.ts
        analytics/
          activity.ts
          hotspots.ts
          cochanges.ts
        db/
          schema.ts
          client.ts
          migrations/
        config/
        app.ts
        server.ts
  packages/
    shared/
      src/
        schemas/
        types/
  tests/
    fixtures/
    integration/
    e2e/
  docs/
    architecture.md
    metrics.md
    implementation-plan.md
    benchmark.md
  docker-compose.yml
  pnpm-workspace.yaml
  package.json
  README.md
```

Adjust the layout if the repository already has a sensible structure,
but preserve clear module boundaries.

# 6. Data Model

Use SQLite. Enable foreign keys. Apply migrations from version control.

## 6.1 `repositories`

-   `id`: text UUID primary key
-   `name`: text, required
-   `canonical_path`: text, required
-   `default_branch`: nullable text
-   `last_analyzed_at`: nullable ISO timestamp
-   `created_at`: ISO timestamp
-   `updated_at`: ISO timestamp

Uniqueness: canonical path should be unique for the local app.

## 6.2 `commits`

-   `repo_id`: FK to repositories
-   `hash`: full commit hash
-   `author_name`: text
-   `author_email`: text
-   `author_time`: ISO timestamp or integer Unix timestamp, consistently
    chosen
-   `committer_time`: ISO timestamp or integer Unix timestamp
-   `subject`: text
-   `body`: nullable text

Primary/unique key: `(repo_id, hash)`. Do not use the abbreviated hash
as a key.

## 6.3 `commit_parents`

-   `repo_id`
-   `commit_hash`
-   `parent_hash`
-   `parent_index`: integer, starting at zero

Unique key: `(repo_id, commit_hash, parent_index)`. Preserve parent
order because it matters for merge commits. Parent rows may reference
commits not yet imported during batch processing; validate relationships
after import or use a safe insertion strategy.

## 6.4 `refs`

-   `repo_id`
-   `name`
-   `ref_type`: `branch` or `tag` (other ref types may be ignored in
    MVP)
-   `target_hash`
-   `is_remote`: boolean, if remote branches are included

Unique key: `(repo_id, name, ref_type)`.

## 6.5 `file_changes`

-   `id`: integer primary key
-   `repo_id`
-   `commit_hash`
-   `path`: text; store repository-relative path
-   `old_path`: nullable text, used for rename when known
-   `change_type`: normalized enum such as `added`, `modified`,
    `deleted`, `renamed`, `copied`, `type_changed`, `unknown`
-   `additions`: nullable integer
-   `deletions`: nullable integer
-   `is_binary`: nullable boolean

Indexes: - `(repo_id, path)` - `(repo_id, commit_hash)` -
`(repo_id, change_type)`

Do not treat unknown additions/deletions as zero. If line counts are not
implemented reliably for a change type, store `NULL`.

## 6.6 `analysis_runs`

-   `id`: text UUID primary key
-   `repo_id`: FK to repositories
-   `status`: `queued`, `running`, `completed`, `failed`, `cancelled`
-   `started_at`: nullable timestamp
-   `finished_at`: nullable timestamp
-   `error_code`: nullable short code
-   `error_message`: nullable sanitized message
-   `commits_processed`: integer default 0
-   `created_at`: timestamp

A single active analysis run per repository is sufficient for the MVP.

## 6.7 Schema principles

-   Enable SQLite foreign keys on every connection.
-   Use transactions for logically related writes.
-   Add migrations for all schema changes.
-   Use prepared/parameterized statements.
-   Avoid storing computed analytics unless profiling proves it is
    needed; initially calculate from indexed source records and add
    caching only when justified.
-   Never store full source file contents.

# 7. Functional Requirements and Acceptance Criteria

## FR-01: Repository registration

The user can add a local repository path.

Acceptance criteria: - The backend canonicalizes the path and checks it
is within configured allowed roots. - The backend verifies that it is a
Git working tree. - Invalid paths, inaccessible directories, and
non-repositories return actionable errors. - Duplicate canonical paths
return the existing repository or a clear conflict response. - The
frontend never gains arbitrary filesystem access. - The application
documents how allowed roots are configured.

Security note: path allowlisting is mandatory. Do not accept arbitrary
filesystem paths by default. For a local-only development setup,
configure a dedicated repositories directory and require repositories to
reside inside it.

## FR-02: Analyze repository

The user can trigger initial analysis and re-analysis.

Acceptance criteria: - `POST /api/repositories/:id/analyze` returns
`202 Accepted` with an analysis run ID when work is accepted. - The API
prevents duplicate simultaneous analysis for the same repository. - The
frontend displays queued/running/completed/failed states. - Failed runs
can be retried. - A failed run does not corrupt previously indexed
data. - Repeated analysis does not create duplicate commit records.

For the initial implementation, an in-process background task is
acceptable. Keep the importer behind a service interface so it can later
move to a worker process.

## FR-03: Commit ingestion

Capture full commit hash, author and committer metadata, timestamps,
subject/body, parent hashes, refs, and file changes.

Acceptance criteria: - Merge commits preserve all parent relationships
and parent order. - Unicode and filenames containing spaces or unusual
characters are handled safely. - Empty repositories are handled. -
Repository errors and Git command errors are distinguished. - Large
command output is bounded or streamed. - Import timeout and cancellation
are supported where feasible. - Parser tests use fixture repositories
built with real Git commands.

## FR-04: Commit explorer

Acceptance criteria: - List commits in a deterministic order, defaulting
to author/commit timestamp descending as documented. - Support cursor or
offset pagination; prefer cursor pagination if stable ordering can be
guaranteed. - Show abbreviated hash for display and full hash in
details. - Show subject, author, timestamp, and parent count. - Clicking
a commit opens its detail view and changed-file list. - Filters combine
correctly and are validated server-side.

## FR-05: Commit graph

Acceptance criteria: - Show parent-child relationships and available
branch/tag refs for a bounded commit range. - Support selecting a node
to open commit details. - Handle merge commits with multiple parents. -
Show a useful empty state for repositories without commits. - Do not
attempt to render unlimited history at once. - Include a legend or clear
visual language for merge commits and refs. - Graph output is
deterministic for the same repository snapshot and options.

The initial graph may use a topological ordering and a straightforward
layout. Do not attempt to replicate every advanced Git GUI feature.

## FR-06: Activity analytics

Acceptance criteria: - Display commit count over a selectable time
interval. - Support grouping by day and week. - Apply supported branch
and author filters consistently. - Fill missing date buckets with zero
commits for visualization only. - Use one documented timestamp
definition for activity; default to author time and make the choice
explicit in the UI/docs. - Use timezone handling consistently and test
date boundaries.

Do not infer productivity, quality, or effort from commit counts.

## FR-07: File hotspots

Acceptance criteria: - Rank files by number of distinct commits changing
them in the selected range. - Allow a user to open a file's change
history. - Explain the score and selected time range. - Exclude or
separately label generated/vendor files only if an explicit,
configurable rule is implemented. - Do not present hotspot rank as proof
of technical debt or defect risk.

## FR-08: Co-change analysis

Definition: - For each commit, derive unique eligible file paths changed
in that commit. - Increment the count for each unordered pair of paths
in that commit. - Exclude commits with an excessively large changed-file
set above a configurable safety threshold, and report how many were
excluded. - Avoid counting the same path twice in a single commit. -
Provide a minimum co-change count filter.

Acceptance criteria: - Results show both file paths and the number of
shared commits. - Selecting a pair shows the shared commits. - Metric
semantics and exclusions are documented. - UI states clearly that
co-change indicates historical association, not a proven dependency. -
Algorithm tests cover duplicate paths, large commits, and stable pair
ordering.

A normalized score can be added as a secondary metric, but the raw
shared-commit count must remain visible.

## FR-09: File history

Acceptance criteria: - Show commits that changed a selected path. -
Handle renamed paths to the extent the importer has recorded rename
information. - Clearly distinguish a missing file from a file with no
history in the indexed range. - Never read arbitrary paths supplied by
the client; path history queries use indexed repository-relative paths.

## FR-10: Filtering and pagination

Acceptance criteria: - Validate dates, page size, branch, author, and
path filters on the server. - Set a reasonable maximum page size. - Use
indexes for common filters. - Invalid filters return a structured 4xx
response. - Empty result sets are not treated as server errors.

## FR-11: Error handling and observability

Acceptance criteria: - Return consistent error responses with stable
error codes. - Do not leak stack traces, secrets, or sensitive absolute
paths to the browser. - Log import start/end, duration, processed record
counts, and sanitized failures. - Provide enough information to debug a
failed import locally. - Add timeouts and cancellation for long-running
Git commands.

# 8. API Contract

Use a consistent JSON response shape. Exact envelope conventions may be
adjusted once, then applied everywhere.

## `GET /api/health`

Response:

``` json
{ "status": "ok" }
```

## `GET /api/repositories`

Response:

``` json
{
  "data": [
    {
      "id": "uuid",
      "name": "example-repo",
      "lastAnalyzedAt": "2026-01-01T12:00:00.000Z"
    }
  ]
}
```

Do not expose canonical filesystem paths by default in list responses.

## `POST /api/repositories`

Request:

``` json
{ "path": "/configured/repos/example-repo" }
```

Response: `201 Created` with repository metadata. Invalid path: `400` or
`422`; duplicate path behavior must be documented and consistent.

## `POST /api/repositories/:id/analyze`

Response:

``` json
{
  "data": {
    "runId": "uuid",
    "status": "queued"
  }
}
```

HTTP status: `202 Accepted`.

## `GET /api/repositories/:id/analysis`

Response:

``` json
{
  "data": {
    "runId": "uuid",
    "status": "running",
    "commitsProcessed": 120
  }
}
```

## `GET /api/repositories/:id/commits?limit=50&cursor=...&branch=main&author=...&from=...&to=...&path=...`

Response:

``` json
{
  "data": [],
  "page": {
    "nextCursor": null
  }
}
```

## `GET /api/repositories/:id/commits/:hash`

Returns commit metadata, parent hashes, refs where applicable, and
changed-file summary.

## `GET /api/repositories/:id/graph?ref=main&limit=300`

Returns a bounded graph payload:

``` json
{
  "data": {
    "nodes": [
      {
        "hash": "full-hash",
        "subject": "Example change",
        "authorTime": "2026-01-01T12:00:00.000Z",
        "parentHashes": ["parent-hash"],
        "refs": ["main"]
      }
    ]
  }
}
```

The frontend or graph-layout module can calculate x/y coordinates. The
API should not return an unbounded graph.

## `GET /api/repositories/:id/activity?from=...&to=...&groupBy=day&branch=main&author=...`

Returns time buckets and commit counts, including zero-filled buckets
where appropriate.

## `GET /api/repositories/:id/hotspots?from=...&to=...&branch=main&limit=50`

Returns repository-relative path, distinct commit count, and available
change totals.

## `GET /api/repositories/:id/co-changes?minCount=2&limit=50&from=...&to=...`

Returns pairs of paths, shared-commit count, and any
excluded-large-commit summary needed for interpretation.

## `GET /api/repositories/:id/files/:path/history?limit=50&cursor=...`

Returns commits affecting the URL-decoded repository-relative path.
Validate and normalize the path; never use it as a filesystem path.

# 9. UX Requirements

## Main navigation

-   Repositories
-   Overview
-   Commits
-   Graph
-   Hotspots
-   Co-changes

A compact left sidebar is recommended on desktop. Ensure core views
remain usable on narrower screens.

## Repository overview

Display: - Repository name and last analysis status. - Commit activity
chart. - Recent commits. - Top file hotspots. - Shortcuts to graph and
co-change views.

## Import screen

Display: - Repository path input or folder-selection mechanism supported
by the runtime. - Validation feedback. - Analyze button with
disabled/loading states. - Import progress/status and retry action.

Browser-based Next.js cannot freely browse a user's filesystem without a
supported local bridge or user-provided path. For the MVP, provide a
configured allowed-root path input and clear setup documentation. Do not
pretend a browser folder picker can securely grant arbitrary backend
filesystem access.

## Commit explorer

Display: - Hash, subject, author, timestamp, parent/merge indicator. -
Search/filter controls. - Pagination. - Selected commit details and
changed files.

## Graph view

Display: - Branch and tag refs. - Merge commit distinction. - Clickable
nodes. - Zoom/pan controls if supported by the selected graph library. -
Bounded range and an explicit indication when only part of the history
is displayed.

## Analytics views

Each chart must include: - Title and definition. - Date range and
relevant filters. - Empty state. - Tooltip/legend. - Accessible labels
or equivalent text summaries.

## Global states

Every data-driven page must have loading, empty, error, and populated
states. Long-running analysis must not block the web server's event
loop.

# 10. Metrics Definitions

Document all metrics in `docs/metrics.md`.

## Commit activity

Count commits grouped by the chosen timestamp field and time bucket.
Default: author timestamp, with this convention visible to the user.

## File hotspot score

Primary score: number of distinct commits in the selected range that
changed the file. Do not use raw line counts as the sole score.

## Co-change count

Number of commits containing both file A and file B, counting each
unordered pair at most once per commit. Large commits above the
configured threshold may be excluded to prevent combinatorial explosion;
disclose the exclusions.

## Line change counts

Use nullable additions/deletions. Do not report unknown binary or merge
statistics as zero.

# 11. Security and Privacy

-   Local-only MVP; no analytics beacons or external data upload.
-   Use configured allowed repository roots.
-   Resolve and canonicalize paths before checking allowlist membership.
-   Consider symlinks and path traversal when validating paths.
-   Use process argument arrays; never interpolate input into shell
    command strings.
-   Apply execution timeouts and output limits.
-   Sanitize stderr and API errors.
-   Do not accept raw Git options from the client.
-   Avoid logging author emails or absolute repository paths unless
    necessary for local debugging.
-   Document that repository metadata is stored in the application's
    local SQLite database.

# 12. Testing Strategy

## Unit tests

-   Git output parsing.
-   Timestamp and date-bucket calculations.
-   Hotspot aggregation.
-   Co-change pair counting and threshold behavior.
-   Input validation and path normalization.

## Integration tests

-   Build temporary Git repositories with commits, branches, merges,
    renames, deletes, Unicode paths, and empty history.
-   Run the importer and verify database records.
-   Verify re-import idempotency.
-   Verify API filters and pagination.
-   Verify failed import rollback/recovery.

## E2E tests

-   Add a fixture repository.
-   Run analysis.
-   View commits.
-   Open graph.
-   Apply an analytics filter.
-   Open a hotspot's file history.
-   Verify a failed import shows a recoverable error.

## Performance tests

-   Create or select repositories of documented sizes.
-   Measure cold import and incremental import separately.
-   Measure common API query latency and graph rendering.
-   Record hardware, Node version, Git version, commit count,
    file-change count, and methodology.
-   Do not assert universal performance claims from one machine.

# 13. Definition of Done

A feature is done only when: 1. Its acceptance criteria are met. 2.
Inputs are validated. 3. Loading, empty, and error states exist where
relevant. 4. Tests are added and pass. 5. Documentation is updated when
behavior or metric semantics change. 6. No secrets or arbitrary path
execution vulnerabilities are introduced. 7. The application still
starts from the documented commands.

# 14. Implementation Milestones

## Milestone 0 --- Repository reconnaissance

-   Inspect the existing workspace and package manager.
-   Summarize current structure and any existing code.
-   Propose a minimal implementation plan.
-   Do not overwrite existing work.

## Milestone 1 --- Foundation

-   Workspace setup, linting, formatting, strict TypeScript.
-   Fastify health endpoint.
-   SQLite connection and migrations.
-   Shared schemas and environment validation.
-   Initial README and implementation plan.

## Milestone 2 --- Git adapter and importer

-   Safe Git process wrapper.
-   Repository validation.
-   Structured parser.
-   Import state and database writes.
-   Fixture-based parser and importer tests.

## Milestone 3 --- Commit explorer

-   Repository list and import UI.
-   Commit APIs and pagination.
-   Commit list/detail and file history.
-   Error/loading/empty states.

## Milestone 4 --- Graph

-   Bounded graph API.
-   Parent relationships and refs.
-   Interactive graph UI and node details.
-   Tests for merge and disconnected refs.

## Milestone 5 --- Analytics

-   Activity buckets.
-   Hotspots.
-   Co-change analysis.
-   Metric documentation and correctness tests.

## Milestone 6 --- Reliability and release

-   Incremental re-analysis and history rewrite handling.
-   Performance profiling.
-   E2E suite.
-   Docker/dev setup and README.
-   Reproducible benchmark report.

# 15. Recommended First Coding Session

Implement only Milestone 0 and the smallest portion of Milestone 1.

1.  Inspect the current project and report its structure.
2.  Confirm Node.js, Git, and package manager availability in the
    development environment.
3.  Create the workspace skeleton without overwriting existing files.
4.  Add strict TypeScript, linting, formatting, and environment
    validation.
5.  Create a Fastify `/api/health` endpoint.
6.  Add SQLite connection and first migration for `repositories` and
    `analysis_runs`.
7.  Add tests for health and database initialization.
8.  Run lint, typecheck, and tests.
9.  Update `docs/implementation-plan.md` with actual outcomes and the
    next tasks.

Do not start the graph UI until Git ingestion and database behavior are
reliable.

# 16. Environment Configuration

Provide `.env.example` with non-secret defaults, such as:

``` dotenv
NODE_ENV=development
API_HOST=127.0.0.1
API_PORT=4000
WEB_PORT=3000
DATABASE_PATH=./data/gitscope.sqlite
ALLOWED_REPOSITORY_ROOTS=./sample-repositories
GIT_COMMAND_TIMEOUT_MS=30000
MAX_GIT_OUTPUT_BYTES=50000000
COCHANGE_MAX_FILES_PER_COMMIT=200
```

Validate configuration at startup and fail with a clear message for
invalid values. Do not commit the actual `.env` file or generated
database.

# 17. Final Deliverables

-   Working local-first GitScope application.
-   Source code with modular Git ingestion and analytics logic.
-   SQLite schema and migrations.
-   Automated unit, integration, and E2E tests.
-   `README.md` with prerequisites, setup, commands, privacy model, and
    screenshots.
-   `docs/architecture.md`.
-   `docs/metrics.md`.
-   `docs/benchmark.md` with reproducible measurements.
-   `docs/implementation-plan.md` updated with completed work and known
    limitations.
