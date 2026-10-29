import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildApp } from '../app.js';
import { loadConfig } from '../config/index.js';
import { createDb } from '../db/client.js';
import { migrate } from '../db/migrator.js';
import { validateRepositoryPath, PathValidationError } from '../git/path-validator.js';
import { importRepository } from '../git/importer.js';
import { createTempGitRepo, type TestGitRepo } from './git/fixture-helper.js';
import type { FastifyInstance } from 'fastify';

describe('GitScope Security & Reliability Hardening Audit', () => {
  let app: FastifyInstance;
  let testRootDir: string;
  let allowedSubdir: string;
  let outsideDir: string;
  let tempRepo: TestGitRepo;

  beforeEach(async () => {
    // Create isolated test sandbox
    testRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscope-sec-root-'));
    allowedSubdir = path.join(testRootDir, 'allowed');
    outsideDir = path.join(testRootDir, 'forbidden');
    fs.mkdirSync(allowedSubdir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    const config = loadConfig({
      DATABASE_PATH: ':memory:',
      ALLOWED_REPOSITORY_ROOTS: allowedSubdir,
      COCHANGE_MAX_FILES_PER_COMMIT: 200,
    });

    app = await buildApp({
      config,
      logger: false,
    });

    tempRepo = createTempGitRepo('gitscope-sec-repo-');
  });

  afterEach(async () => {
    await app.close();
    tempRepo.cleanup();
    try {
      fs.rmSync(testRootDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on locked Windows files
    }
  });

  describe('1. Path Boundary & Traversal Defense', () => {
    it('rejects directory traversal attempts (../ and ..\\)', () => {
      const traversalPaths = [
        path.join(allowedSubdir, '..', 'forbidden'),
        allowedSubdir + '/../forbidden',
        allowedSubdir + '\\..\\forbidden',
        path.join(allowedSubdir, 'child', '..', '..', 'forbidden'),
      ];

      for (const p of traversalPaths) {
        expect(() => validateRepositoryPath(p, [allowedSubdir])).toThrow(PathValidationError);
        try {
          validateRepositoryPath(p, [allowedSubdir]);
        } catch (err) {
          expect((err as PathValidationError).code).toMatch(
            /PATH_NOT_ALLOWED|NOT_A_GIT_REPOSITORY|PATH_NOT_FOUND/,
          );
        }
      }
    });

    it('rejects symlinks pointing outside the allowed root (symlink escape defense)', () => {
      // Create a valid git repository outside the allowed root
      const outsideRepo = createTempGitRepo('outside-repo-');
      outsideRepo.commitFile('secret.txt', 'sensitive', 'Initial');

      const symlinkPath = path.join(allowedSubdir, 'symlink-to-outside');
      try {
        fs.symlinkSync(outsideRepo.dir, symlinkPath, 'junction');
      } catch {
        // If symlink creation lacks OS permission, skip symlink test cleanly
        outsideRepo.cleanup();
        return;
      }

      // Validating the symlink must resolve canonical target and reject it
      expect(() => validateRepositoryPath(symlinkPath, [allowedSubdir])).toThrow(
        PathValidationError,
      );
      try {
        validateRepositoryPath(symlinkPath, [allowedSubdir]);
      } catch (err) {
        expect((err as PathValidationError).code).toBe('PATH_NOT_ALLOWED');
      }

      outsideRepo.cleanup();
    });

    it('rejects nonexistent paths without leaking system paths in error message', async () => {
      const fakePath = path.join(allowedSubdir, 'nonexistent-repo-' + crypto.randomUUID());

      const res = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: fakePath },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.code).toBe('PATH_NOT_FOUND');
      // Crucial: Error message must NOT reveal the raw absolute filesystem path
      expect(body.error.message).not.toContain(fakePath);
      expect(body.error.message).toBe(
        'The specified repository path does not exist or is inaccessible.',
      );
    });

    it('rejects directories lacking a .git repository', async () => {
      const notGitDir = path.join(allowedSubdir, 'plain-folder');
      fs.mkdirSync(notGitDir, { recursive: true });

      const res = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: notGitDir },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.error.code).toBe('NOT_A_GIT_REPOSITORY');
    });

    it('handles Windows drive letter casing differences safely', () => {
      // Test that uppercase vs lowercase drive letters resolve identically
      const repoDir = tempRepo.dir;
      const lowerRoot = repoDir.toLowerCase();
      const res = validateRepositoryPath(repoDir, [lowerRoot]);
      expect(res.canonicalPath).toBeDefined();
    });
  });

  describe('2. Git Argument & Flag Safety', () => {
    it('safely handles repositories whose folder names start with dashes or resemble Git flags', () => {
      const dashRepoDir = path.join(allowedSubdir, '--upload-pack=exploit');
      fs.mkdirSync(dashRepoDir, { recursive: true });
      fs.mkdirSync(path.join(dashRepoDir, '.git'), { recursive: true });

      // Path validator canonicalizes without executing git
      const validated = validateRepositoryPath(dashRepoDir, [allowedSubdir]);
      expect(validated.name).toBe('--upload-pack=exploit');
    });

    it('API path filtering rejects directory traversal via .. without invoking shell', async () => {
      // Register a valid repository inside allowedSubdir
      const realRepo = createTempGitRepo('allowed-repo-');
      realRepo.commitFile('safe.txt', 'safe', 'Initial');
      const validRepoPath = path.join(allowedSubdir, 'valid-repo');
      fs.renameSync(realRepo.dir, validRepoPath);

      const regRes = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: validRepoPath },
      });
      const repoId = regRes.json().data.id;

      // Import repo
      await importRepository(repoId, validRepoPath, app.db);

      // Attempt directory traversal in commit file path filter
      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/commits?path=../../etc/passwd`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PATH');

      // Attempt directory traversal in file history route
      const historyRes = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repoId}/files/..%2F..%2Fetc%2Fpasswd/history`,
      });
      expect(historyRes.statusCode).toBe(400);
      expect(historyRes.json().error.code).toBe('INVALID_PATH');
    });
  });

  describe('3. API Input Validation & Error Sanitization', () => {
    it('rejects malformed repository UUIDs across all endpoints with 400 INVALID_ID', async () => {
      const invalidIds = ['not-a-uuid', '123', 'admin;--DROP_TABLE'];

      for (const id of invalidIds) {
        const getEndpoints = [
          `/api/repositories/${id}`,
          `/api/repositories/${id}/analysis`,
          `/api/repositories/${id}/commits`,
          `/api/repositories/${id}/graph`,
          `/api/repositories/${id}/refs`,
          `/api/repositories/${id}/activity`,
          `/api/repositories/${id}/hotspots`,
          `/api/repositories/${id}/co-changes`,
        ];

        for (const ep of getEndpoints) {
          const res = await app.inject({ method: 'GET', url: ep });
          expect(res.statusCode).toBe(400);
          expect(res.json().error.code).toBe('INVALID_ID');
        }

        const postRes = await app.inject({
          method: 'POST',
          url: `/api/repositories/${id}/analyze`,
        });
        expect(postRes.statusCode).toBe(400);
        expect(postRes.json().error.code).toBe('INVALID_ID');
      }
    });

    it('returns 404 REPOSITORY_NOT_FOUND for non-existent UUIDs without leaking SQL schema', async () => {
      const nonExistentId = crypto.randomUUID();
      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${nonExistentId}`,
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.code).toBe('REPOSITORY_NOT_FOUND');
      expect(body.error.message).toBe('Repository not found.');
      // Confirm no stack trace or SQL internals
      expect(body).not.toHaveProperty('stack');
      expect(JSON.stringify(body)).not.toContain('sqlite');
    });

    it('sanitizes internal server error (500) responses completely', async () => {
      // Simulate unexpected database failure by closing the DB handle
      const brokenApp = await buildApp({
        config: loadConfig({ DATABASE_PATH: ':memory:' }),
      });
      brokenApp.db.close(); // Force crash on query

      const res = await brokenApp.inject({
        method: 'GET',
        url: '/api/repositories',
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(body.error.message).toBe('An unexpected internal error occurred.');
      expect(body).not.toHaveProperty('stack');
      expect(JSON.stringify(body)).not.toContain('better-sqlite3');
      expect(JSON.stringify(body)).not.toContain('SqliteError');
    });

    it('sanitizes host paths in analysis run error messages upon Git failures', async () => {
      const brokenRepoPath = path.join(allowedSubdir, 'failing-repo');
      fs.mkdirSync(brokenRepoPath, { recursive: true });
      fs.mkdirSync(path.join(brokenRepoPath, '.git'), { recursive: true });

      const regRes = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: brokenRepoPath },
      });
      const repoId = regRes.json().data.id;

      // Corrupt .git folder so git fails
      fs.writeFileSync(path.join(brokenRepoPath, '.git', 'HEAD'), 'corrupted_ref');

      const failedRun = await importRepository(repoId, brokenRepoPath, app.db);
      expect(failedRun.status).toBe('failed');
      // Verify raw host filesystem path does not leak in error message
      expect(failedRun.errorMessage).not.toContain(brokenRepoPath);
    });
  });

  describe('4. SQLite Integrity, Foreign Keys & Migration Safety', () => {
    it('enforces PRAGMA foreign_keys = ON on all database connections', () => {
      const fkStatus = app.db.pragma('foreign_keys', { simple: true });
      expect(fkStatus).toBe(1);

      // Attempt to insert commit with non-existent repo_id
      const orphanInsert = () =>
        app.db
          .prepare(
            `
          INSERT INTO commits (repo_id, hash, author_name, author_email, author_time, committer_time, subject, body)
          VALUES ('non-existent-repo', 'hash123', 'A', 'a@a.com', '2026-01-01', '2026-01-01', 'S', NULL)
        `,
          )
          .run();

      expect(orphanInsert).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('cascades repository deletion to all child tables (commits, parents, refs, file_changes, analysis_runs)', () => {
      const repoId = crypto.randomUUID();
      const now = new Date().toISOString();
      app.db
        .prepare('INSERT INTO repositories VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(repoId, 'test-cascade', '/path', 'main', now, now, now);

      app.db
        .prepare('INSERT INTO commits VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
        .run(repoId, 'h1', 'Author', 'e@e.com', now, now, 'Sub');

      app.db.prepare('INSERT INTO commit_parents VALUES (?, ?, ?, ?)').run(repoId, 'h1', 'p1', 0);

      app.db
        .prepare('INSERT INTO refs VALUES (?, ?, ?, ?, ?)')
        .run(repoId, 'main', 'branch', 'h1', 0);

      app.db
        .prepare('INSERT INTO file_changes VALUES (NULL, ?, ?, ?, NULL, ?, ?, ?, ?)')
        .run(repoId, 'h1', 'file.txt', 'modified', 1, 0, 0);

      app.db
        .prepare('INSERT INTO analysis_runs VALUES (?, ?, ?, ?, ?, NULL, NULL, 1, ?)')
        .run('run-1', repoId, 'completed', now, now, now);

      // Delete parent repository
      app.db.prepare('DELETE FROM repositories WHERE id = ?').run(repoId);

      // Verify all child tables were cascaded and have 0 records for repoId
      const commits = app.db
        .prepare('SELECT count(*) as c FROM commits WHERE repo_id = ?')
        .get(repoId) as { c: number };
      const parents = app.db
        .prepare('SELECT count(*) as c FROM commit_parents WHERE repo_id = ?')
        .get(repoId) as { c: number };
      const refs = app.db
        .prepare('SELECT count(*) as c FROM refs WHERE repo_id = ?')
        .get(repoId) as { c: number };
      const files = app.db
        .prepare('SELECT count(*) as c FROM file_changes WHERE repo_id = ?')
        .get(repoId) as { c: number };
      const runs = app.db
        .prepare('SELECT count(*) as c FROM analysis_runs WHERE repo_id = ?')
        .get(repoId) as { c: number };

      expect(commits.c).toBe(0);
      expect(parents.c).toBe(0);
      expect(refs.c).toBe(0);
      expect(files.c).toBe(0);
      expect(runs.c).toBe(0);
    });

    it('guarantees atomic transaction rollback when database write fails during import', async () => {
      tempRepo.commitFile('file.txt', 'content', 'First commit');
      const repoDir = tempRepo.dir;

      const registered = validateRepositoryPath(repoDir, [path.dirname(repoDir)]);
      const repoId = crypto.randomUUID();
      const now = new Date().toISOString();
      app.db
        .prepare('INSERT INTO repositories VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(repoId, registered.name, registered.canonicalPath, 'main', now, now, now);

      // Successful first import
      const run1 = await importRepository(repoId, registered.canonicalPath, app.db);
      expect(run1.status).toBe('completed');
      expect(run1.commitsProcessed).toBe(1);

      // Intentionally insert a conflicting read-only trigger or constraint to simulate DB failure inside persistTx
      app.db.exec(`
        CREATE TRIGGER fail_on_commit_insert BEFORE INSERT ON commits
        BEGIN
          SELECT RAISE(FAIL, 'Simulated persistent disk write failure');
        END;
      `);

      // Attempt re-analysis
      const run2 = await importRepository(repoId, registered.canonicalPath, app.db);
      expect(run2.status).toBe('failed');
      expect(run2.errorCode).toBe('DATABASE_ERROR');

      // Drop trigger
      app.db.exec('DROP TRIGGER fail_on_commit_insert;');

      // Verify existing repository data was completely rolled back and preserved
      const preservedCommits = app.db
        .prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?')
        .get(repoId) as { count: number };
      expect(preservedCommits.count).toBe(1);
    });

    it('migration runner is completely repeatable and safe on existing databases', () => {
      const testDb = createDb({ path: ':memory:' });

      // Run migrations on fresh DB
      const appliedFirst = migrate(testDb);
      expect(appliedFirst.length).toBeGreaterThanOrEqual(2); // 001_initial_schema, 002_add_old_path_index

      // Run migrations second time (idempotency check)
      const appliedSecond = migrate(testDb);
      expect(appliedSecond).toHaveLength(0);

      // Verify schema_migrations table
      const rows = testDb.prepare('SELECT id FROM schema_migrations ORDER BY id ASC').all() as {
        id: string;
      }[];
      expect(rows.map((r) => r.id)).toContain('001_initial_schema.sql');
      expect(rows.map((r) => r.id)).toContain('002_add_old_path_index.sql');

      testDb.close();
    });
  });

  describe('5. Unicode and Special Filename Ingestion', () => {
    it('correctly parses and persists filenames with Unicode, spaces, tabs and special characters', async () => {
      // Commit files with Vietnamese Unicode, spaces, and punctuation
      const unicodeFile = 'tài_liệu/báo_cáo_tài_chính_2026.txt';
      const spacesFile = 'my folder/my file (copy 1).json';
      const symbolsFile = 'special-chars/!@#$%^&()_+-=.ts';

      tempRepo.commitFile(unicodeFile, 'Nội dung tiếng Việt\n', 'Add Unicode file');
      tempRepo.commitFile(spacesFile, '{"key": "value"}\n', 'Add file with spaces');
      tempRepo.commitFile(symbolsFile, 'export const val = 1;\n', 'Add symbols file');

      const repoDir = tempRepo.dir;
      const registered = validateRepositoryPath(repoDir, [path.dirname(repoDir)]);
      const repoId = crypto.randomUUID();
      const now = new Date().toISOString();
      app.db
        .prepare('INSERT INTO repositories VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(repoId, registered.name, registered.canonicalPath, 'main', now, now, now);

      const run = await importRepository(repoId, registered.canonicalPath, app.db);
      expect(run.status).toBe('completed');
      expect(run.commitsProcessed).toBe(3);

      const changes = app.db
        .prepare('SELECT path FROM file_changes WHERE repo_id = ? ORDER BY path ASC')
        .all(repoId) as { path: string }[];

      const paths = changes.map((c) => c.path);
      expect(paths).toContain(unicodeFile);
      expect(paths).toContain(spacesFile);
      expect(paths).toContain(symbolsFile);
    });
  });
});
