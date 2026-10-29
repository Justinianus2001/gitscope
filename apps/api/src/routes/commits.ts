import type { FastifyPluginAsync } from 'fastify';
import {
  getCommitsQuerySchema,
  type CommitItem,
  type CommitDetail,
  type FileHistoryItem,
  type ChangeType,
} from '@gitscope/shared';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_REGEX = /^[0-9a-f]{7,40}$/i;

function encodeCursor(authorTime: string, hash: string): string {
  return Buffer.from(JSON.stringify({ t: authorTime, h: hash })).toString('base64url');
}

function decodeCursor(raw: string): { authorTime: string; hash: string } | null {
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
    if (typeof json.t === 'string' && typeof json.h === 'string' && json.h.length >= 7) {
      return { authorTime: json.t, hash: json.h };
    }
    return null;
  } catch {
    return null;
  }
}

function sanitizeRelativePath(inputPath: string): string | null {
  if (!inputPath || typeof inputPath !== 'string') return null;
  const decoded = decodeURIComponent(inputPath).trim();
  // Reject directory traversal attempts
  if (decoded.includes('..') || pathStartsWithDriveOrRoot(decoded)) {
    return null;
  }
  return decoded.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
}

function pathStartsWithDriveOrRoot(p: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(p) || /^[/\\]/.test(p);
}

interface CommitRow {
  hash: string;
  author_name: string;
  author_email: string;
  author_time: string;
  committer_time: string;
  subject: string;
  body: string | null;
}

