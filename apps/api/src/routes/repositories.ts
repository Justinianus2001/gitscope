import crypto from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import {
  createRepositoryRequestSchema,
  type RepositoryListItem,
  type AnalysisStatus,
} from '@gitscope/shared';
import { validateRepositoryPath, PathValidationError } from '../git/path-validator.js';
import { importRepository } from '../git/importer.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RepoRow {
  id: string;
  name: string;
  canonical_path: string;
  default_branch: string | null;
  last_analyzed_at: string | null;
  created_at: string;
  updated_at: string;
  analysis_status?: string | null;
  commits_processed?: number | null;
}

export const repositoryRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/repositories
  fastify.post('/api/repositories', async (request, reply) => {
    const parseResult = createRepositoryRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: parseResult.error.issues[0]?.message ?? 'Invalid request body.',
        },
      });
    }

    const { path: repoPath } = parseResult.data;

    let validated;
    try {
      validated = validateRepositoryPath(repoPath, fastify.config.ALLOWED_REPOSITORY_ROOTS);
    } catch (err) {
      if (err instanceof PathValidationError) {
        const statusCode =
          err.code === 'PATH_NOT_ALLOWED' ? 403 : err.code === 'PATH_NOT_FOUND' ? 404 : 422;
        return reply.status(statusCode).send({
          error: {
            code: err.code,
            message: err.message,
          },
        });
      }
      throw err;
    }

    // Check if canonical path already registered
    const existing = fastify.db
      .prepare('SELECT * FROM repositories WHERE canonical_path = ?')
      .get(validated.canonicalPath) as RepoRow | undefined;

    if (existing) {
      const latestRun = fastify.db
        .prepare(
          'SELECT status, commits_processed FROM analysis_runs WHERE repo_id = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(existing.id) as { status: AnalysisStatus; commits_processed: number } | undefined;

      const data: RepositoryListItem = {
        id: existing.id,
        name: existing.name,
        defaultBranch: existing.default_branch,
        lastAnalyzedAt: existing.last_analyzed_at,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
        analysisStatus: latestRun?.status ?? null,
        commitsProcessed: latestRun?.commits_processed ?? 0,
      };

      return reply.status(200).send({
        data,
        isExisting: true,
      });
    }

    // Create new repository
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    fastify.db
      .prepare(
        `
        INSERT INTO repositories (id, name, canonical_path, default_branch, last_analyzed_at, created_at, updated_at)
        VALUES (?, ?, ?, NULL, NULL, ?, ?)
      `,
      )
      .run(id, validated.name, validated.canonicalPath, now, now);

    const data: RepositoryListItem = {
      id,
      name: validated.name,
      defaultBranch: null,
      lastAnalyzedAt: null,
      createdAt: now,
      updatedAt: now,
      analysisStatus: null,
      commitsProcessed: 0,
    };

    return reply.status(201).send({
      data,
    });
  });

  // GET /api/repositories
  fastify.get('/api/repositories', async () => {
    const rows = fastify.db
      .prepare(
        `
        SELECT
          r.id,
          r.name,
          r.default_branch,
          r.last_analyzed_at,
          r.created_at,
          r.updated_at,
          a.status as analysis_status,
          a.commits_processed
        FROM repositories r
        LEFT JOIN analysis_runs a ON a.id = (
          SELECT id FROM analysis_runs
          WHERE repo_id = r.id
          ORDER BY created_at DESC
          LIMIT 1
        )
        ORDER BY r.created_at DESC
      `,
      )
      .all() as RepoRow[];

    const data: RepositoryListItem[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      defaultBranch: r.default_branch,
      lastAnalyzedAt: r.last_analyzed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      analysisStatus: (r.analysis_status as AnalysisStatus) ?? null,
      commitsProcessed: r.commits_processed ?? 0,
    }));

    return { data };
  });

  // GET /api/repositories/:id
  fastify.get<{ Params: { id: string } }>('/api/repositories/:id', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_REGEX.test(id)) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID',
          message: 'Repository ID must be a valid UUID.',
        },
      });
    }

    const row = fastify.db
      .prepare(
        `
        SELECT
          r.id,
          r.name,
          r.default_branch,
          r.last_analyzed_at,
          r.created_at,
          r.updated_at,
          a.status as analysis_status,
          a.commits_processed
        FROM repositories r
        LEFT JOIN analysis_runs a ON a.id = (
          SELECT id FROM analysis_runs
          WHERE repo_id = r.id
          ORDER BY created_at DESC
          LIMIT 1
        )
        WHERE r.id = ?
      `,
      )
      .get(id) as RepoRow | undefined;

    if (!row) {
      return reply.status(404).send({
        error: {
          code: 'REPOSITORY_NOT_FOUND',
          message: 'Repository not found.',
        },
      });
    }

    const data: RepositoryListItem = {
      id: row.id,
      name: row.name,
      defaultBranch: row.default_branch,
      lastAnalyzedAt: row.last_analyzed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      analysisStatus: (row.analysis_status as AnalysisStatus) ?? null,
      commitsProcessed: row.commits_processed ?? 0,
    };

    return { data };
  });

  // POST /api/repositories/:id/analyze
  fastify.post<{ Params: { id: string } }>(
    '/api/repositories/:id/analyze',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ID',
            message: 'Repository ID must be a valid UUID.',
          },
        });
      }

      const repo = fastify.db
        .prepare('SELECT id, canonical_path FROM repositories WHERE id = ?')
        .get(id) as { id: string; canonical_path: string } | undefined;

      if (!repo) {
        return reply.status(404).send({
          error: {
            code: 'REPOSITORY_NOT_FOUND',
            message: 'Repository not found.',
          },
        });
      }

      // Check concurrency
      const activeRun = fastify.db
        .prepare(
          "SELECT id FROM analysis_runs WHERE repo_id = ? AND status IN ('queued', 'running')",
        )
        .get(id);

      if (activeRun) {
        return reply.status(409).send({
          error: {
            code: 'ANALYSIS_ALREADY_RUNNING',
            message: 'An analysis run is already queued or in progress for this repository.',
          },
        });
      }

      const runId = crypto.randomUUID();
      const now = new Date().toISOString();

      fastify.db
        .prepare(
          `
        INSERT INTO analysis_runs (
          id, repo_id, status, started_at, finished_at, error_code, error_message, commits_processed, created_at
        ) VALUES (?, ?, 'queued', NULL, NULL, NULL, NULL, 0, ?)
      `,
        )
        .run(runId, repo.id, now);

      // Run import in background asynchronously
      setImmediate(() => {
        importRepository(repo.id, repo.canonical_path, fastify.db, {
          runId,
          timeoutMs: fastify.config.GIT_COMMAND_TIMEOUT_MS,
          maxOutputBytes: fastify.config.MAX_GIT_OUTPUT_BYTES,
        }).catch((err) => {
          fastify.log.error(err, `Background import failed for repo ${repo.id}`);
        });
      });

      return reply.status(202).send({
        data: {
          runId,
          status: 'queued',
        },
      });
    },
  );

  // GET /api/repositories/:id/analysis
  fastify.get<{ Params: { id: string } }>(
    '/api/repositories/:id/analysis',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ID',
            message: 'Repository ID must be a valid UUID.',
          },
        });
      }

      const repo = fastify.db.prepare('SELECT id FROM repositories WHERE id = ?').get(id);
      if (!repo) {
        return reply.status(404).send({
          error: {
            code: 'REPOSITORY_NOT_FOUND',
            message: 'Repository not found.',
          },
        });
      }

      const run = fastify.db
        .prepare(
          `
        SELECT id, status, commits_processed, started_at, finished_at, error_code, error_message
        FROM analysis_runs
        WHERE repo_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
        )
        .get(id) as
        | {
            id: string;
            status: AnalysisStatus;
            commits_processed: number;
            started_at: string | null;
            finished_at: string | null;
            error_code: string | null;
            error_message: string | null;
          }
        | undefined;

      if (!run) {
        return { data: null };
      }

      return {
        data: {
          runId: run.id,
          status: run.status,
          commitsProcessed: run.commits_processed,
          startedAt: run.started_at,
          finishedAt: run.finished_at,
          errorCode: run.error_code,
          errorMessage: run.error_message,
        },
      };
    },
  );
};
