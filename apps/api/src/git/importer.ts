import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AnalysisRun } from '@gitscope/shared';
import { runGit, GitRunnerError } from './runner.js';
import { parseGitLog, parseGitRefs } from './parser.js';
import type { ParsedCommit, ParsedRef } from './types.js';

export class ImporterError extends Error {
  constructor(
    public readonly code:
      'ANALYSIS_ALREADY_RUNNING' | 'REPOSITORY_NOT_FOUND' | 'GIT_ERROR' | 'DATABASE_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'ImporterError';
  }
}

export interface ImportOptions {
  runId?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

/**
 * Orchestrates Git repository analysis and stores results into SQLite transactionally.
 * Idempotent, handles failure recovery, and preserves previous data if re-analysis fails.
 */
export async function importRepository(
  repoId: string,
  canonicalPath: string,
  db: Database.Database,
  options: ImportOptions = {},
): Promise<AnalysisRun> {
  // 1. Verify repository exists in database
  const repo = db
    .prepare('SELECT id, default_branch FROM repositories WHERE id = ?')
    .get(repoId) as { id: string; default_branch: string | null } | undefined;

  if (!repo) {
    throw new ImporterError('REPOSITORY_NOT_FOUND', `Repository ${repoId} not found.`);
  }

  // 2. Concurrency guard: check for existing active run (except if it matches our pre-queued runId)
  const activeRun = db
    .prepare(
      "SELECT id, status FROM analysis_runs WHERE repo_id = ? AND status IN ('queued', 'running')",
    )
    .get(repoId) as { id: string; status: string } | undefined;

  if (activeRun && activeRun.id !== options.runId) {
    throw new ImporterError(
      'ANALYSIS_ALREADY_RUNNING',
      'An analysis run is already queued or in progress for this repository.',
    );
  }

  // 3. Create or update running analysis run record
  const runId = options.runId ?? crypto.randomUUID();
  const now = new Date().toISOString();

  if (!activeRun) {
    db.prepare(
      `
      INSERT INTO analysis_runs (
        id, repo_id, status, started_at, finished_at, error_code, error_message, commits_processed, created_at
      ) VALUES (?, ?, 'running', ?, NULL, NULL, NULL, 0, ?)
    `,
    ).run(runId, repoId, now, now);
  } else {
    db.prepare(
      `
      UPDATE analysis_runs
      SET status = 'running', started_at = ?
      WHERE id = ?
    `,
    ).run(now, runId);
  }

  try {
    // 4. Retrieve default branch
    let defaultBranch: string | null = repo.default_branch;
    try {
      const branchResult = await runGit(['symbolic-ref', '--short', 'HEAD'], {
        cwd: canonicalPath,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      defaultBranch = branchResult.stdout.trim() || null;
    } catch {
      // If detached or no symbolic-ref, try rev-parse
      try {
        const revParseResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: canonicalPath,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        });
        const refName = revParseResult.stdout.trim();
        if (refName && refName !== 'HEAD') {
          defaultBranch = refName;
        }
      } catch {
        // Leave defaultBranch as-is or null
      }
    }

    // 5. Ingest references (branches and tags)
    let parsedRefs: ParsedRef[] = [];
    try {
      const refsResult = await runGit(
        ['for-each-ref', '--format=%(refname)\t%(objectname)\t%(*objectname)'],
        {
          cwd: canonicalPath,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        },
      );
      parsedRefs = parseGitRefs(refsResult.stdout);
    } catch (err) {
      // If repo is empty, for-each-ref may return empty
      if (!(err instanceof GitRunnerError)) {
        throw err;
      }
    }

    // 6. Ingest commits and file changes with NUL delimiters
    let parsedCommits: ParsedCommit[] = [];
    try {
      const logResult = await runGit(
        [
          '-c',
          'core.quotepath=false',
          'log',
          '--all',
          '--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1f%b%x1e',
          '--raw',
          '--numstat',
          '-z',
        ],
        {
          cwd: canonicalPath,
          timeoutMs: options.timeoutMs,
          maxOutputBytes: options.maxOutputBytes,
          signal: options.signal,
        },
      );
      parsedCommits = parseGitLog(logResult.stdout);
    } catch (err) {
      if (err instanceof GitRunnerError) {
        // Handle empty repository: git log fails with 'does not have any commits yet'
        if (
          err.stderr.includes('does not have any commits yet') ||
          err.stderr.includes('fatal: your current branch') ||
          err.stderr.includes('unknown revision')
        ) {
          parsedCommits = [];
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // 7. Atomic SQLite transaction to write commits, parents, refs, and file changes
    const finishTime = new Date().toISOString();

    const persistTx = db.transaction(() => {
      // Clear old refs, file changes, parents, and commits for complete re-indexing idempotency
      db.prepare('DELETE FROM refs WHERE repo_id = ?').run(repoId);
      db.prepare('DELETE FROM file_changes WHERE repo_id = ?').run(repoId);
      db.prepare('DELETE FROM commit_parents WHERE repo_id = ?').run(repoId);
      db.prepare('DELETE FROM commits WHERE repo_id = ?').run(repoId);

      // Prepared statements for batch inserts
      const insertRefStmt = db.prepare(`
        INSERT INTO refs (repo_id, name, ref_type, target_hash, is_remote)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const ref of parsedRefs) {
        insertRefStmt.run(repoId, ref.name, ref.refType, ref.targetHash, ref.isRemote ? 1 : 0);
      }

      const insertCommitStmt = db.prepare(`
        INSERT OR REPLACE INTO commits (
          repo_id, hash, author_name, author_email, author_time, committer_time, subject, body
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertParentStmt = db.prepare(`
        INSERT INTO commit_parents (repo_id, commit_hash, parent_hash, parent_index)
        VALUES (?, ?, ?, ?)
      `);

      const insertFileChangeStmt = db.prepare(`
        INSERT INTO file_changes (
          repo_id, commit_hash, path, old_path, change_type, additions, deletions, is_binary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const commit of parsedCommits) {
        insertCommitStmt.run(
          repoId,
          commit.hash,
          commit.authorName,
          commit.authorEmail,
          commit.authorTime,
          commit.committerTime,
          commit.subject,
          commit.body,
        );

        commit.parentHashes.forEach((parentHash, index) => {
          insertParentStmt.run(repoId, commit.hash, parentHash, index);
        });

        for (const change of commit.fileChanges) {
          insertFileChangeStmt.run(
            repoId,
            commit.hash,
            change.path,
            change.oldPath,
            change.changeType,
            change.additions,
            change.deletions,
            change.isBinary === null ? null : change.isBinary ? 1 : 0,
          );
        }
      }

      // Update repository metadata
      db.prepare(
        `
        UPDATE repositories
        SET default_branch = ?, last_analyzed_at = ?, updated_at = ?
        WHERE id = ?
      `,
      ).run(defaultBranch, finishTime, finishTime, repoId);

      // Mark run as completed
      db.prepare(
        `
        UPDATE analysis_runs
        SET status = 'completed', finished_at = ?, commits_processed = ?
        WHERE id = ?
      `,
      ).run(finishTime, parsedCommits.length, runId);
    });

    persistTx();

    return {
      id: runId,
      repoId,
      status: 'completed',
      startedAt: now,
      finishedAt: finishTime,
      errorCode: null,
      errorMessage: null,
      commitsProcessed: parsedCommits.length,
      createdAt: now,
    };
  } catch (error) {
    const errorTime = new Date().toISOString();
    const isCancelled =
      (error instanceof GitRunnerError && error.code === 'GIT_CANCELLED') ||
      options.signal?.aborted;
    const status = isCancelled ? 'cancelled' : 'failed';
    const errorCode =
      error instanceof GitRunnerError
        ? error.code
        : error instanceof ImporterError
          ? error.code
          : (error as { name?: string }).name === 'SqliteError'
            ? 'DATABASE_ERROR'
            : 'IMPORT_FAILED';
    let errorMessage = error instanceof Error ? error.message : 'Unknown import error.';
    if (canonicalPath) {
      errorMessage = errorMessage.replaceAll(canonicalPath, '[repo_root]');
    }

    // Update analysis run record with failure status outside the failed transaction
    db.prepare(
      `
      UPDATE analysis_runs
      SET status = ?, finished_at = ?, error_code = ?, error_message = ?
      WHERE id = ?
    `,
    ).run(status, errorTime, errorCode, errorMessage, runId);

    return {
      id: runId,
      repoId,
      status,
      startedAt: now,
      finishedAt: errorTime,
      errorCode,
      errorMessage,
      commitsProcessed: 0,
      createdAt: now,
    };
  }
}
