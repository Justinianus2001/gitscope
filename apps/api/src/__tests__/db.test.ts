import { describe, it, expect } from 'vitest';
import { createDb } from '../db/client.js';
import { migrate } from '../db/migrator.js';

describe('Database & Migrations', () => {
  it('applies migrations idempotently', () => {
    const db = createDb({ path: ':memory:' });

    const appliedFirst = migrate(db);
    expect(appliedFirst.length).toBeGreaterThan(0);
    expect(appliedFirst).toContain('001_initial_schema.sql');

    // Running again should apply 0 new migrations
    const appliedSecond = migrate(db);
    expect(appliedSecond).toEqual([]);

    db.close();
  });

  it('enforces foreign key constraints', () => {
    const db = createDb({ path: ':memory:' });
    migrate(db);

    // Attempting to insert an analysis_run with non-existent repo_id must fail
    expect(() => {
      db.prepare(
        `
        INSERT INTO analysis_runs (id, repo_id, status, created_at)
        VALUES ('run-1', 'non-existent-repo', 'queued', '2026-10-29T00:00:00.000Z')
      `,
      ).run();
    }).toThrow(/FOREIGN KEY constraint failed/);

    db.close();
  });

  it('supports cascading delete for child tables', () => {
    const db = createDb({ path: ':memory:' });
    migrate(db);

    const repoId = '123e4567-e89b-12d3-a456-426614174000';
    db.prepare(
      `
      INSERT INTO repositories (id, name, canonical_path, default_branch, last_analyzed_at, created_at, updated_at)
      VALUES (?, 'test-repo', '/canonical/test-repo', 'main', NULL, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z')
    `,
    ).run(repoId);

    db.prepare(
      `
      INSERT INTO analysis_runs (id, repo_id, status, created_at)
      VALUES ('run-1', ?, 'queued', '2026-10-29T00:00:00.000Z')
    `,
    ).run(repoId);

    db.prepare(
      `
      INSERT INTO commits (repo_id, hash, author_name, author_email, author_time, committer_time, subject)
      VALUES (?, '0123456789abcdef0123456789abcdef01234567', 'Dev', 'dev@example.com', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z', 'Initial commit')
    `,
    ).run(repoId);

    // Deleting the repository should cascade-delete runs and commits
    db.prepare('DELETE FROM repositories WHERE id = ?').run(repoId);

    const runsCount = (
      db.prepare('SELECT count(*) as count FROM analysis_runs WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;
    const commitsCount = (
      db.prepare('SELECT count(*) as count FROM commits WHERE repo_id = ?').get(repoId) as {
        count: number;
      }
    ).count;

    expect(runsCount).toBe(0);
    expect(commitsCount).toBe(0);

    db.close();
  });
});