export const commitRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/repositories/:id/commits
  fastify.get<{ Params: { id: string } }>(
    '/api/repositories/:id/commits',
    async (request, reply) => {
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

      const queryParse = getCommitsQuerySchema.safeParse(request.query);
      if (!queryParse.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_QUERY',
            message: queryParse.error.issues[0]?.message ?? 'Invalid query parameters.',
          },
        });
      }

      const { limit, cursor, branch, author, from, to, path: filePathFilter } = queryParse.data;

      let cursorObj: { authorTime: string; hash: string } | null = null;
      if (cursor) {
        cursorObj = decodeCursor(cursor);
        if (!cursorObj) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_CURSOR',
              message: 'Malformed cursor parameter.',
            },
          });
        }
      }

      const conditions: string[] = ['c.repo_id = ?'];
      const params: unknown[] = [repoId];

      let ctePrefix = '';

      // Branch filter via recursive CTE for commit reachability
      if (branch) {
        ctePrefix = `
        WITH RECURSIVE branch_commits(h) AS (
          SELECT target_hash FROM refs WHERE repo_id = ? AND name = ? AND ref_type = 'branch'
          UNION
          SELECT cp.parent_hash FROM commit_parents cp JOIN branch_commits bc ON cp.commit_hash = bc.h WHERE cp.repo_id = ?
        )
      `;
        params.unshift(repoId, branch, repoId);
        conditions.push('c.hash IN (SELECT h FROM branch_commits)');
      }

      if (author) {
        conditions.push('(c.author_name LIKE ? OR c.author_email LIKE ?)');
        params.push(`%${author}%`, `%${author}%`);
      }

      if (from) {
        conditions.push('c.author_time >= ?');
        params.push(from);
      }

      if (to) {
        conditions.push('c.author_time <= ?');
        params.push(to);
      }

      if (filePathFilter) {
        const sanitized = sanitizeRelativePath(filePathFilter);
        if (!sanitized) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PATH',
              message: 'Invalid path filter parameter.',
            },
          });
        }
        conditions.push(`c.hash IN (
        SELECT fc.commit_hash FROM file_changes fc
        WHERE fc.repo_id = ? AND (fc.path = ? OR fc.old_path = ?)
      )`);
        params.push(repoId, sanitized, sanitized);
      }

      if (cursorObj) {
        conditions.push('((c.author_time < ?) OR (c.author_time = ? AND c.hash < ?))');
        params.push(cursorObj.authorTime, cursorObj.authorTime, cursorObj.hash);
      }

      const sql = `
      ${ctePrefix}
      SELECT c.hash, c.author_name, c.author_email, c.author_time, c.committer_time, c.subject, c.body
      FROM commits c
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.author_time DESC, c.hash DESC
      LIMIT ?
    `;
      params.push(limit + 1);

      const rows = fastify.db.prepare(sql).all(...params) as CommitRow[];

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor =
        hasMore && pageRows.length > 0
          ? encodeCursor(
              pageRows[pageRows.length - 1]!.author_time,
              pageRows[pageRows.length - 1]!.hash,
            )
          : null;

      if (pageRows.length === 0) {
        return {
          data: [],
          page: { nextCursor: null },
        };
      }

      // Batch fetch parent hashes
      const hashes = pageRows.map((r) => r.hash);
      const placeholders = hashes.map(() => '?').join(',');

      const parentsSql = `
      SELECT commit_hash, parent_hash, parent_index
      FROM commit_parents
      WHERE repo_id = ? AND commit_hash IN (${placeholders})
      ORDER BY parent_index ASC
    `;
      const parentRows = fastify.db.prepare(parentsSql).all(repoId, ...hashes) as {
        commit_hash: string;
        parent_hash: string;
        parent_index: number;
      }[];

      const parentsByCommit = new Map<string, string[]>();
      for (const p of parentRows) {
        const arr = parentsByCommit.get(p.commit_hash) ?? [];
        arr.push(p.parent_hash);
        parentsByCommit.set(p.commit_hash, arr);
      }

      // Batch fetch refs
      const refsSql = `
      SELECT target_hash, name
      FROM refs
      WHERE repo_id = ? AND target_hash IN (${placeholders})
    `;
      const refRows = fastify.db.prepare(refsSql).all(repoId, ...hashes) as {
        target_hash: string;
        name: string;
      }[];

      const refsByCommit = new Map<string, string[]>();
      for (const r of refRows) {
        const arr = refsByCommit.get(r.target_hash) ?? [];
        arr.push(r.name);
        refsByCommit.set(r.target_hash, arr);
      }

      const data: CommitItem[] = pageRows.map((r) => {
        const parentHashes = parentsByCommit.get(r.hash) ?? [];
        return {
          hash: r.hash,
          abbreviatedHash: r.hash.slice(0, 7),
          authorName: r.author_name,
          authorEmail: r.author_email,
          authorTime: r.author_time,
          committerTime: r.committer_time,
          subject: r.subject,
          body: r.body,
          parentHashes,
          parentCount: parentHashes.length,
          refs: refsByCommit.get(r.hash) ?? [],
        };
      });

      return {
        data,
        page: { nextCursor },
      };
    },
  );

  // GET /api/repositories/:id/commits/:hash
  fastify.get<{ Params: { id: string; hash: string } }>(
    '/api/repositories/:id/commits/:hash',
    async (request, reply) => {
      const { id: repoId, hash: inputHash } = request.params;
      if (!UUID_REGEX.test(repoId)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ID',
            message: 'Repository ID must be a valid UUID.',
          },
        });
      }

      if (!HASH_REGEX.test(inputHash)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_HASH',
            message: 'Commit hash must be 7 to 40 hexadecimal characters.',
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

      const commitSql =
        inputHash.length === 40
          ? 'SELECT * FROM commits WHERE repo_id = ? AND hash = ?'
          : 'SELECT * FROM commits WHERE repo_id = ? AND hash LIKE ? ORDER BY author_time DESC LIMIT 1';
      const commitParam = inputHash.length === 40 ? inputHash : `${inputHash}%`;

      const commit = fastify.db.prepare(commitSql).get(repoId, commitParam) as
        CommitRow | undefined;

      if (!commit) {
        return reply.status(404).send({
          error: {
            code: 'COMMIT_NOT_FOUND',
            message: 'Commit not found in repository.',
          },
        });
      }

      // Fetch parents in order
      const parentRows = fastify.db
        .prepare(
          'SELECT parent_hash FROM commit_parents WHERE repo_id = ? AND commit_hash = ? ORDER BY parent_index ASC',
        )
        .all(repoId, commit.hash) as { parent_hash: string }[];
      const parentHashes = parentRows.map((p) => p.parent_hash);

      // Fetch refs
      const refRows = fastify.db
        .prepare('SELECT name FROM refs WHERE repo_id = ? AND target_hash = ?')
        .all(repoId, commit.hash) as { name: string }[];
      const refs = refRows.map((r) => r.name);

      // Fetch changed files
      const fileRows = fastify.db
        .prepare(
          `
          SELECT path, old_path, change_type, additions, deletions, is_binary
          FROM file_changes
          WHERE repo_id = ? AND commit_hash = ?
          ORDER BY path ASC
        `,
        )
        .all(repoId, commit.hash) as {
        path: string;
        old_path: string | null;
        change_type: ChangeType;
        additions: number | null;
        deletions: number | null;
        is_binary: number | null;
      }[];

      const data: CommitDetail = {
        hash: commit.hash,
        abbreviatedHash: commit.hash.slice(0, 7),
        authorName: commit.author_name,
        authorEmail: commit.author_email,
        authorTime: commit.author_time,
        committerTime: commit.committer_time,
        subject: commit.subject,
        body: commit.body,
        parentHashes,
        parentCount: parentHashes.length,
        refs,
        fileChanges: fileRows.map((f) => ({
          path: f.path,
          oldPath: f.old_path,
          changeType: f.change_type,
          additions: f.additions,
          deletions: f.deletions,
          isBinary: f.is_binary === null ? null : f.is_binary === 1,
        })),
      };

      return { data };
    },
  );

  // File history route supporting wildcard path: /api/repositories/:id/files/*/history and /files/:path/history
  fastify.get<{ Params: { id: string; '*': string } }>(
    '/api/repositories/:id/files/*',
    async (request, reply) => {
      const { id: repoId, '*': wildcard } = request.params;
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

      // Check if wildcard ends with /history or extract path from query
      let filePath = wildcard;
      if (wildcard.endsWith('/history')) {
        filePath = wildcard.slice(0, -'/history'.length);
      }

      const sanitizedPath = sanitizeRelativePath(filePath);
      if (!sanitizedPath) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PATH',
            message: 'Invalid or disallowed file path.',
          },
        });
      }

      const queryParse = getCommitsQuerySchema.safeParse(request.query);
      const limit = queryParse.success ? queryParse.data.limit : 50;
      const cursor = queryParse.success ? queryParse.data.cursor : undefined;

      let cursorObj: { authorTime: string; hash: string } | null = null;
      if (cursor) {
        cursorObj = decodeCursor(cursor);
        if (!cursorObj) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_CURSOR',
              message: 'Malformed cursor parameter.',
            },
          });
        }
      }

      const conditions = ['fc.repo_id = ?', '(fc.path = ? OR fc.old_path = ?)'];
      const params: unknown[] = [repoId, sanitizedPath, sanitizedPath];

      if (cursorObj) {
        conditions.push('((c.author_time < ?) OR (c.author_time = ? AND c.hash < ?))');
        params.push(cursorObj.authorTime, cursorObj.authorTime, cursorObj.hash);
      }

      const sql = `
        SELECT
          c.hash, c.author_name, c.author_email, c.author_time, c.committer_time, c.subject, c.body,
          fc.path as file_path, fc.old_path, fc.change_type, fc.additions, fc.deletions, fc.is_binary
        FROM file_changes fc
        JOIN commits c ON c.repo_id = fc.repo_id AND c.hash = fc.commit_hash
        WHERE ${conditions.join(' AND ')}
        ORDER BY c.author_time DESC, c.hash DESC
        LIMIT ?
      `;
      params.push(limit + 1);

      const rows = fastify.db.prepare(sql).all(...params) as (CommitRow & {
        file_path: string;
        old_path: string | null;
        change_type: ChangeType;
        additions: number | null;
        deletions: number | null;
        is_binary: number | null;
      })[];

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor =
        hasMore && pageRows.length > 0
          ? encodeCursor(
              pageRows[pageRows.length - 1]!.author_time,
              pageRows[pageRows.length - 1]!.hash,
            )
          : null;

      const data: FileHistoryItem[] = pageRows.map((r) => ({
        hash: r.hash,
        abbreviatedHash: r.hash.slice(0, 7),
        authorName: r.author_name,
        authorEmail: r.author_email,
        authorTime: r.author_time,
        committerTime: r.committer_time,
        subject: r.subject,
        body: r.body,
        parentHashes: [],
        parentCount: 0,
        filePath: r.file_path,
        oldPath: r.old_path,
        changeType: r.change_type,
        additions: r.additions,
        deletions: r.deletions,
        isBinary: r.is_binary === null ? null : r.is_binary === 1,
      }));

      return {
        data,
        page: { nextCursor },
      };
    },
  );
};
