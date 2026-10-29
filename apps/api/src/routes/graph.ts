import type { FastifyPluginAsync } from 'fastify';
import { getGraphQuerySchema, type GraphNode, type RefItem } from '@gitscope/shared';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_REGEX = /^[0-9a-f]{7,40}$/i;

interface RepoRow {
  id: string;
  name: string;
  default_branch: string | null;
}

interface CommitRow {
  hash: string;
  author_name: string;
  author_time: string;
  subject: string;
}

interface ParentRow {
  commit_hash: string;
  parent_hash: string;
  parent_index: number;
}

interface RefRow {
  name: string;
  ref_type: 'branch' | 'tag';
  target_hash: string;
  is_remote: number;
}

export const graphRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/repositories/:id/refs
  fastify.get<{ Params: { id: string } }>('/api/repositories/:id/refs', async (request, reply) => {
    const { id: repoId } = request.params;
    if (!UUID_REGEX.test(repoId)) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID',
          message: 'Repository ID must be a valid UUID.',
        },
      });
    }

    const repo = fastify.db.prepare('SELECT id FROM repositories WHERE id = ?').get(repoId);
    if (!repo) {
      return reply.status(404).send({
        error: {
          code: 'REPOSITORY_NOT_FOUND',
          message: 'Repository not found.',
        },
      });
    }

    const rows = fastify.db
      .prepare(
        `
          SELECT name, ref_type, target_hash, is_remote
          FROM refs
          WHERE repo_id = ?
          ORDER BY ref_type ASC, is_remote ASC, name ASC
        `,
      )
      .all(repoId) as RefRow[];

    const refs: RefItem[] = rows.map((r) => ({
      name: r.name,
      refType: r.ref_type,
      targetHash: r.target_hash,
      isRemote: Boolean(r.is_remote),
    }));

    return { data: refs };
  });

  // GET /api/repositories/:id/graph
  fastify.get<{ Params: { id: string } }>('/api/repositories/:id/graph', async (request, reply) => {
    const { id: repoId } = request.params;
    if (!UUID_REGEX.test(repoId)) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID',
          message: 'Repository ID must be a valid UUID.',
        },
      });
    }

    const repo = fastify.db
      .prepare('SELECT id, name, default_branch FROM repositories WHERE id = ?')
      .get(repoId) as RepoRow | undefined;

    if (!repo) {
      return reply.status(404).send({
        error: {
          code: 'REPOSITORY_NOT_FOUND',
          message: 'Repository not found.',
        },
      });
    }

    const queryParse = getGraphQuerySchema.safeParse(request.query);
    if (!queryParse.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_QUERY',
          message: queryParse.error.issues[0]?.message ?? 'Invalid query parameters.',
        },
      });
    }

    const { ref: queryRef, limit } = queryParse.data;

    let targetRef: string | null = null;
    let targetHash: string | null = null;

    if (queryRef && queryRef.trim().length > 0) {
      const cleanedRef = queryRef.trim();
      // Look up by ref name
      const refMatch = fastify.db
        .prepare('SELECT name, target_hash FROM refs WHERE repo_id = ? AND name = ? LIMIT 1')
        .get(repoId, cleanedRef) as { name: string; target_hash: string } | undefined;

      if (refMatch) {
        targetRef = refMatch.name;
        targetHash = refMatch.target_hash;
      } else if (HASH_REGEX.test(cleanedRef)) {
        // Check if it matches a commit hash directly
        const commitMatch = fastify.db
          .prepare(
            cleanedRef.length === 40
              ? 'SELECT hash FROM commits WHERE repo_id = ? AND hash = ? LIMIT 1'
              : 'SELECT hash FROM commits WHERE repo_id = ? AND hash LIKE ? LIMIT 1',
          )
          .get(repoId, cleanedRef.length === 40 ? cleanedRef : `${cleanedRef}%`) as
          { hash: string } | undefined;

        if (commitMatch) {
          targetRef = cleanedRef.slice(0, 7);
          targetHash = commitMatch.hash;
        }
      }

      if (!targetHash) {
        return reply.status(404).send({
          error: {
            code: 'REF_NOT_FOUND',
            message: `Ref '${cleanedRef}' not found in repository.`,
          },
        });
      }
    } else {
      // Ref omitted: resolve default branch or first available branch or latest commit
      if (repo.default_branch) {
        const defaultRefMatch = fastify.db
          .prepare('SELECT name, target_hash FROM refs WHERE repo_id = ? AND name = ? LIMIT 1')
          .get(repoId, repo.default_branch) as { name: string; target_hash: string } | undefined;

        if (defaultRefMatch) {
          targetRef = defaultRefMatch.name;
          targetHash = defaultRefMatch.target_hash;
        }
      }

      if (!targetHash) {
        // Fall back to first available branch
        const anyBranch = fastify.db
          .prepare(
            "SELECT name, target_hash FROM refs WHERE repo_id = ? AND ref_type = 'branch' ORDER BY is_remote ASC, name ASC LIMIT 1",
          )
          .get(repoId) as { name: string; target_hash: string } | undefined;

        if (anyBranch) {
          targetRef = anyBranch.name;
          targetHash = anyBranch.target_hash;
        }
      }

      if (!targetHash) {
        // Fall back to latest commit if no branch refs exist
        const latestCommit = fastify.db
          .prepare(
            'SELECT hash FROM commits WHERE repo_id = ? ORDER BY author_time DESC, hash DESC LIMIT 1',
          )
          .get(repoId) as { hash: string } | undefined;

        if (latestCommit) {
          targetRef = null;
          targetHash = latestCommit.hash;
        } else {
          // Empty repository
          return {
            data: {
              nodes: [],
              truncated: false,
              ref: null,
            },
          };
        }
      }
    }

    // Ancestry query bounded by limit + 1
    // Use CROSS JOIN with ancestry as the driving table to force SQLite to use the
    // primary key index on commit_parents (repo_id, commit_hash) rather than scanning
    // all commit_parents rows in the repository at each recursive step.
    const ancestrySql = `
        WITH RECURSIVE ancestry(h) AS (
          SELECT ?
          UNION
          SELECT cp.parent_hash
          FROM ancestry a
          CROSS JOIN commit_parents cp ON cp.repo_id = ? AND cp.commit_hash = a.h
        )
        SELECT c.hash, c.author_name, c.author_time, c.subject
        FROM commits c
        WHERE c.repo_id = ? AND c.hash IN (SELECT h FROM ancestry)
        ORDER BY c.author_time DESC, c.hash DESC
        LIMIT ?
      `;

    const rows = fastify.db
      .prepare(ancestrySql)
      .all(targetHash, repoId, repoId, limit + 1) as CommitRow[];

    const truncated = rows.length > limit;
    const selectedRows = truncated ? rows.slice(0, limit) : rows;

    if (selectedRows.length === 0) {
      return {
        data: {
          nodes: [],
          truncated: false,
          ref: targetRef,
        },
      };
    }

    const commitHashes = selectedRows.map((r) => r.hash);
    const placeholders = commitHashes.map(() => '?').join(',');

    // Batch query parent hashes ordered by parent_index
    const parentRows = fastify.db
      .prepare(
        `
          SELECT commit_hash, parent_hash, parent_index
          FROM commit_parents
          WHERE repo_id = ? AND commit_hash IN (${placeholders})
          ORDER BY parent_index ASC
        `,
      )
      .all(repoId, ...commitHashes) as ParentRow[];

    const parentsMap = new Map<string, string[]>();
    for (const p of parentRows) {
      const existing = parentsMap.get(p.commit_hash) ?? [];
      existing.push(p.parent_hash);
      parentsMap.set(p.commit_hash, existing);
    }

    // Batch query associated refs
    const refRows = fastify.db
      .prepare(
        `
          SELECT name, target_hash
          FROM refs
          WHERE repo_id = ? AND target_hash IN (${placeholders})
          ORDER BY name ASC
        `,
      )
      .all(repoId, ...commitHashes) as { name: string; target_hash: string }[];

    const refsMap = new Map<string, string[]>();
    for (const r of refRows) {
      const existing = refsMap.get(r.target_hash) ?? [];
      existing.push(r.name);
      refsMap.set(r.target_hash, existing);
    }

    const nodes: GraphNode[] = selectedRows.map((r) => ({
      hash: r.hash,
      subject: r.subject,
      authorTime: r.author_time,
      authorName: r.author_name,
      parentHashes: parentsMap.get(r.hash) ?? [],
      refs: refsMap.get(r.hash) ?? [],
    }));

    return {
      data: {
        nodes,
        truncated,
        ref: targetRef,
      },
    };
  });
};
