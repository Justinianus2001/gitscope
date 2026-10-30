#!/usr/bin/env node

/**
 * GitScope Demo Repository Setup Script
 *
 * Generates a deterministic, realistic Git repository fixture to demonstrate
 * GitScope analytics: commit ancestry graphs, contributor activity, file hotspots,
 * and structural co-change coupling.
 *
 * Requirements:
 * - Pure Node.js built-ins only (node:fs, node:path, node:child_process).
 * - Safe execution with argument arrays (no shell string execution).
 * - Fully idempotent (detects existing valid repository and preserves it).
 * - Safe boundary enforcement against ALLOWED_REPOSITORY_ROOTS.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * Verifies that the Git CLI is available in the current environment.
 */
function checkGitAvailability() {
  try {
    const version = execFileSync('git', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return version;
  } catch {
    console.error('[ERROR] Git command-line tool is not installed or not found in system PATH.');
    console.error('[ERROR] GitScope requires Git CLI to generate and inspect repositories.');
    console.error(
      '[ERROR] Please install Git (https://git-scm.com/) and ensure "git" is in your PATH.',
    );
    process.exit(1);
  }
}

/**
 * Reads configured allowed repository roots from .env or process.env.
 */
function getAllowedRoots(projectRoot) {
  let rawRoots = process.env.ALLOWED_REPOSITORY_ROOTS;
  if (!rawRoots) {
    const envPath = path.join(projectRoot, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^ALLOWED_REPOSITORY_ROOTS\s*=\s*(.*)$/m);
        if (match && match[1]) {
          rawRoots = match[1].trim();
        }
      } catch {
        // Fallback if .env cannot be read
      }
    }
  }

  if (!rawRoots) {
    rawRoots = './sample-repositories';
  }

  return rawRoots
    .split(/[;,]/)
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Validates that the target path is inside configured allowed repository roots.
 */
function isPathInsideRoots(targetPath, projectRoot, allowedRoots) {
  const resolvedTarget = path.resolve(targetPath);
  return allowedRoots.some((root) => {
    const resolvedRoot = path.isAbsolute(root)
      ? path.resolve(root)
      : path.resolve(projectRoot, root);
    const normTarget = resolvedTarget.toLowerCase();
    const normRoot = resolvedRoot.toLowerCase();
    return (
      normTarget === normRoot ||
      normTarget.startsWith(normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep)
    );
  });
}

/**
 * Inspects whether the target directory already exists and is a valid Git repository.
 */
