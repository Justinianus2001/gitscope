import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { createTempGitRepo, type TestGitRepo } from './git/fixture-helper.js';

describe('Repository Routes', () => {
  let app: FastifyInstance;
  let testRoot: string;
  let repo1: TestGitRepo;

  beforeAll(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscope-api-root-'));

    // Create valid test repositories inside testRoot
    const repo1Path = path.join(testRoot, 'repo-alpha');
    fs.mkdirSync(repo1Path, { recursive: true });
    repo1 = createTempGitRepo();
    // Copy/init repo inside testRoot
    repo1.commitFile('hello.txt', 'alpha\n', 'alpha commit');

    const db = createDb({ path: ':memory:' });
    app = await buildApp({
      db,
      config: {
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: 4000,
        WEB_PORT: 3000,
        DATABASE_PATH: ':memory:',
        ALLOWED_REPOSITORY_ROOTS: [testRoot, os.tmpdir()],
        GIT_COMMAND_TIMEOUT_MS: 30000,
        MAX_GIT_OUTPUT_BYTES: 50000000,
        COCHANGE_MAX_FILES_PER_COMMIT: 200,
      },
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    repo1?.cleanup();
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('POST /api/repositories - registers repository within allowed root', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: repo1.dir },
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.data.id).toBeDefined();
    expect(json.data.name).toBe(path.basename(repo1.dir));
    expect(json.isExisting).toBeUndefined();
  });

  it('POST /api/repositories - returns existing record idempotently on duplicate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: repo1.dir },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.isExisting).toBe(true);
    expect(json.data.name).toBe(path.basename(repo1.dir));
  });

  it('POST /api/repositories - rejects empty path with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/repositories - rejects nonexistent path with 404', async () => {
    const nonexistent = path.join(testRoot, 'does-not-exist');
    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: nonexistent },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PATH_NOT_FOUND');
  });

  it('POST /api/repositories - rejects path outside allowed roots with 403', async () => {
    const forbiddenDir = fs.mkdtempSync(path.join(os.homedir(), 'gitscope-forbidden-'));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: forbiddenDir },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('PATH_NOT_ALLOWED');
    } finally {
      fs.rmSync(forbiddenDir, { recursive: true, force: true });
    }
  });

  it('POST /api/repositories - rejects non-git directory with 422', async () => {
    const nonGit = path.join(testRoot, 'regular-dir');
    fs.mkdirSync(nonGit, { recursive: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: nonGit },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('NOT_A_GIT_REPOSITORY');
  });

  it('GET /api/repositories - lists registered repositories', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/repositories',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data[0].id).toBeDefined();
    expect(json.data[0].canonicalPath).toBeUndefined(); // Security: does not leak canonicalPath
  });

  it('GET /api/repositories/:id - returns repository details', async () => {
    const listRes = await app.inject({ method: 'GET', url: '/api/repositories' });
    const repoId = listRes.json().data[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(repoId);
  });

  it('GET /api/repositories/:id - returns 400 for invalid UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/repositories/not-a-uuid',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ID');
  });

  it('GET /api/repositories/:id - returns 404 for missing repository', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/repositories/123e4567-e89b-12d3-a456-426614174000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/repositories/:id/analyze - triggers analysis and reports status', async () => {
    const listRes = await app.inject({ method: 'GET', url: '/api/repositories' });
    const repoId = listRes.json().data[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/repositories/${repoId}/analyze`,
    });

    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.data.runId).toBeDefined();
    expect(json.data.status).toBe('queued');

    // Polling GET /api/repositories/:id/analysis
    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/analysis`,
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().data.runId).toBe(json.data.runId);
  });
});
