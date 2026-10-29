import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { createDb } from '../../db/client.js';
import { migrate } from '../../db/migrator.js';
import { importRepository, ImporterError } from '../../git/importer.js';
import { createTempGitRepo, type TestGitRepo } from './fixture-helper.js';

describe('Git Importer', () => {
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

  function registerRepo(canonicalPath: string, name = 'test-repo'): string {
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

  it('handles empty repositories gracefully with 0 commits', async () => {
    const repoId = registerRepo(tempRepo.dir);

    const run = await importRepository(repoId, tempRepo.dir, db);
    expect(run.status).toBe('completed');
    expect(run.commitsProcessed).toBe(0);

    const commitsCount = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    expect(commitsCount).toBe(0);
  });

  it('imports commits, merges, renames, binary files, refs and parent relationships', async () => {
    // 1. Initial commit
    tempRepo.commitFile('README.md', '# GitScope\nWelcome.\n', 'Initial commit');

    // 2. Add binary file and a text file
    tempRepo.commitFile(
      'logo.png',
      Buffer.from([0x00, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'Add logo',
    );
    tempRepo.commitFile('docs/guide.txt', 'Line 1\nLine 2\n', 'Add guide');

    // 3. Rename file
    tempRepo.renameFile('docs/guide.txt', 'docs/manual.txt', 'Rename guide to manual');

    // 4. Create feature branch and add commit
    tempRepo.createBranch('feature');
    tempRepo.checkoutBranch('feature');
    tempRepo.commitFile('feature.txt', 'Feature work\n', 'Feature commit');

    // 5. Checkout master/main, add another commit, then merge feature branch
    const defaultBranch = tempRepo.run(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    // Branch switch back
    tempRepo.checkoutBranch(defaultBranch === 'feature' ? 'master' : defaultBranch);
    tempRepo.commitFile('changelog.md', 'Changes\n', 'Update changelog');
    tempRepo.mergeBranch('feature', 'Merge branch feature');

    // 6. Create a tag
    tempRepo.createTag('v1.0.0');

    // Register and import
    const repoId = registerRepo(tempRepo.dir);
    const run = await importRepository(repoId, tempRepo.dir, db);

    expect(run.status).toBe('completed');
    expect(run.commitsProcessed).toBeGreaterThanOrEqual(6);

    // Verify repository metadata updated
    const repoRecord = db
      .prepare('SELECT default_branch, last_analyzed_at FROM repositories WHERE id = ?')
      .get(repoId) as { default_branch: string | null; last_analyzed_at: string | null };
    expect(repoRecord.last_analyzed_at).not.toBeNull();

    // Verify commits table
    const commits = db
      .prepare('SELECT hash, subject, author_name FROM commits WHERE repo_id = ?')
      .all(repoId) as { hash: string; subject: string; author_name: string }[];
    expect(commits.length).toBe(run.commitsProcessed);
    expect(commits.some((c) => c.subject.includes('Merge branch feature'))).toBe(true);

    // Verify parent relationships for merge commit
    const mergeCommit = commits.find((c) => c.subject.includes('Merge branch feature'))!;
    const parents = db
      .prepare(
        'SELECT parent_hash, parent_index FROM commit_parents WHERE repo_id = ? AND commit_hash = ? ORDER BY parent_index ASC',
      )
      .all(repoId, mergeCommit.hash) as { parent_hash: string; parent_index: number }[];
    expect(parents).toHaveLength(2);
    expect(parents[0]!.parent_index).toBe(0);
    expect(parents[1]!.parent_index).toBe(1);

    // Verify refs table (branch and tag)
    const refs = db.prepare('SELECT name, ref_type FROM refs WHERE repo_id = ?').all(repoId) as {
      name: string;
      ref_type: string;
    }[];
    expect(refs.some((r) => r.name === 'v1.0.0' && r.ref_type === 'tag')).toBe(true);
    expect(refs.some((r) => r.name === 'feature' && r.ref_type === 'branch')).toBe(true);

    // Verify file changes: rename and binary
    const changes = db
      .prepare('SELECT path, old_path, change_type, is_binary FROM file_changes WHERE repo_id = ?')
      .all(repoId) as {
      path: string;
      old_path: string | null;
      change_type: string;
      is_binary: number | null;
    }[];

    const renamedChange = changes.find((ch) => ch.path === 'docs/manual.txt');
    expect(renamedChange).toBeDefined();
    expect(renamedChange?.old_path).toBe('docs/guide.txt');
    expect(renamedChange?.change_type).toBe('renamed');

    const binaryChange = changes.find((ch) => ch.path === 'logo.png');
    expect(binaryChange).toBeDefined();
    expect(binaryChange?.is_binary).toBe(1);
  });

  it('prevents simultaneous analysis runs for the same repository', async () => {
    const repoId = registerRepo(tempRepo.dir);

    // Artificially insert a running analysis run
    db.prepare(
      `
      INSERT INTO analysis_runs (id, repo_id, status, started_at, created_at)
      VALUES ('running-run', ?, 'running', ?, ?)
    `,
    ).run(repoId, new Date().toISOString(), new Date().toISOString());

    await expect(importRepository(repoId, tempRepo.dir, db)).rejects.toThrow(ImporterError);
    await expect(importRepository(repoId, tempRepo.dir, db)).rejects.toThrow(
      /already queued or in progress/,
    );
  });

  it('is completely idempotent when re-analyzing', async () => {
    tempRepo.commitFile('file.txt', 'v1\n', 'First');
    const repoId = registerRepo(tempRepo.dir);

    const firstRun = await importRepository(repoId, tempRepo.dir, db);
    expect(firstRun.status).toBe('completed');
    expect(firstRun.commitsProcessed).toBe(1);

    // Re-run import
    const secondRun = await importRepository(repoId, tempRepo.dir, db);
    expect(secondRun.status).toBe('completed');
    expect(secondRun.commitsProcessed).toBe(1);

    // Confirm no duplicates
    const count = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    expect(count).toBe(1);
  });

  it('preserves existing indexed data if re-analysis fails', async () => {
    tempRepo.commitFile('initial.txt', 'hello\n', 'Initial');
    const repoId = registerRepo(tempRepo.dir);

    // First successful import
    const run1 = await importRepository(repoId, tempRepo.dir, db);
    expect(run1.status).toBe('completed');

    const initialCommits = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    expect(initialCommits).toBe(1);

    // Attempt second import with a broken/nonexistent git command option or signal abort
    const abortController = new AbortController();
    abortController.abort();

    const failedRun = await importRepository(repoId, tempRepo.dir, db, {
      signal: abortController.signal,
    });

    expect(failedRun.status).toBe('cancelled');

    // Verify existing commit data was NOT erased or corrupted
    const preservedCommits = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    expect(preservedCommits).toBe(1);
  });
});
