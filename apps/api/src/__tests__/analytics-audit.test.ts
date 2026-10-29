import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { buildApp } from '../app.js';
import { loadConfig } from '../config/index.js';
import type { FastifyInstance } from 'fastify';

describe('Analytics & Metrics Correctness Audit (docs/metrics.md)', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let repoId: string;

  beforeEach(async () => {
    const config = loadConfig({
      DATABASE_PATH: ':memory:',
      ALLOWED_REPOSITORY_ROOTS: process.cwd(),
      COCHANGE_MAX_FILES_PER_COMMIT: 5, // Set low limit to test large-commit exclusion
    });
    app = await buildApp({
      config,
      logger: false,
    });
    db = app.db;

    repoId = crypto.randomUUID();
    const now = '2026-03-01T00:00:00.000Z';
    db.prepare(
      `
      INSERT INTO repositories (id, name, canonical_path, default_branch, last_analyzed_at, created_at, updated_at)
      VALUES (?, 'test-analytics-repo', ?, 'main', ?, ?, ?)
    `,
    ).run(repoId, `/tmp/repo-${repoId}`, now, now, now);
  });

  afterEach(async () => {
    await app.close();
  });

  function insertCommit(
    hash: string,
    authorName: string,
    authorEmail: string,
    authorTime: string,
    subject = 'commit',
  ) {
    db.prepare(
      `
      INSERT INTO commits (repo_id, hash, author_name, author_email, author_time, committer_time, subject, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    ).run(repoId, hash, authorName, authorEmail, authorTime, authorTime, subject);
  }

  function insertFileChange(
    commitHash: string,
    path: string,
    additions: number | null,
    deletions: number | null,
    isBinary: boolean | null,
    changeType = 'modified',
  ) {
    db.prepare(
      `
      INSERT INTO file_changes (repo_id, commit_hash, path, old_path, change_type, additions, deletions, is_binary)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
    `,
    ).run(
      repoId,
      commitHash,
      path,
      changeType,
      additions,
      deletions,
      isBinary === null ? null : isBinary ? 1 : 0,
    );
  }

  it('1. returns zero-filled contiguous daily buckets and respects inclusive boundaries', async () => {
    // Insert commits on Day 1, Day 3
    insertCommit('c1', 'Alice', 'alice@test.com', '2026-02-01T10:00:00.000Z');
    insertCommit('c2', 'Alice', 'alice@test.com', '2026-02-03T15:30:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/activity?interval=day&from=2026-02-01T00:00:00.000Z&to=2026-02-03T23:59:59.999Z`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.totalCommits).toBe(2);
    expect(body.data.buckets).toHaveLength(3); // 2026-02-01, 2026-02-02 (zero-filled), 2026-02-03

    expect(body.data.buckets[0]).toMatchObject({
      bucket: '2026-02-01',
      commitCount: 1,
      distinctContributors: 1,
    });
    expect(body.data.buckets[1]).toMatchObject({
      bucket: '2026-02-02',
      commitCount: 0,
      distinctContributors: 0,
    });
    expect(body.data.buckets[2]).toMatchObject({
      bucket: '2026-02-03',
      commitCount: 1,
      distinctContributors: 1,
    });
  });

  it('2. correctly aligns weekly buckets to Monday and calculates ISO week across year boundary', async () => {
    // 2025-12-29 is a Monday (start of 2025-W53 or 2026-W01)
    // 2025-12-31 is Wednesday
    // 2026-01-01 is Thursday
    insertCommit('c1', 'Bob', 'bob@test.com', '2025-12-31T23:59:00.000Z');
    insertCommit('c2', 'Bob', 'bob@test.com', '2026-01-02T12:00:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/activity?interval=week&from=2025-12-29T00:00:00.000Z&to=2026-01-11T23:59:59.999Z`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.buckets.length).toBeGreaterThanOrEqual(2);

    // Both commits fall into ISO week 2026-W01 because Jan 1 2026 is Thursday
    const firstBucket = body.data.buckets[0];
    expect(firstBucket.bucket).toBe('2026-W01');
    expect(firstBucket.commitCount).toBe(2);
  });

  it('3. normalizes author identities by lowercase trimmed email and updates display name', async () => {
    // Same contributor with whitespace, casing variations, and name change
    insertCommit('c1', 'Charlie Old', '  Charlie@Domain.COM  ', '2026-02-01T10:00:00.000Z');
    insertCommit('c2', 'Charlie New', 'charlie@domain.com', '2026-02-02T10:00:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/activity?interval=day&from=2026-02-01T00:00:00.000Z&to=2026-02-02T23:59:59.999Z`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.totalContributors).toBe(1);
    expect(body.data.contributors).toHaveLength(1);
    expect(body.data.contributors[0]).toMatchObject({
      name: 'Charlie New', // Most recent author name
      commitCount: 2,
    });
  });

  it('4. falls back to author_name when author_email is empty or whitespace', async () => {
    insertCommit('c1', 'Bot Runner', '   ', '2026-02-01T10:00:00.000Z');
    insertCommit('c2', 'Bot Runner', '', '2026-02-02T10:00:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/activity?interval=day&from=2026-02-01T00:00:00.000Z&to=2026-02-02T23:59:59.999Z`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.totalContributors).toBe(1);
    expect(body.data.contributors[0].name).toBe('Bot Runner');
  });

  it('5. returns NULL for totalAdditions and totalDeletions when file is exclusively binary', async () => {
    insertCommit('c1', 'Alice', 'alice@test.com', '2026-02-01T10:00:00.000Z');
    insertFileChange('c1', 'assets/image.png', null, null, true);

    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/hotspots`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      path: 'assets/image.png',
      distinctCommits: 1,
      totalAdditions: null,
      totalDeletions: null,
    });
  });

  it('6. deduplicates multiple changes to same path within a single commit for co-changes', async () => {
    // Commit modifies fileA multiple times (e.g. rename + modification or hunk splits) and fileB
    insertCommit('c1', 'Alice', 'alice@test.com', '2026-02-01T10:00:00.000Z');
    insertFileChange('c1', 'src/a.ts', 10, 0, false);
    insertFileChange('c1', 'src/a.ts', 5, 2, false); // duplicate path in same commit
    insertFileChange('c1', 'src/b.ts', 20, 5, false);

    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/co-changes?minCount=1`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.pairs).toHaveLength(1);
    expect(body.data.pairs[0]).toMatchObject({
      pathA: 'src/a.ts',
      pathB: 'src/b.ts',
      coChangeCount: 1, // Deduplicated: only 1 co-change from this commit
    });
  });

  it('7. excludes commits exceeding COCHANGE_MAX_FILES_PER_COMMIT and reports excludedLargeCommitsCount', async () => {
    // Normal commit touching 2 files
    insertCommit('c1', 'Alice', 'alice@test.com', '2026-02-01T10:00:00.000Z');
    insertFileChange('c1', 'src/shared.ts', 1, 0, false);
    insertFileChange('c1', 'src/util.ts', 1, 0, false);

    // Large bulk commit touching 6 files (threshold configured to 5)
    insertCommit('c2', 'Alice', 'alice@test.com', '2026-02-02T10:00:00.000Z');
    for (let i = 1; i <= 6; i++) {
      insertFileChange('c2', `bulk/file_${i}.txt`, 1, 0, false);
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/co-changes?minCount=1`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.excludedLargeCommitsCount).toBe(1);
    expect(body.data.safetyThreshold).toBe(5);

    // Pairs from commit c2 must NOT be generated
    const bulkPairs = body.data.pairs.filter((p: { pathA: string }) => p.pathA.startsWith('bulk/'));
    expect(bulkPairs).toHaveLength(0);

    // Pair from commit c1 is present
    expect(body.data.pairs).toHaveLength(1);
    expect(body.data.pairs[0].pathA).toBe('src/shared.ts');
    expect(body.data.pairs[0].pathB).toBe('src/util.ts');
  });

  it('8. handles empty repository gracefully without throwing errors', async () => {
    const emptyRepoId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO repositories (id, name, canonical_path, default_branch, last_analyzed_at, created_at, updated_at)
      VALUES (?, 'empty-repo', ?, NULL, ?, ?, ?)
    `,
    ).run(emptyRepoId, `/tmp/empty-${emptyRepoId}`, now, now, now);

    const actRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${emptyRepoId}/activity?interval=day&from=2026-01-01T00:00:00.000Z&to=2026-01-03T00:00:00.000Z`,
    });
    expect(actRes.statusCode).toBe(200);
    expect(actRes.json().data.totalCommits).toBe(0);
    expect(actRes.json().data.totalContributors).toBe(0);

    const hotRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${emptyRepoId}/hotspots`,
    });
    expect(hotRes.statusCode).toBe(200);
    expect(hotRes.json().data).toEqual([]);

    const coRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${emptyRepoId}/co-changes`,
    });
    expect(coRes.statusCode).toBe(200);
    expect(coRes.json().data.pairs).toEqual([]);
    expect(coRes.json().data.excludedLargeCommitsCount).toBe(0);
  });
});
