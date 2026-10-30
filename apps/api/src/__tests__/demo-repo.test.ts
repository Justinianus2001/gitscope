import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';

const require = createRequire(import.meta.url);
const { setupDemoRepo } = require('../../../../scripts/setup-demo-repo.js');

describe('GitScope Demo Fixture & Analytics Integration', () => {
  let app: FastifyInstance;
  let tempRoot: string;
  let demoRepoDir: string;
  let repoId: string;

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscope-demo-test-root-'));
    demoRepoDir = path.join(tempRoot, 'demo-service');

    // 1. Initial creation of demo repository fixture
    const setupResult = setupDemoRepo({
      targetDir: demoRepoDir,
      projectRoot: tempRoot,
      allowedRoots: [tempRoot],
      throwOnError: true,
    });

    expect(setupResult.success).toBe(true);
    expect(setupResult.alreadyExisted).toBe(false);
    expect(setupResult.commitCount).toBe(15);
    expect(setupResult.branches).toContain('main');
    expect(setupResult.branches).toContain('feature/auth-service');
    expect(setupResult.branches).toContain('feature/metrics-pipeline');
    expect(setupResult.tags).toContain('v0.1.0');
    expect(setupResult.tags).toContain('v0.2.0');
    expect(setupResult.tags).toContain('v1.0.0');

    // 2. Build Fastify API instance
    const db = createDb({ path: ':memory:' });
    app = await buildApp({
      db,
      config: {
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: 4000,
        WEB_PORT: 3000,
        DATABASE_PATH: ':memory:',
        ALLOWED_REPOSITORY_ROOTS: [tempRoot],
        GIT_COMMAND_TIMEOUT_MS: 30000,
        MAX_GIT_OUTPUT_BYTES: 50000000,
        COCHANGE_MAX_FILES_PER_COMMIT: 200,
      },
      logger: false,
    });
    await app.ready();
  }, 40000);

  afterAll(async () => {
    await app.close();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on busy Windows handles
    }
  });

  it('demonstrates setup idempotency: re-running setup does not modify repository', () => {
    const secondRun = setupDemoRepo({
      targetDir: demoRepoDir,
      projectRoot: tempRoot,
      allowedRoots: [tempRoot],
      throwOnError: true,
    });

    expect(secondRun.success).toBe(true);
    expect(secondRun.alreadyExisted).toBe(true);
    expect(secondRun.commitCount).toBe(15);
  });

  it('enforces security boundary: rejects target path outside allowed roots', () => {
    const forbiddenTarget = path.join(os.tmpdir(), 'forbidden-location', 'repo');
    expect(() => {
      setupDemoRepo({
        targetDir: forbiddenTarget,
        projectRoot: tempRoot,
        allowedRoots: [tempRoot],
        throwOnError: true,
      });
    }).toThrow(/Security Boundary Violation/);
  });

  it('registers demo repository in GitScope API', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: demoRepoDir },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.name).toBe('demo-service');
    expect(body.data.id).toBeDefined();

    repoId = body.data.id;
  });

  it('analyzes demo repository and ingests all commits, branches, and tags', async () => {
    const triggerRes = await app.inject({
      method: 'POST',
      url: `/api/repositories/${repoId}/analyze`,
    });
    expect(triggerRes.statusCode).toBe(202);

    // Poll until completed
    let status = 'running';
    for (let i = 0; i < 40; i++) {
      const pollRes = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/analysis`,
      });
      const data = pollRes.json().data;
      if (data.status === 'completed' || data.status === 'failed') {
        status = data.status;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(status).toBe('completed');

    // Verify repository metadata
    const repoRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}`,
    });
    const repoData = repoRes.json().data;
    expect(repoData.commitsProcessed).toBe(15);
    expect(repoData.defaultBranch).toBe('main');
  });

  it('verifies refs endpoint returns branches and release tags', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/refs`,
    });
    expect(res.statusCode).toBe(200);
    const refs = res.json().data as Array<{ name: string; refType: string }>;

    const branchNames = refs.filter((r) => r.refType === 'branch').map((r) => r.name);
    const tagNames = refs.filter((r) => r.refType === 'tag').map((r) => r.name);

    expect(branchNames).toContain('main');
    expect(branchNames).toContain('feature/auth-service');
    expect(branchNames).toContain('feature/metrics-pipeline');

    expect(tagNames).toContain('v0.1.0');
    expect(tagNames).toContain('v0.2.0');
    expect(tagNames).toContain('v1.0.0');
  });

  it('verifies commit explorer endpoint returns paginated commits with author metadata', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(15);

    // Find the merge commit
    const mergeCommit = body.data.find(
      (c: { subject: string }) => c.subject === "Merge branch 'feature/auth-service' into main",
    );
    expect(mergeCommit).toBeDefined();
    expect(mergeCommit.parentCount).toBe(2);
  });

  it('verifies ancestry graph layout returns nodes and lanes for multi-branch history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph?ref=main`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;

    // Reachable commits on main (linear + merged feature/auth-service) = 13 commits
    expect(body.nodes.length).toBe(13);

    const mergeNode = body.nodes.find(
      (n: { subject: string }) => n.subject === "Merge branch 'feature/auth-service' into main",
    );
    expect(mergeNode).toBeDefined();
    expect(mergeNode.parentHashes.length).toBe(2);
  });

  it('verifies author activity analytics returns 3 distinct contributors', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/activity?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;

    expect(body.totalCommits).toBe(15);
    expect(body.totalContributors).toBe(3);

    const authorNames = body.contributors.map((c: { name: string }) => c.name);
    expect(authorNames).toContain('Alex Rivera');
    expect(authorNames).toContain('Elena Rostova');
    expect(authorNames).toContain('Sam Chen');
  });

  it('verifies file hotspots analytics identifies high churn modules', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/hotspots`,
    });
    expect(res.statusCode).toBe(200);
    const hotspots = res.json().data as Array<{ path: string; distinctCommits: number }>;

    expect(hotspots.length).toBeGreaterThan(0);

    const serverHotspot = hotspots.find((h) => h.path === 'src/server.ts');
    const configHotspot = hotspots.find((h) => h.path === 'src/config.ts');

    expect(serverHotspot).toBeDefined();
    expect(configHotspot).toBeDefined();
    expect(serverHotspot!.distinctCommits).toBeGreaterThanOrEqual(4);
    expect(configHotspot!.distinctCommits).toBeGreaterThanOrEqual(4);
  });

  it('verifies co-change coupling analytics mines pairs committed together', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/co-changes?minCount=2`,
    });
    expect(res.statusCode).toBe(200);
    const pairs = res.json().data.pairs as Array<{
      pathA: string;
      pathB: string;
      coChangeCount: number;
    }>;

    expect(pairs.length).toBeGreaterThan(0);

    // Find server.ts <-> config.ts pair
    const serverConfigPair = pairs.find(
      (p) =>
        (p.pathA === 'src/config.ts' && p.pathB === 'src/server.ts') ||
        (p.pathA === 'src/server.ts' && p.pathB === 'src/config.ts'),
    );
    expect(serverConfigPair).toBeDefined();
    expect(serverConfigPair!.coChangeCount).toBeGreaterThanOrEqual(4);

    // Find auth/service.ts <-> auth/tokens.ts pair
    const authPair = pairs.find(
      (p) =>
        (p.pathA === 'src/auth/service.ts' && p.pathB === 'src/auth/tokens.ts') ||
        (p.pathA === 'src/auth/tokens.ts' && p.pathB === 'src/auth/service.ts'),
    );
    expect(authPair).toBeDefined();
    expect(authPair!.coChangeCount).toBeGreaterThanOrEqual(3);
  });
});
