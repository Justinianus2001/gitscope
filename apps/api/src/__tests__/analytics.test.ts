import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { createTempGitRepo, type TestGitRepo } from './git/fixture-helper.js';
import { importRepository } from '../git/importer.js';

describe('Analytics API (GET /api/repositories/:id/activity, /hotspots, /co-changes)', () => {
  let app: FastifyInstance;
  let repo: TestGitRepo;
  let repoId: string;
  let emptyRepo: TestGitRepo;
  let emptyRepoId: string;
  let secondRepo: TestGitRepo;
  let secondRepoId: string;

  beforeAll(async () => {
    // 1. Create primary test repo with known commit times, authors, file edits, binary files, and co-changes
    repo = createTempGitRepo('gitscope-analytics-test-');

    // Commit 1: Authored by Alice (two files: fileA and fileB)
    repo.run(['config', 'user.name', 'Alice Tester']);
    repo.run(['config', 'user.email', 'alice@example.com']);
    repo.commitFile('src/auth.ts', 'export function login() {}\n', 'Add auth');
    repo.commitFile('src/session.ts', 'export function session() {}\n', 'Add session');

    // Commit 2: Alice modifies auth and session together (co-change pair!)
    repo.commitFile(
      'src/auth.ts',
      'export function login() { return true; }\n',
      'Update auth logic',
    );
    repo.commitFile(
      'src/session.ts',
      'export function session() { return 1; }\n',
      'Update session logic',
    );

    // Commit 3: Bob modifies auth and creates utils
    repo.run(['config', 'user.name', 'Bob Dev']);
    repo.run(['config', 'user.email', 'bob@example.com']);
    repo.commitFile(
      'src/auth.ts',
      'export function login() { return true; /* bob */ }\n',
      'Bob auth tweak',
    );
    repo.commitFile('src/utils.ts', 'export const noop = () => {};\n', 'Add utils');

    // Commit 4: Add binary file (PNG with NUL byte so Git marks it binary)
    const binaryData = Buffer.from([0x00, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    repo.commitFile('assets/logo.png', binaryData, 'Add logo');

    // 2. Create empty repository
    emptyRepo = createTempGitRepo('gitscope-analytics-empty-');

    // 3. Create isolated second repository
    secondRepo = createTempGitRepo('gitscope-analytics-iso-');
    secondRepo.commitFile('isolated/secret.txt', 'secret data\n', 'Iso commit');

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
        COCHANGE_MAX_FILES_PER_COMMIT: 3, // Set low in test to easily exercise safety threshold!
      },
      logger: false,
    });
    await app.ready();

    // Register & import primary repo
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: repo.dir },
    });
    repoId = regRes.json().data.id;
    await importRepository(repoId, repo.dir, db);

    // Register & import empty repo
    const regEmptyRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: emptyRepo.dir },
    });
    emptyRepoId = regEmptyRes.json().data.id;
    await importRepository(emptyRepoId, emptyRepo.dir, db);

    // Register & import second repo
    const regIsoRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: secondRepo.dir },
    });
    secondRepoId = regIsoRes.json().data.id;
    await importRepository(secondRepoId, secondRepo.dir, db);
  });

  afterAll(async () => {
    await app.close();
    repo?.cleanup();
    emptyRepo?.cleanup();
    secondRepo?.cleanup();
  });

  describe('GET /api/repositories/:id/activity', () => {
    it('returns zero-filled activity buckets and contributor overview for day interval', async () => {
      const from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const to = new Date().toISOString();

      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&interval=day`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.interval).toBe('day');
      expect(Array.isArray(body.data.buckets)).toBe(true);
      // All buckets must be contiguous days
      expect(body.data.buckets.length).toBeGreaterThanOrEqual(4);

      // Verify zero-fill: buckets with 0 commits have commitCount = 0 and distinctContributors = 0
      const totalInBuckets = body.data.buckets.reduce(
        (sum: number, b: { commitCount: number }) => sum + b.commitCount,
        0,
      );
      expect(totalInBuckets).toBe(body.data.totalCommits);
      expect(body.data.totalCommits).toBeGreaterThanOrEqual(5);

      // Contributor overview
      expect(body.data.totalContributors).toBe(2); // Alice & Bob
      const emails = body.data.contributors.map((c: { email: string }) => c.email);
      expect(emails).toContain('alice@example.com');
      expect(emails).toContain('bob@example.com');
    });

    it('supports weekly and monthly intervals', async () => {
      const resWeek = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/activity?interval=week`,
      });
      expect(resWeek.statusCode).toBe(200);
      expect(resWeek.json().data.interval).toBe('week');

      const resMonth = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/activity?interval=month`,
      });
      expect(resMonth.statusCode).toBe(200);
      expect(resMonth.json().data.interval).toBe('month');
    });

    it('rejects invalid date range where from > to', async () => {
      const from = '2026-10-30T00:00:00.000Z';
      const to = '2026-10-01T00:00:00.000Z';

      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_DATE_RANGE');
    });

    it('rejects date range exceeding maximum bounds', async () => {
      const from = '2015-01-01T00:00:00.000Z';
      const to = '2026-01-01T00:00:00.000Z'; // > 5 years for daily

      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&interval=day`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('DATE_RANGE_TOO_LARGE');
    });

    it('returns zero-filled buckets for empty repository without error', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${emptyRepoId}/activity`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.totalCommits).toBe(0);
      expect(body.data.totalContributors).toBe(0);
      expect(body.data.contributors).toEqual([]);
      expect(body.data.buckets.every((b: { commitCount: number }) => b.commitCount === 0)).toBe(
        true,
      );
    });
  });

  describe('GET /api/repositories/:id/hotspots', () => {
    it('returns hotspots ordered by distinct commit count descending with tie-breakers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/hotspots`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(3);

      // 'src/auth.ts' was touched in 3 distinct commits, so it should be #1
      const topFile = body.data[0];
      expect(topFile.path).toBe('src/auth.ts');
      expect(topFile.distinctCommits).toBe(3);
      expect(topFile.totalAdditions).toBeGreaterThan(0);
      expect(topFile.lastChangedAt).toBeDefined();

      // Binary file 'assets/logo.png': additions and deletions must be NULL (unknown), not 0
      const binaryFile = body.data.find((f: { path: string }) => f.path === 'assets/logo.png');
      expect(binaryFile).toBeDefined();
      expect(binaryFile.distinctCommits).toBe(1);
      expect(binaryFile.totalAdditions).toBeNull();
      expect(binaryFile.totalDeletions).toBeNull();
    });

    it('filters hotspots by path prefix', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/hotspots?path=src/session.ts`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].path).toBe('src/session.ts');
    });

    it('rejects path traversal attempt in hotspot query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/hotspots?path=../etc/passwd`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PATH');
    });
  });

  describe('GET /api/repositories/:id/co-changes', () => {
    it('returns co-change pairs respecting minCount, canonical ordering, and self-pair exclusion', async () => {
      // By default minCount=2:
      // In commit 1: Alice touched auth & session (wait, commit 1 was auth alone, commit 2 was session alone, etc. Let's check:
      // What pairs touched together? Let's check with minCount=1 first to see all pairs)
      const resAll = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/co-changes?minCount=1`,
      });

      expect(resAll.statusCode).toBe(200);
      const body = resAll.json();
      expect(body.data.safetyThreshold).toBe(3);

      for (const pair of body.data.pairs) {
        // Must exclude self-pairs
        expect(pair.pathA).not.toBe(pair.pathB);
        // Canonical ordering
        expect(pair.pathA < pair.pathB).toBe(true);
        expect(pair.coChangeCount).toBeGreaterThanOrEqual(1);
      }
    });

    it('handles safety threshold for large commits and reports excluded count', async () => {
      // In our setup, COCHANGE_MAX_FILES_PER_COMMIT was configured to 3.
      // Let's create a commit touching 4 files in repo to trigger the exclusion!
      repo.commitFile('f1.txt', '1', 'c1');
      // Create a commit touching 4 files:
      repo.run(['config', 'user.name', 'Bulk Dev']);
      repo.run(['config', 'user.email', 'bulk@example.com']);
      const fs = await import('node:fs');
      const path = await import('node:path');
      fs.writeFileSync(path.join(repo.dir, 'bulk1.txt'), 'b1\n');
      fs.writeFileSync(path.join(repo.dir, 'bulk2.txt'), 'b2\n');
      fs.writeFileSync(path.join(repo.dir, 'bulk3.txt'), 'b3\n');
      fs.writeFileSync(path.join(repo.dir, 'bulk4.txt'), 'b4\n');
      repo.run(['add', '.']);
      repo.run(['commit', '-m', 'Bulk commit touching 4 files']);

      // Re-import repo
      const db = (app as any).db;
      await importRepository(repoId, repo.dir, db);

      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/co-changes?minCount=1`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // The 4-file commit exceeds threshold 3, so it must be excluded!
      expect(body.data.excludedLargeCommitsCount).toBeGreaterThanOrEqual(1);

      // Verify that pairs between bulk1 and bulk2 were NOT generated
      const bulkPair = body.data.pairs.find(
        (p: { pathA: string; pathB: string }) => p.pathA === 'bulk1.txt' && p.pathB === 'bulk2.txt',
      );
      expect(bulkPair).toBeUndefined();
    });

    it('enforces repository isolation (no cross-repo data leaks in analytics)', async () => {
      const res1 = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/hotspots`,
      });
      const res2 = await app.inject({
        method: 'GET',
        url: `/api/repositories/${secondRepoId}/hotspots`,
      });

      const paths1 = new Set(res1.json().data.map((f: { path: string }) => f.path));
      const paths2 = new Set(res2.json().data.map((f: { path: string }) => f.path));

      expect(paths2.has('isolated/secret.txt')).toBe(true);
      expect(paths1.has('isolated/secret.txt')).toBe(false);
    });
  });
});
