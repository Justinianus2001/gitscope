# GitScope Demonstration & Evaluation Guide

This guide walks through setting up GitScope from a fresh repository clone, generating the deterministic demo fixture, and evaluating all core features.

---

## 1. Prerequisites

Before beginning, ensure your workstation meets the following requirements:

| Prerequisite | Minimum Version    | Recommended / Tested  | Verification Command |
| ------------ | ------------------ | --------------------- | -------------------- |
| **Node.js**  | `>= 20.0.0`        | `v22.22.1`            | `node -v`            |
| **pnpm**     | `>= 9.0.0`         | `10.32.1`             | `pnpm -v`            |
| **Git CLI**  | Any recent release | `git version 2.45.x+` | `git --version`      |

---

## 2. Fresh Clone & Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-username/gitscope.git
cd gitscope
```

### Step 2: Install Workspace Dependencies

```bash
pnpm install
```

### Step 3: Configure Environment

Copy the default environment template:

```bash
cp .env.example .env
```

Verify that `.env` contains:

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

---

## 3. Generate the Deterministic Demo Repository

GitScope includes an automated setup script that creates a realistic, deterministic Git repository fixture under `./sample-repositories/gitscope-demo`:

```bash
pnpm demo:setup
```

### Expected Output:

```text
[SETUP] Initializing deterministic Git demo fixture using git version 2.45.1.windows.1...
[SETUP] Destination: ...\sample-repositories\gitscope-demo
[SUCCESS] Demo Git repository fixture generated successfully!
[SUCCESS] Location: ...\sample-repositories\gitscope-demo
[SUCCESS] Total commits: 15
[SUCCESS] Branches: feature/auth-service, feature/metrics-pipeline, main
[SUCCESS] Tags: v0.1.0, v0.2.0, v1.0.0
[SUCCESS] Ready for exploration in GitScope.
```

### Idempotency Guarantee:

Running `pnpm demo:setup` multiple times is safe and non-destructive. If the fixture already exists, the script detects the valid Git repository and reports its status without modifying or overwriting any files:

```text
[INFO] Demo repository already exists at: ...\sample-repositories\gitscope-demo
[INFO] Status: 15 commits, 3 branches (feature/auth-service, feature/metrics-pipeline, main), 3 tags (v0.1.0, v0.2.0, v1.0.0)
[INFO] Setup is idempotent: existing repository was preserved without modifications.
```

---

## 4. Starting the Application Services

Open two separate terminal windows:

### Terminal 1: Fastify REST API

```bash
pnpm dev:api
```

The API server starts on `http://127.0.0.1:4000`. You can verify health via:

```bash
curl http://127.0.0.1:4000/api/health
# Returns: {"status":"ok"}
```

### Terminal 2: Next.js Frontend

```bash
pnpm dev:web
```

The web application starts on `http://localhost:3000`.

---

## 5. Registering and Analyzing the Demo Repository

1. Open **`http://localhost:3000`** in your browser.
2. Under **Register a Local Repository**, enter:
   ```text
   ./sample-repositories/gitscope-demo
   ```
3. Click **Register**.
4. The repository appears in the list. GitScope immediately triggers background analysis:
   - The status badge shows a spinning indicator with `running`.
   - Reactive status polling automatically checks progress every 2 seconds.
   - Once ingestion finishes (typically $< 300\text{ ms}$), the badge transitions to green `completed` and shows `15 commits indexed`.
5. Click **Explore Commits &rarr;** on the card to open the repository.

---

## 6. Guided Tour of Core Features

### Feature 1: Interactive Ancestry Graph (`?view=graph`)

1. On the repository page, the **Interactive Graph** view is selected by default.
2. **Topology inspection:**
   - Observe the main linear trunk and the diverging branch `feature/metrics-pipeline`.
   - Locate the merge commit `ef135d5` (`Merge branch 'feature/auth-service' into main`) with its purple merge indicator and two incoming parent connections.
   - Note the release tag badges: `v0.1.0` on the initial commit, `v0.2.0` on the merge commit, and `v1.0.0` on the latest release.
3. **Controls & MiniMap:**
   - Use the scroll wheel to zoom in and out.
   - Click and drag anywhere on the canvas to pan.
   - Observe the interactive MiniMap in the bottom-right corner reflecting topological lanes.
4. **Ref switcher:**
   - Use the branch/tag dropdown menu in the graph toolbar to switch to `feature/metrics-pipeline` or tags.

### Feature 2: Accessible Commit Explorer (`?view=commits`)

