import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { createTempGitRepo, type TestGitRepo } from './git/fixture-helper.js';
import { importRepository } from '../git/importer.js';

describe('Commit and File Routes', () => {
  let app: FastifyInstance;
  let repo: TestGitRepo;
  let repoId: string;
  let initialCommitHash: string;

  beforeAll(async () => {
    repo = createTempGitRepo('gitscope-commit-test-');

    // Build rich Git history
    initialCommitHash = repo.commitFile('docs/readme.txt', 'Hello v1\n', 'Initial commit');
    repo.commitFile('src/index.ts', 'console.log("hello");\n', 'Add source file');
    repo.renameFile('docs/readme.txt', 'docs/README.md', 'Rename readme to markdown');
    repo.commitFile('src/utils.ts', 'export const add = (a, b) => a + b;\n', 'Add utils');

    const db = createDb({ path: ':memory:' });
    app = await buildApp({
      db,
      config: {
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: 4000,
        WEB_PORT: 3000,
        DATABASE_PATH: ':memory:',
        ALLOWED_REPOSITORY_ROOTS: [os.tmpdir()],
        GIT_COMMAND_TIMEOUT_MS: 30000,
        MAX_GIT_OUTPUT_BYTES: 50000000,
        COCHANGE_MAX_FILES_PER_COMMIT: 200,
      },
      logger: false,
    });
    await app.ready();

    // Register repository
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: repo.dir },
    });
    repoId = regRes.json().data.id;

    // Run import synchronously for test setup
    await importRepository(repoId, repo.dir, db);
  });

  afterAll(async () => {
    await app.close();
    repo?.cleanup();
  });

  it('GET /api/repositories/:id/commits - returns paginated commits with stable ordering', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?limit=2`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data).toHaveLength(2);
    expect(json.page.nextCursor).toBeDefined();

    // Fetch next page using cursor
    const nextRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?limit=2&cursor=${encodeURIComponent(json.page.nextCursor)}`,
    });

    expect(nextRes.statusCode).toBe(200);
    const nextJson = nextRes.json();
    expect(nextJson.data).toHaveLength(2);
    // Commits across pages should be distinct
    const hashesPage1 = json.data.map((c: { hash: string }) => c.hash);
    const hashesPage2 = nextJson.data.map((c: { hash: string }) => c.hash);
    expect(hashesPage1.some((h: string) => hashesPage2.includes(h))).toBe(false);
  });

  it('GET /api/repositories/:id/commits - rejects malformed cursor with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?cursor=invalid_base64_json!`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_CURSOR');
  });

  it('GET /api/repositories/:id/commits - filters by author', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?author=GitScope`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it('GET /api/repositories/:id/commits - filters by path', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?path=src/utils.ts`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].subject).toBe('Add utils');
  });

  it('GET /api/repositories/:id/commits - rejects path traversal filter with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?path=../../etc/passwd`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_PATH');
  });

  it('GET /api/repositories/:id/commits - enforces repository isolation', async () => {
    const otherRepoId = '123e4567-e89b-12d3-a456-426614174000';
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${otherRepoId}/commits`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/repositories/:id/commits/:hash - returns commit details, parents, and file changes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits/${initialCommitHash}`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.hash).toBe(initialCommitHash);
    expect(json.data.subject).toBe('Initial commit');
    expect(json.data.fileChanges).toBeDefined();
    expect(json.data.fileChanges.some((f: { path: string }) => f.path === 'docs/readme.txt')).toBe(
      true,
    );
  });

  it('GET /api/repositories/:id/commits/:hash - supports abbreviated commit hash', async () => {
    const abbrev = initialCommitHash.slice(0, 7);
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits/${abbrev}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.hash).toBe(initialCommitHash);
  });

  it('GET /api/repositories/:id/commits/:hash - returns 400 for invalid hash characters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits/not-hex-chars!`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_HASH');
  });

  it('GET /api/repositories/:id/commits/:hash - returns 404 for nonexistent hash', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits/0000000000000000000000000000000000000000`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/repositories/:id/files/:path/history - returns commit history of a file including renames', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/files/docs/README.md/history`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.length).toBeGreaterThanOrEqual(1);

    // Also query history for old path
    const oldPathRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/files/docs/readme.txt/history`,
    });
    expect(oldPathRes.statusCode).toBe(200);
    expect(oldPathRes.json().data.length).toBeGreaterThanOrEqual(1);
  });
});
