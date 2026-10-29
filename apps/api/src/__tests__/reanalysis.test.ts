import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { createDb } from '../db/client.js';
import { migrate } from '../db/migrator.js';
import { importRepository, ImporterError } from '../git/importer.js';
import { createTempGitRepo, type TestGitRepo } from './git/fixture-helper.js';

describe('Repository Re-Analysis & Edge Case Audit', () => {
  let db: Database.Database;
  let tempRepo: TestGitRepo;

  beforeEach(() => {
    db = createDb({ path: ':memory:' });
    migrate(db);
    tempRepo = createTempGitRepo();
  });

  afterEach(() => {
    db.close();
    tempRepo.cleanup();
  });

  function registerRepo(canonicalPath: string, name = 'test-audit-repo'): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO repositories (id, name, canonical_path, default_branch, last_analyzed_at, created_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, ?, ?)
    `,
    ).run(id, name, canonicalPath, now, now);
    return id;
  }

  it('1. updates incrementally when new commits are added to existing branch', async () => {
    tempRepo.commitFile('README.md', '# Initial\n', 'Initial commit');
    const repoId = registerRepo(tempRepo.dir);

    // Initial import
    const run1 = await importRepository(repoId, tempRepo.dir, db);
    expect(run1.status).toBe('completed');
    expect(run1.commitsProcessed).toBe(1);

    // Add a second commit
    tempRepo.commitFile('src/index.ts', 'console.log("hello");\n', 'Add index');
    const run2 = await importRepository(repoId, tempRepo.dir, db);
    expect(run2.status).toBe('completed');
    expect(run2.commitsProcessed).toBe(2);

    const commits = db
      .prepare('SELECT hash, subject FROM commits WHERE repo_id = ?')
      .all(repoId) as { hash: string; subject: string }[];
    expect(commits).toHaveLength(2);
    const initialCommit = commits.find((c) => c.subject === 'Initial commit')!;
    const secondCommit = commits.find((c) => c.subject === 'Add index')!;
    expect(initialCommit).toBeDefined();
    expect(secondCommit).toBeDefined();

    // Verify parent relationships
    const parents = db
      .prepare('SELECT parent_hash FROM commit_parents WHERE repo_id = ? AND commit_hash = ?')
      .all(repoId, secondCommit.hash) as { parent_hash: string }[];
    expect(parents).toHaveLength(1);
    expect(parents[0]!.parent_hash).toBe(initialCommit.hash);
  });

  it('2. reflects newly created branches and tags correctly in refs table', async () => {
    tempRepo.commitFile('README.md', '# Initial\n', 'Initial commit');
    const repoId = registerRepo(tempRepo.dir);

    await importRepository(repoId, tempRepo.dir, db);

    // Create a new branch and tag
    tempRepo.createBranch('feature/audit');
    tempRepo.createTag('v1.0.0-rc1');

    await importRepository(repoId, tempRepo.dir, db);

    const refs = db
      .prepare('SELECT name, ref_type, target_hash FROM refs WHERE repo_id = ? ORDER BY name ASC')
      .all(repoId) as { name: string; ref_type: string; target_hash: string }[];

    expect(refs.some((r) => r.name === 'feature/audit' && r.ref_type === 'branch')).toBe(true);
    expect(refs.some((r) => r.name === 'v1.0.0-rc1' && r.ref_type === 'tag')).toBe(true);
  });

  it('3. updates target_hash when branch or tag is moved to a different commit', async () => {
    const c1 = tempRepo.commitFile('c1.txt', '1', 'Commit 1');
    tempRepo.createTag('release');
    const repoId = registerRepo(tempRepo.dir);

    await importRepository(repoId, tempRepo.dir, db);

    const tagBefore = db
      .prepare('SELECT target_hash FROM refs WHERE repo_id = ? AND name = ?')
      .get(repoId, 'release') as { target_hash: string };
    expect(tagBefore.target_hash).toBe(c1);

    // Move tag to new commit
    const c2 = tempRepo.commitFile('c2.txt', '2', 'Commit 2');
    tempRepo.run(['tag', '-f', 'release']);

    await importRepository(repoId, tempRepo.dir, db);

    const tagAfter = db
      .prepare('SELECT target_hash FROM refs WHERE repo_id = ? AND name = ?')
      .get(repoId, 'release') as { target_hash: string };
    expect(tagAfter.target_hash).toBe(c2);
  });

  it('4. cleans up unreachable commits when history is rewritten / force-pushed', async () => {
    tempRepo.commitFile('base.txt', 'base', 'Base commit');
    const orphanedHash = tempRepo.commitFile('unwanted.txt', 'temp', 'Unwanted commit');
    const repoId = registerRepo(tempRepo.dir);

    // Initial import includes unwanted commit
    const run1 = await importRepository(repoId, tempRepo.dir, db);
    expect(run1.commitsProcessed).toBe(2);

    const commitBefore = db
      .prepare('SELECT hash FROM commits WHERE repo_id = ? AND hash = ?')
      .get(repoId, orphanedHash);
    expect(commitBefore).toBeDefined();

    // Reset branch back 1 commit (force-push rewrite equivalent)
    tempRepo.run(['reset', '--hard', 'HEAD~1']);

    // Re-analyze
    const run2 = await importRepository(repoId, tempRepo.dir, db);
    expect(run2.status).toBe('completed');
    expect(run2.commitsProcessed).toBe(1);

    // Orphaned commit should be cleanly removed from database
    const commitAfter = db
      .prepare('SELECT hash FROM commits WHERE repo_id = ? AND hash = ?')
      .get(repoId, orphanedHash);
    expect(commitAfter).toBeUndefined();

    // No orphan records in file_changes or commit_parents
    const orphanChanges = db
      .prepare('SELECT count(*) as count FROM file_changes WHERE repo_id = ? AND commit_hash = ?')
      .get(repoId, orphanedHash) as { count: number };
    expect(orphanChanges.count).toBe(0);
  });

  it('5. is pure no-op idempotent when repository is unchanged', async () => {
    tempRepo.commitFile('file.txt', 'content', 'First');
    tempRepo.commitFile('file2.txt', 'content2', 'Second');
    const repoId = registerRepo(tempRepo.dir);

    const run1 = await importRepository(repoId, tempRepo.dir, db);
    const count1 = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    const fc1 = (
      db.prepare('SELECT count(*) as count FROM file_changes WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;

    // Second import without changes
    const run2 = await importRepository(repoId, tempRepo.dir, db);
    expect(run2.status).toBe('completed');
    expect(run2.commitsProcessed).toBe(run1.commitsProcessed);

    const count2 = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    const fc2 = (
      db.prepare('SELECT count(*) as count FROM file_changes WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;

    expect(count2).toBe(count1);
    expect(fc2).toBe(fc1);
  });

  it('6. preserves existing indexed data when re-analysis fails midway', async () => {
    tempRepo.commitFile('initial.txt', 'hello', 'Initial');
    const repoId = registerRepo(tempRepo.dir);

    await importRepository(repoId, tempRepo.dir, db);
    const commitsBefore = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    expect(commitsBefore).toBe(1);

    // Abort signal causes GitRunner to cancel during execution
    const abortCtrl = new AbortController();
    abortCtrl.abort();

    const failedRun = await importRepository(repoId, tempRepo.dir, db, {
      signal: abortCtrl.signal,
    });
    expect(failedRun.status).toBe('cancelled');

    // Existing data remains completely intact
    const commitsAfter = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    expect(commitsAfter).toBe(1);

    // Analysis run record in DB is updated to cancelled
    const runRecord = db
      .prepare('SELECT status, error_code FROM analysis_runs WHERE id = ?')
      .get(failedRun.id) as { status: string; error_code: string };
    expect(runRecord.status).toBe('cancelled');
    expect(runRecord.error_code).toBe('GIT_CANCELLED');
  });

  it('7. safely handles repository directory deleted between imports', async () => {
    tempRepo.commitFile('file.txt', 'data', 'Initial');
    const repoId = registerRepo(tempRepo.dir);

    await importRepository(repoId, tempRepo.dir, db);

    // Delete repository directory from disk
    fs.rmSync(tempRepo.dir, { recursive: true, force: true });

    // Attempt re-import on missing path
    const failedRun = await importRepository(repoId, tempRepo.dir, db);
    expect(failedRun.status).toBe('failed');
    expect(failedRun.errorCode).toBe('GIT_COMMAND_FAILED');

    // Database still contains previously indexed state and is not corrupted
    const commitsAfter = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    expect(commitsAfter).toBe(1);
  });

  it('8. rejects concurrent analysis requests with ANALYSIS_ALREADY_RUNNING', async () => {
    const repoId = registerRepo(tempRepo.dir);

    // Simulate an ongoing analysis run
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO analysis_runs (id, repo_id, status, started_at, created_at)
      VALUES ('existing-active-run', ?, 'running', ?, ?)
    `,
    ).run(repoId, now, now);

    await expect(importRepository(repoId, tempRepo.dir, db)).rejects.toThrow(ImporterError);
    await expect(importRepository(repoId, tempRepo.dir, db)).rejects.toThrow(
      /already queued or in progress/,
    );
  });
});
