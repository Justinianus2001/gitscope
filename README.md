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

   Configure `ALLOWED_REPOSITORY_ROOTS` to specify directories where local Git repositories can be registered.

3. **Run Typecheck and Tests**

   ```bash
   pnpm typecheck
   pnpm test
   ```

4. **Build Packages**

   ```bash
   pnpm build
   ```

5. **Start API Server (Development)**
   ```bash
   pnpm --filter @gitscope/api dev
   ```

---

## Workspace Architecture

GitScope is structured as a modular monorepo using pnpm workspaces:

```text
gitscope/
├── apps/
│   ├── api/             # Fastify REST API, SQLite persistence, Git ingestion & analytics engine
│   └── web/             # Next.js frontend with Tailwind CSS, React Flow & Recharts
├── packages/
│   └── shared/          # TypeScript types, Zod schemas, shared contracts
├── docs/
│   ├── implementation-plan.md  # Detailed progress, milestones, status & next steps
│   ├── architecture.md         # Component and data flow documentation
│   ├── metrics.md              # Mathematical definitions of repository metrics
│   └── benchmark.md            # Benchmark methodology and results
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## Security & Privacy Model

- **Local-first**: Zero telemetry, zero cloud synchronizations, zero external AI APIs.
- **Path allowlisting**: Strict enforcement of `ALLOWED_REPOSITORY_ROOTS`. Paths are resolved and canonicalized against symlinks and traversal before repository operations.
- **Safe process invocation**: Git commands use argument arrays via Node child process APIs. No user input is ever passed to a shell command string.
- **Data persistence**: Stored locally in a single SQLite database (`better-sqlite3`) with foreign key constraints enabled and sanitized error responses.

---

## License

MIT