function inspectExistingRepository(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return { exists: false };
  }

  const gitDir = path.join(targetDir, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      exists: true,
      isValid: false,
      reason: 'Directory exists but does not contain a .git directory.',
    };
  }

  try {
    const isInside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (isInside !== 'true') {
      return {
        exists: true,
        isValid: false,
        reason: 'Git rev-parse returned false for work tree status.',
      };
    }

    const commitCount = execFileSync('git', ['rev-list', '--count', '--all'], {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    const branchesRaw = execFileSync('git', ['branch', '--list'], {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    const tagsRaw = execFileSync('git', ['tag', '--list'], {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    const branches = branchesRaw
      .split('\n')
      .map((b) => b.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);

    const tags = tagsRaw
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);

    return {
      exists: true,
      isValid: true,
      commitCount: parseInt(commitCount, 10),
      branches,
      tags,
    };
  } catch (err) {
    return {
      exists: true,
      isValid: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Main function to generate the deterministic demo Git repository.
 */
function setupDemoRepo(options = {}) {
  const gitVersion = checkGitAvailability();

  const projectRoot = options.projectRoot || path.resolve(__dirname, '..');
  const allowedRoots = options.allowedRoots || getAllowedRoots(projectRoot);
  const targetDir =
    options.targetDir || path.resolve(projectRoot, 'sample-repositories', 'gitscope-demo');

  // Security check: ensure target directory resides within ALLOWED_REPOSITORY_ROOTS
  if (!isPathInsideRoots(targetDir, projectRoot, allowedRoots)) {
    const msg = `Security Boundary Violation: Target directory "${targetDir}" is outside ALLOWED_REPOSITORY_ROOTS: [${allowedRoots.join(', ')}]`;
    console.error(`[ERROR] ${msg}`);
    if (options.throwOnError) {
      throw new Error(msg);
    }
    process.exit(1);
  }

  // Idempotency check: if valid repository already exists, report and exit safely
  const existing = inspectExistingRepository(targetDir);
  if (existing.exists) {
    if (existing.isValid) {
      console.log(`[INFO] Demo repository already exists at: ${targetDir}`);
      console.log(
        `[INFO] Status: ${existing.commitCount} commits, ${existing.branches.length} branches (${existing.branches.join(', ')}), ${existing.tags.length} tags (${existing.tags.join(', ')})`,
      );
      console.log(
        '[INFO] Setup is idempotent: existing repository was preserved without modifications.',
      );
      return {
        success: true,
        targetDir,
        alreadyExisted: true,
        commitCount: existing.commitCount,
        branches: existing.branches,
        tags: existing.tags,
      };
    } else {
      const msg = `Target path "${targetDir}" already exists but is not a valid Git repository (${existing.reason}). To prevent data loss, setup will not overwrite existing directories.`;
      console.error(`[ERROR] ${msg}`);
      if (options.throwOnError) {
        throw new Error(msg);
      }
      process.exit(1);
    }
  }

  console.log(`[SETUP] Initializing deterministic Git demo fixture using ${gitVersion}...`);
  console.log(`[SETUP] Destination: ${targetDir}`);

  // Create target directory structure
  fs.mkdirSync(targetDir, { recursive: true });

  // Safe Git command executor with argument arrays
  const git = (args, envOverrides = {}) => {
    return execFileSync('git', args, {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        ...envOverrides,
      },
    });
  };

  // Helper to write files and stage them
  const writeFile = (relPath, content) => {
    const fullPath = path.join(targetDir, relPath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf8');
    git(['add', relPath]);
  };

  // Helper to create commits with deterministic author, committer, and dates
  const commit = (author, date, message) => {
    git(['commit', '-m', message], {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      GIT_COMMITTER_DATE: date,
    });
  };

  // Helper to merge branches with no fast-forward (--no-ff)
  const merge = (branchName, author, date, message) => {
    git(['merge', '--no-ff', branchName, '-m', message], {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      GIT_COMMITTER_DATE: date,
    });
  };

  // Initialize repository with clean configuration
  git(['init']);
  git(['branch', '-M', 'main']);
  git(['config', 'core.quotepath', 'false']);
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'user.name', 'GitScope Demo']);
  git(['config', 'user.email', 'demo@gitscope.local']);

  // Deterministic contributors
  const AUTHORS = {
    alex: { name: 'Alex Rivera', email: 'alex.rivera@gitscope.demo' },
    elena: { name: 'Elena Rostova', email: 'elena.rostova@gitscope.demo' },
    sam: { name: 'Sam Chen', email: 'sam.chen@gitscope.demo' },
  };

  // --------------------------------------------------------------------------
  // Commit 1: Initial project scaffold (Alex)
  // --------------------------------------------------------------------------
  writeFile(
    'package.json',
    JSON.stringify(
      {
        name: 'demo-service',
        version: '0.1.0',
        description: 'Deterministic microservice fixture for GitScope analytics demonstration',
        main: 'dist/server.js',
        scripts: { build: 'tsc', start: 'node dist/server.js' },
        dependencies: { fastify: '^4.28.0', pino: '^9.0.0' },
      },
      null,
      2,
    ) + '\n',
  );

  writeFile(
    'README.md',
    `# Demo Service

A lightweight demonstration backend service created as a deterministic fixture for **GitScope**.

## Features
- Fastify HTTP server with lifecycle telemetry
- SQLite local database adapter
- Token-based authentication module
- Metrics pipeline and collector
`,
  );

  writeFile(
    'src/config.ts',
    `export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  environment: 'development' | 'production' | 'test';
}

export const config: AppConfig = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || './data/app.db',
  environment: (process.env.NODE_ENV as any) || 'development',
};
`,
  );

  writeFile(
    'src/server.ts',
    `import { config } from './config';

export function createServer() {
  console.log(\`[Server] Booting demo service on \${config.host}:\${config.port}...\`);
  return {
    listen: async () => console.log('[Server] Listening for incoming requests'),
    close: async () => console.log('[Server] Shutting down'),
  };
}

if (require.main === module) {
  const app = createServer();
  app.listen();
}
`,
  );

  writeFile(
    'legacy-config.json',
    JSON.stringify({ legacyMode: true, deprecatedSince: 'v0.1.0' }, null, 2) + '\n',
  );

  commit(
    AUTHORS.alex,
    '2026-01-10T10:00:00+0000',
    'feat: scaffold initial server application and configuration',
  );
  git(['tag', 'v0.1.0']);

  // --------------------------------------------------------------------------
  // Commit 2: Database and User Model (Elena)
  // --------------------------------------------------------------------------
  writeFile(
    'src/models/user.ts',
    `export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  createdAt: string;
}

export function sanitizeUser(user: User): Omit<User, 'role'> {
  const { role, ...rest } = user;
  return rest;
}
`,
  );

  writeFile(
    'src/database.ts',
    `export interface DatabaseConnection {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
  close: () => Promise<void>;
}

export async function initDatabase(): Promise<DatabaseConnection> {
  console.log('[DB] Connecting to SQLite storage...');
  return {
    query: async () => [],
    close: async () => console.log('[DB] Connection closed'),
  };
}
`,
  );

  commit(
    AUTHORS.elena,
    '2026-01-11T11:00:00+0000',
    'feat(db): add user model and sqlite connection manager',
  );

  // --------------------------------------------------------------------------
  // Commit 3: Server database integration & health check (Sam)
  // [Co-change 1: src/server.ts & src/config.ts]
  // --------------------------------------------------------------------------
  writeFile(
    'src/config.ts',
    `export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  healthCheckEnabled: boolean;
  environment: 'development' | 'production' | 'test';
}

export const config: AppConfig = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || './data/app.db',
  healthCheckEnabled: process.env.HEALTH_CHECK !== 'false',
  environment: (process.env.NODE_ENV as any) || 'development',
};
`,
  );

  writeFile(
    'src/server.ts',
    `import { config } from './config';
import { initDatabase } from './database';

export async function createServer() {
  const db = await initDatabase();
  console.log(\`[Server] Booting demo service on \${config.host}:\${config.port}...\`);

  return {
    db,
    listen: async () => {
      if (config.healthCheckEnabled) {
        console.log('[Server] Health check endpoint active at /health');
      }
      console.log('[Server] Ready for connections');
    },
    close: async () => {
      await db.close();
      console.log('[Server] Shutdown complete');
    },
  };
}
`,
  );

  commit(
    AUTHORS.sam,
    '2026-01-12T09:30:00+0000',
    'feat(server): register database lifecycle hooks and health check',
  );

  // --------------------------------------------------------------------------
  // Commit 4: Architecture documentation (Alex)
  // --------------------------------------------------------------------------
  writeFile(
    'docs/architecture.md',
    `# System Architecture

## Overview
The demo service implements a clean layered design:

\`\`\`
  [ HTTP Clients ]
         │
         ▼
  [ Fastify Server / Routes ] ──► [ Auth Middleware ]
         │
         ▼
  [ Service Layer ]
         │
         ▼
  [ SQLite Data Layer ]
\`\`\`

## Modules
- \`src/server.ts\`: Entrypoint and lifecycle coordination.
- \`src/config.ts\`: Centralized typed runtime settings.
- \`src/database.ts\`: SQLite database client pool.
- \`src/models/\`: Domain entities and validation rules.
`,
  );

  writeFile(
    'README.md',
    `# Demo Service

A lightweight demonstration backend service created as a deterministic fixture for **GitScope**.

## Features
- Fastify HTTP server with lifecycle telemetry
- SQLite local database adapter
- Token-based authentication module
- Metrics pipeline and collector

## Documentation
See [Architecture Overview](docs/architecture.md) for module decomposition.
`,
  );

  commit(
    AUTHORS.alex,
    '2026-01-13T14:00:00+0000',
    'docs: document application architecture and core modules',
  );

  // --------------------------------------------------------------------------
  // Commit 5: Create branch feature/auth-service & initial tokens (Elena)
  // --------------------------------------------------------------------------
  git(['checkout', '-b', 'feature/auth-service']);

  writeFile(
    'src/auth/tokens.ts',
    `export interface AuthTokenPayload {
  userId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

export function generateToken(userId: string, email: string): string {
  const payload: AuthTokenPayload = {
    userId,
    email,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}
`,
  );

  writeFile(
    'src/auth/service.ts',
    `import { generateToken, AuthTokenPayload } from './tokens';

export class AuthService {
  async authenticateUser(email: string): Promise<string | null> {
    if (!email) return null;
    return generateToken('usr_' + Date.now(), email);
  }
}
`,
  );

  commit(
    AUTHORS.elena,
    '2026-01-14T10:15:00+0000',
    'feat(auth): implement token generator and auth service stub',
  );

  // --------------------------------------------------------------------------
  // Commit 6: Add claims verification & user model integration (Elena)
  // [Co-change 1: src/auth/service.ts & src/auth/tokens.ts & src/models/user.ts]
  // --------------------------------------------------------------------------
  writeFile(
    'src/models/user.ts',
    `export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: 'admin' | 'member';
  createdAt: string;
}

export function sanitizeUser(user: User): Omit<User, 'passwordHash' | 'role'> {
  const { passwordHash, role, ...rest } = user;
  return rest;
}
`,
  );

  writeFile(
    'src/auth/tokens.ts',
    `export interface AuthTokenPayload {
  userId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

export function generateToken(userId: string, email: string): string {
  const payload: AuthTokenPayload = {
    userId,
    email,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const parsed = JSON.parse(raw) as AuthTokenPayload;
    if (parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
`,
  );

  writeFile(
    'src/auth/service.ts',
    `import { generateToken, verifyToken, AuthTokenPayload } from './tokens';
import { User, sanitizeUser } from '../models/user';

export class AuthService {
  async authenticateUser(user: User): Promise<string> {
    return generateToken(user.id, user.email);
  }

  async validateSession(token: string): Promise<AuthTokenPayload | null> {
    return verifyToken(token);
  }
}
`,
  );

  commit(
    AUTHORS.elena,
    '2026-01-15T13:45:00+0000',
    'feat(auth): add password hashing and session claims verification',
  );

  // --------------------------------------------------------------------------
  // Commit 7: In parallel on main branch - optimize graceful shutdown (Alex)
  // [Co-change 2: src/server.ts & src/config.ts]
  // --------------------------------------------------------------------------
  git(['checkout', 'main']);

  writeFile(
    'src/config.ts',
    `export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  healthCheckEnabled: boolean;
  shutdownTimeoutMs: number;
  environment: 'development' | 'production' | 'test';
}

export const config: AppConfig = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || './data/app.db',
  healthCheckEnabled: process.env.HEALTH_CHECK !== 'false',
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS || 5000),
  environment: (process.env.NODE_ENV as any) || 'development',
};
`,
  );

  writeFile(
    'src/server.ts',
    `import { config } from './config';
import { initDatabase } from './database';

export async function createServer() {
  const db = await initDatabase();
  console.log(\`[Server] Booting demo service on \${config.host}:\${config.port}...\`);

  const server = {
    db,
    listen: async () => {
      if (config.healthCheckEnabled) {
        console.log('[Server] Health check endpoint active at /health');
      }
      console.log('[Server] Ready for connections');
    },
    close: async () => {
      console.log(\`[Server] Graceful drain initiated (timeout: \${config.shutdownTimeoutMs}ms)\`);
      await db.close();
      console.log('[Server] Shutdown complete');
    },
  };

  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => server.close());

  return server;
}
`,
  );

  commit(
    AUTHORS.alex,
    '2026-01-16T16:00:00+0000',
    'refactor(server): optimize graceful shutdown handlers',
  );

  // --------------------------------------------------------------------------
  // Commit 8: On feature/auth-service - token refresh unit test assertions (Sam)
  // [Co-change 2: src/auth/service.ts & src/auth/tokens.ts]
  // --------------------------------------------------------------------------
  git(['checkout', 'feature/auth-service']);

  writeFile(
    'src/auth/tokens.ts',
    `export interface AuthTokenPayload {
  userId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
  tokenVersion?: number;
}

export function generateToken(userId: string, email: string, version = 1): string {
  const payload: AuthTokenPayload = {
    userId,
    email,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
    tokenVersion: version,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const parsed = JSON.parse(raw) as AuthTokenPayload;
    if (parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
`,
  );

  writeFile(
    'src/auth/service.ts',
    `import { generateToken, verifyToken, AuthTokenPayload } from './tokens';
import { User } from '../models/user';

export class AuthService {
  async authenticateUser(user: User): Promise<string> {
    return generateToken(user.id, user.email, 2);
  }

  async validateSession(token: string): Promise<AuthTokenPayload | null> {
    return verifyToken(token);
  }

  async refreshToken(currentToken: string): Promise<string | null> {
    const payload = verifyToken(currentToken);
    if (!payload) return null;
    return generateToken(payload.userId, payload.email, (payload.tokenVersion || 1) + 1);
  }
}
`,
  );

  commit(
    AUTHORS.sam,
    '2026-01-17T11:20:00+0000',
    'test(auth): add unit test assertions for token refresh',
  );

  // --------------------------------------------------------------------------
  // Commit 9: Merge feature/auth-service into main (Elena) [MERGE COMMIT]
  // --------------------------------------------------------------------------
  git(['checkout', 'main']);

  merge(
    'feature/auth-service',
    AUTHORS.elena,
    '2026-01-18T15:30:00+0000',
    "Merge branch 'feature/auth-service' into main",
  );
  git(['tag', 'v0.2.0']);

  // --------------------------------------------------------------------------
  // Commit 10: Wire auth middleware into fastify pipeline (Alex)
  // [Co-change 3: src/server.ts & src/config.ts]
  // --------------------------------------------------------------------------
  writeFile(
    'src/config.ts',
    `export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  healthCheckEnabled: boolean;
  authRequired: boolean;
  shutdownTimeoutMs: number;
  environment: 'development' | 'production' | 'test';
}

export const config: AppConfig = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || './data/app.db',
  healthCheckEnabled: process.env.HEALTH_CHECK !== 'false',
  authRequired: process.env.AUTH_REQUIRED !== 'false',
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS || 5000),
  environment: (process.env.NODE_ENV as any) || 'development',
};
`,
  );

  writeFile(
    'src/server.ts',
    `import { config } from './config';
import { initDatabase } from './database';
import { AuthService } from './auth/service';

export async function createServer() {
  const db = await initDatabase();
  const auth = new AuthService();
  console.log(\`[Server] Booting demo service on \${config.host}:\${config.port}...\`);

  const server = {
    db,
    auth,
    listen: async () => {
      if (config.healthCheckEnabled) {
        console.log('[Server] Health check endpoint active at /health');
      }
      if (config.authRequired) {
        console.log('[Server] Security: JWT authentication middleware registered');
      }
      console.log('[Server] Ready for connections');
    },
    close: async () => {
      console.log(\`[Server] Graceful drain initiated (timeout: \${config.shutdownTimeoutMs}ms)\`);
      await db.close();
      console.log('[Server] Shutdown complete');
    },
  };

  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => server.close());

  return server;
}
`,
  );

  commit(
    AUTHORS.alex,
    '2026-01-19T09:00:00+0000',
    'feat(api): wire auth middleware into fastify routing pipeline',
  );

  // --------------------------------------------------------------------------
  // Commit 11: Create feature/metrics-pipeline branch (Sam)
  // --------------------------------------------------------------------------
  git(['checkout', '-b', 'feature/metrics-pipeline']);

  writeFile(
    'src/metrics/types.ts',
    `export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricSample {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}
`,
  );

  writeFile(
    'src/metrics/collector.ts',
    `import { MetricSample, MetricType } from './types';

export class MetricsCollector {
  private samples: MetricSample[] = [];

  record(name: string, type: MetricType, value: number, labels: Record<string, string> = {}) {
    this.samples.push({
      name,
      type,
      value,
      labels,
      timestamp: Date.now(),
    });
  }

  flush(): MetricSample[] {
    const batch = [...this.samples];
    this.samples = [];
    return batch;
  }
}
`,
  );

  commit(
    AUTHORS.sam,
    '2026-01-20T14:00:00+0000',
    'feat(metrics): introduce time-series collector abstraction',
  );

  // --------------------------------------------------------------------------
  // Commit 12: Add metric histograms and summary stats (Sam)
  // [Co-change: src/metrics/collector.ts & src/metrics/types.ts]
  // --------------------------------------------------------------------------
  writeFile(
    'src/metrics/types.ts',
    `export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricSample {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface MetricSummary {
  totalCount: number;
  median: number;
  p95: number;
  p99: number;
}
`,
  );

  writeFile(
    'src/metrics/collector.ts',
    `import { MetricSample, MetricSummary, MetricType } from './types';

export class MetricsCollector {
  private samples: MetricSample[] = [];

  record(name: string, type: MetricType, value: number, labels: Record<string, string> = {}) {
    this.samples.push({
      name,
      type,
      value,
      labels,
      timestamp: Date.now(),
    });
  }

  computeSummary(name: string): MetricSummary {
    const values = this.samples.filter((s) => s.name === name).map((s) => s.value).sort((a, b) => a - b);
    if (values.length === 0) return { totalCount: 0, median: 0, p95: 0, p99: 0 };
    return {
      totalCount: values.length,
      median: values[Math.floor(values.length * 0.5)] || 0,
      p95: values[Math.floor(values.length * 0.95)] || 0,
      p99: values[Math.floor(values.length * 0.99)] || 0,
    };
  }

  flush(): MetricSample[] {
    const batch = [...this.samples];
    this.samples = [];
    return batch;
  }
}
`,
  );

  commit(
    AUTHORS.sam,
    '2026-01-21T10:30:00+0000',
    'feat(metrics): add histogram and gauge metric types',
  );

  // --------------------------------------------------------------------------
  // Commit 13: Structured JSON logging on main (Elena)
  // [Co-change 4: src/server.ts & src/config.ts]
  // --------------------------------------------------------------------------
  git(['checkout', 'main']);

  writeFile(
    'src/utils/logger.ts',
    `export interface Logger {
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
}

export const logger: Logger = {
  info: (msg, ctx) => console.log(JSON.stringify({ level: 'info', msg, ...ctx })),
  warn: (msg, ctx) => console.warn(JSON.stringify({ level: 'warn', msg, ...ctx })),
  error: (msg, ctx) => console.error(JSON.stringify({ level: 'error', msg, ...ctx })),
};
`,
  );

  writeFile(
    'src/config.ts',
    `export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  healthCheckEnabled: boolean;
  authRequired: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  shutdownTimeoutMs: number;
  environment: 'development' | 'production' | 'test';
}

export const config: AppConfig = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || './data/app.db',
  healthCheckEnabled: process.env.HEALTH_CHECK !== 'false',
  authRequired: process.env.AUTH_REQUIRED !== 'false',
  logLevel: (process.env.LOG_LEVEL as any) || 'info',
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS || 5000),
  environment: (process.env.NODE_ENV as any) || 'development',
};
`,
  );

  writeFile(
    'src/server.ts',
    `import { config } from './config';
import { initDatabase } from './database';
import { AuthService } from './auth/service';
import { logger } from './utils/logger';

export async function createServer() {
  const db = await initDatabase();
  const auth = new AuthService();
  logger.info('Server initialization started', { host: config.host, port: config.port });

  const server = {
    db,
    auth,
    listen: async () => {
      if (config.healthCheckEnabled) {
        logger.info('Health check registered at /health');
      }
      if (config.authRequired) {
        logger.info('Security: JWT auth active');
      }
      logger.info('Server listening', { port: config.port });
    },
    close: async () => {
      logger.info('Draining connections', { timeout: config.shutdownTimeoutMs });
      await db.close();
      logger.info('Shutdown complete');
    },
  };

  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => server.close());

  return server;
}
`,
  );

  commit(
    AUTHORS.elena,
    '2026-01-22T13:15:00+0000',
    'feat(logging): structured json logging with pino integration',
  );

  // --------------------------------------------------------------------------
  // Commit 14: File rename & deletion (Alex)
  // [Rename: src/utils/logger.ts -> src/logging/logger.ts]
  // [Delete: legacy-config.json]
  // --------------------------------------------------------------------------
  fs.mkdirSync(path.join(targetDir, 'src', 'logging'), { recursive: true });
  git(['mv', 'src/utils/logger.ts', 'src/logging/logger.ts']);
  git(['rm', 'legacy-config.json']);

  // Update import in server.ts
  writeFile(
    'src/server.ts',
    `import { config } from './config';
import { initDatabase } from './database';
import { AuthService } from './auth/service';
import { logger } from './logging/logger';

export async function createServer() {
  const db = await initDatabase();
  const auth = new AuthService();
  logger.info('Server initialization started', { host: config.host, port: config.port });

  const server = {
    db,
    auth,
    listen: async () => {
      if (config.healthCheckEnabled) {
        logger.info('Health check registered at /health');
      }
      if (config.authRequired) {
        logger.info('Security: JWT auth active');
      }
      logger.info('Server listening', { port: config.port });
    },
    close: async () => {
      logger.info('Draining connections', { timeout: config.shutdownTimeoutMs });
      await db.close();
      logger.info('Shutdown complete');
    },
  };

  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => server.close());

  return server;
}
`,
  );

  commit(
    AUTHORS.alex,
    '2026-01-23T11:00:00+0000',
    'refactor(logging): organize logging module and remove deprecated config',
  );

  // --------------------------------------------------------------------------
  // Commit 15: Release 1.0.0 bump (Alex)
  // --------------------------------------------------------------------------
  writeFile(
    'package.json',
    JSON.stringify(
      {
        name: 'demo-service',
        version: '1.0.0',
        description: 'Deterministic microservice fixture for GitScope analytics demonstration',
        main: 'dist/server.js',
        scripts: { build: 'tsc', start: 'node dist/server.js' },
        dependencies: { fastify: '^4.28.0', pino: '^9.0.0' },
      },
      null,
      2,
    ) + '\n',
  );

  writeFile(
    'README.md',
    `# Demo Service (v1.0.0)

A lightweight demonstration backend service created as a deterministic fixture for **GitScope**.

## Features
- Fastify HTTP server with lifecycle telemetry
- SQLite local database adapter
- Token-based authentication module with versioning
- Metrics pipeline and collector
- Structured JSON logging

## Documentation
See [Architecture Overview](docs/architecture.md) for module decomposition.
`,
  );

  commit(
    AUTHORS.alex,
    '2026-01-24T16:45:00+0000',
    'chore(release): bump version to 1.0.0 and finalize api endpoints',
  );
  git(['tag', 'v1.0.0']);

  // Ensure default branch is main
  git(['checkout', 'main']);

  const finalCheck = inspectExistingRepository(targetDir);

  console.log('[SUCCESS] Demo Git repository fixture generated successfully!');
  console.log(`[SUCCESS] Location: ${targetDir}`);
  console.log(`[SUCCESS] Total commits: ${finalCheck.commitCount}`);
  console.log(`[SUCCESS] Branches: ${finalCheck.branches.join(', ')}`);
  console.log(`[SUCCESS] Tags: ${finalCheck.tags.join(', ')}`);
  console.log('[SUCCESS] Ready for exploration in GitScope.');

  return {
    success: true,
    targetDir,
    alreadyExisted: false,
    commitCount: finalCheck.commitCount,
    branches: finalCheck.branches,
    tags: finalCheck.tags,
  };
}

if (require.main === module) {
  setupDemoRepo();
}

module.exports = { setupDemoRepo, checkGitAvailability, inspectExistingRepository };