1. Click the **Commit Explorer** tab (or press the _Accessible List View_ button in the graph toolbar).
2. The URL updates to `?view=commits` without page reload, supporting browser back/forward history navigation.
3. **Inspect a commit:**
   - Click any commit row (e.g. `ef135d5` or `876e838`).
   - The slide-over commit drawer opens smoothly from the right.
   - Review the commit details: author, timestamp, parent hashes, and per-file line additions (`+`) and deletions (`-`).
   - Notice that commit `876e838` displays file rename tracking (`renamed from src/utils/logger.ts`) and file deletion (`legacy-config.json`).
4. **Keyboard accessibility:**
   - Press `Tab` and `Shift+Tab`: focus cycles exclusively between the close button and interactive elements inside the drawer.
   - Press `Escape`: the drawer dismisses immediately, and focus is restored to the commit row you clicked.
5. **Filtering:**
   - In the filter bar, enter `Alex Rivera` in the **Author** field and click **Filter Commits**.
   - Clear filters and enter `src/server.ts` in the **File Path** field to inspect the file-specific history.

### Feature 3: Analytics Dashboard (`/repositories/:id/analytics`)

Click **Analytics Dashboard** in the view switcher to navigate to `/repositories/:id/analytics`.

1. **Summary Stat Cards:**
   - Displays **Total Commits** (15), **Distinct Authors** (3), **Average Activity per Bucket**, and **Peak Activity**.
2. **Commit Activity Over Time:**
   - Click **All Time** in the window toolbar to view the full January 2026 commit distribution.
   - Hover over the Recharts area chart to view precise daily commit counts and active contributor counts in the custom tooltip.
   - Toggle between **Daily**, **Weekly**, and **Monthly** bucketing.
3. **Contributors Overview:**
   - Review the contributor leaderboard showing normalized email identities and relative commit percentages:
     - `Alex Rivera <alex.rivera@gitscope.demo>`
     - `Elena Rostova <elena.rostova@gitscope.demo>`
     - `Sam Chen <sam.chen@gitscope.demo>`
4. **File Hotspots:**
   - Inspect the ranked list of modules modified across the codebase.
   - Observe that `src/server.ts` and `src/config.ts` rank at the top with high commit counts and line churn.
5. **Co-Change Coupling (Logical File Associations):**
   - Scroll to the bottom table to review mined file pairs:
     - `src/config.ts` $\leftrightarrow$ `src/server.ts` (5 shared commits)
     - `src/auth/service.ts` $\leftrightarrow$ `src/auth/tokens.ts` (3 shared commits)
     - `src/metrics/collector.ts` $\leftrightarrow$ `src/metrics/types.ts` (2 shared commits)
   - These associations reflect files modified together across multiple independent commits, indicating structural cohesion.

---

## 7. Troubleshooting

| Symptom                                                | Probable Cause                                             | Resolution                                                                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **`403 PATH_NOT_ALLOWED` when registering repository** | Target path is outside `ALLOWED_REPOSITORY_ROOTS`.         | Update `ALLOWED_REPOSITORY_ROOTS` in `.env` to include the parent directory of your repository, or use a path inside `./sample-repositories`. |
| **`422 NOT_A_GIT_REPOSITORY`**                         | Path exists but does not contain a `.git` folder.          | Verify that the path points to the root of a valid Git repository, or run `pnpm demo:setup`.                                                  |
| **Port 3000 or 4000 already in use**                   | Another local process is listening on the configured port. | Change `API_PORT` (e.g. `4001`) or `WEB_PORT` (e.g. `3001`) in `.env`, and update `NEXT_PUBLIC_API_URL` accordingly.                          |
| **`Git command-line tool is not installed`**           | Git executable is not in the system `PATH`.                | Install Git from https://git-scm.com/ and confirm that running `git --version` in your terminal succeeds.                                     |
| **`500 Internal Server Error` on start**               | Stale Next.js build cache or port conflict.                | Stop running servers, delete `apps/web/.next`, and restart with `pnpm dev:web`.                                                               |

---

## 8. Resetting the Demo Environment Safely

> [!CAUTION]
> **Manual Cleanup Warning**: The commands below permanently delete the generated demo repository and the local SQLite database. Ensure you do not execute these commands on personal or production repositories.

GitScope intentionally does not provide automated destructive cleanup scripts to avoid accidental data loss. To perform a completely clean reset manually:

### 1. Remove the Demo Repository Fixture:

On Windows (PowerShell):

```powershell
Remove-Item -Recurse -Force sample-repositories\gitscope-demo
```

On macOS / Linux:

```bash
rm -rf sample-repositories/gitscope-demo
```

### 2. Clear Local SQLite Database:

On Windows (PowerShell):

```powershell
Remove-Item -Force data\gitscope.sqlite*
```

On macOS / Linux:

```bash
rm -f data/gitscope.sqlite*
```

### 3. Re-generate Fresh Fixture:

```bash
pnpm demo:setup
```
