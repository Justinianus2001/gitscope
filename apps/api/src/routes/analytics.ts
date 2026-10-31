import type { FastifyPluginAsync } from 'fastify';
import {
  getActivityQuerySchema,
  getHotspotsQuerySchema,
  getCoChangesQuerySchema,
  type ActivityInterval,
  type ActivityBucket,
  type ContributorSummary,
  type HotspotItem,
  type CoChangePair,
} from '@gitscope/shared';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeRelativePath(inputPath: string): string | null {
  if (!inputPath || typeof inputPath !== 'string') return null;
  const decoded = decodeURIComponent(inputPath).trim();
  if (decoded.includes('..') || /^[a-zA-Z]:[/\\]/.test(decoded) || /^[/\\]/.test(decoded)) {
    return null;
  }
  return decoded.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
}

/**
 * Returns ISO week string "YYYY-Www" for a UTC date
 */
function getIsoWeekString(d: Date): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNr = 1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
  const year = new Date(firstThursday).getUTCFullYear();
  return `${year}-W${String(weekNr).padStart(2, '0')}`;
}

function getBucketKey(d: Date, interval: ActivityInterval): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  if (interval === 'month') {
    return `${y}-${m}`;
  }
  if (interval === 'week') {
    return getIsoWeekString(d);
  }
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface BucketAccumulator {
  bucket: string;
  date: string;
  commitCount: number;
  contributors: Set<string>;
}

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/repositories/:id/activity
  fastify.get<{ Params: { id: string } }>(
    '/api/repositories/:id/activity',
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

      const queryParse = getActivityQuerySchema.safeParse(request.query);
      if (!queryParse.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_QUERY',
            message: queryParse.error.issues[0]?.message ?? 'Invalid query parameters.',
          },
        });
      }

      const { interval } = queryParse.data;
      const now = new Date();
      const toDate = queryParse.data.to ? new Date(queryParse.data.to) : now;

      // Determine default from date based on interval
      let fromDate: Date;
      if (queryParse.data.from) {
        fromDate = new Date(queryParse.data.from);
      } else {
        // Query earliest commit in repository to show meaningful data by default
        const earliestRow = fastify.db
          .prepare('SELECT MIN(author_time) as min_time FROM commits WHERE repo_id = ?')
          .get(repoId) as { min_time: string | null } | undefined;

        if (earliestRow?.min_time) {
          fromDate = new Date(earliestRow.min_time);
          const maxDays = interval === 'day' ? 1826 : 3652;
          const minAllowedTime = toDate.getTime() - maxDays * 24 * 60 * 60 * 1000;
          if (fromDate.getTime() < minAllowedTime) {
            fromDate = new Date(minAllowedTime);
          }
          if (fromDate.getTime() > toDate.getTime()) {
            fromDate = new Date(toDate);
          }
        } else {
          fromDate = new Date(toDate);
          if (interval === 'day') {
            fromDate.setUTCDate(fromDate.getUTCDate() - 365);
          } else if (interval === 'week') {
            fromDate.setUTCDate(fromDate.getUTCDate() - 365);
          } else {
            fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 2);
          }
        }
      }

      if (fromDate.getTime() > toDate.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: "'from' date must be earlier than or equal to 'to' date.",
          },
        });
      }

      const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
      if (interval === 'day' && diffDays > 1826) {
        return reply.status(400).send({
          error: {
            code: 'DATE_RANGE_TOO_LARGE',
            message:
              'Daily activity queries are limited to a maximum range of 5 years (1826 days).',
          },
        });
      }
      if ((interval === 'week' || interval === 'month') && diffDays > 3652) {
        return reply.status(400).send({
          error: {
            code: 'DATE_RANGE_TOO_LARGE',
            message:
              'Weekly and monthly activity queries are limited to a maximum range of 10 years.',
          },
        });
      }

      // Generate contiguous zero-filled buckets in UTC
      const buckets: BucketAccumulator[] = [];
      const bucketMap = new Map<string, BucketAccumulator>();

      if (interval === 'day') {
        const d = new Date(
          Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()),
        );
        while (d.getTime() <= toDate.getTime()) {
          const key = getBucketKey(d, 'day');
          const acc: BucketAccumulator = {
            bucket: key,
            date: d.toISOString(),
            commitCount: 0,
            contributors: new Set<string>(),
          };
          buckets.push(acc);
          bucketMap.set(key, acc);
          d.setUTCDate(d.getUTCDate() + 1);
        }
      } else if (interval === 'week') {
        const dayOfWeek = fromDate.getUTCDay();
        const diffToMonday = (dayOfWeek + 6) % 7;
        const d = new Date(
          Date.UTC(
            fromDate.getUTCFullYear(),
            fromDate.getUTCMonth(),
            fromDate.getUTCDate() - diffToMonday,
          ),
        );
        while (d.getTime() <= toDate.getTime()) {
          const key = getIsoWeekString(d);
          if (!bucketMap.has(key)) {
            const acc: BucketAccumulator = {
              bucket: key,
              date: d.toISOString(),
              commitCount: 0,
              contributors: new Set<string>(),
            };
            buckets.push(acc);
            bucketMap.set(key, acc);
          }
          d.setUTCDate(d.getUTCDate() + 7);
        }
      } else {
        // month
        const d = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1));
        while (d.getTime() <= toDate.getTime()) {
          const key = getBucketKey(d, 'month');
          if (!bucketMap.has(key)) {
            const acc: BucketAccumulator = {
              bucket: key,
              date: d.toISOString(),
              commitCount: 0,
              contributors: new Set<string>(),
            };
            buckets.push(acc);
            bucketMap.set(key, acc);
          }
          d.setUTCMonth(d.getUTCMonth() + 1);
        }
      }

      // Fetch commits in range
      const commitRows = fastify.db
        .prepare(
          `
          SELECT hash, author_name, author_email, author_time
          FROM commits
          WHERE repo_id = ?
            AND author_time >= ?
            AND author_time <= ?
          ORDER BY author_time ASC
        `,
        )
        .all(repoId, fromDate.toISOString(), toDate.toISOString()) as {
        hash: string;
        author_name: string;
        author_email: string;
        author_time: string;
      }[];

      const contributorsMap = new Map<
        string,
        {
          name: string;
          email: string;
          commitCount: number;
          firstCommitAt: string;
          lastCommitAt: string;
        }
      >();

      let totalCommits = 0;

      for (const row of commitRows) {
        totalCommits++;
        const commitDate = new Date(row.author_time);
        const key = getBucketKey(commitDate, interval);
        const normalizedEmail =
          (row.author_email || '').trim().toLowerCase() ||
          (row.author_name || '').trim().toLowerCase();

        const bucketAcc = bucketMap.get(key);
        if (bucketAcc) {
          bucketAcc.commitCount++;
          bucketAcc.contributors.add(normalizedEmail);
        }

        const existingContrib = contributorsMap.get(normalizedEmail);
        if (existingContrib) {
          existingContrib.commitCount++;
          if (row.author_time < existingContrib.firstCommitAt) {
            existingContrib.firstCommitAt = row.author_time;
          }
          if (row.author_time > existingContrib.lastCommitAt) {
            existingContrib.lastCommitAt = row.author_time;
            existingContrib.name = row.author_name; // update to most recent name
          }
        } else {
          contributorsMap.set(normalizedEmail, {
            name: row.author_name,
            email: row.author_email,
            commitCount: 1,
            firstCommitAt: row.author_time,
            lastCommitAt: row.author_time,
          });
        }
      }

      const resultBuckets: ActivityBucket[] = buckets.map((b) => ({
        bucket: b.bucket,
        date: b.date,
        commitCount: b.commitCount,
        distinctContributors: b.contributors.size,
      }));

      const contributorsList: ContributorSummary[] = Array.from(contributorsMap.values()).sort(
        (a, b) => b.commitCount - a.commitCount || a.name.localeCompare(b.name),
      );

      return {
        data: {
          buckets: resultBuckets,
          interval,
          totalCommits,
          totalContributors: contributorsList.length,
          contributors: contributorsList,
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
        },
      };
    },
  );

  // GET /api/repositories/:id/hotspots
  fastify.get<{ Params: { id: string } }>(
    '/api/repositories/:id/hotspots',
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

      const queryParse = getHotspotsQuerySchema.safeParse(request.query);
      if (!queryParse.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_QUERY',
            message: queryParse.error.issues[0]?.message ?? 'Invalid query parameters.',
          },
        });
      }

      const { from, to, path: rawPath, limit } = queryParse.data;

      if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: "'from' date must be earlier than or equal to 'to' date.",
          },
        });
      }

      let sanitizedPath: string | null = null;
      if (rawPath) {
        sanitizedPath = sanitizeRelativePath(rawPath);
        if (!sanitizedPath) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PATH',
              message: 'Invalid path filter parameter.',
            },
          });
        }
      }

      const conditions: string[] = ['fc.repo_id = ?'];
      const params: unknown[] = [repoId];

      if (from) {
        conditions.push('c.author_time >= ?');
        params.push(from);
      }
      if (to) {
        conditions.push('c.author_time <= ?');
        params.push(to);
      }
      if (sanitizedPath) {
        conditions.push('(fc.path = ? OR fc.path LIKE ?)');
        params.push(sanitizedPath, `${sanitizedPath}%`);
      }

      params.push(limit);

      const sql = `
        SELECT
          fc.path,
          COUNT(DISTINCT fc.commit_hash) AS distinct_commits,
          SUM(CASE WHEN fc.is_binary = 1 THEN NULL ELSE fc.additions END) AS total_additions,
          SUM(CASE WHEN fc.is_binary = 1 THEN NULL ELSE fc.deletions END) AS total_deletions,
          MAX(c.author_time) AS last_changed_at
        FROM file_changes fc
        JOIN commits c ON fc.repo_id = c.repo_id AND fc.commit_hash = c.hash
        WHERE ${conditions.join(' AND ')}
        GROUP BY fc.path
        ORDER BY
          distinct_commits DESC,
          (COALESCE(SUM(CASE WHEN fc.is_binary = 1 THEN NULL ELSE fc.additions END), 0) +
           COALESCE(SUM(CASE WHEN fc.is_binary = 1 THEN NULL ELSE fc.deletions END), 0)) DESC,
          fc.path ASC
        LIMIT ?
      `;

      const rows = fastify.db.prepare(sql).all(...params) as {
        path: string;
        distinct_commits: number;
        total_additions: number | null;
        total_deletions: number | null;
        last_changed_at: string | null;
      }[];

      const hotspots: HotspotItem[] = rows.map((r) => ({
        path: r.path,
        distinctCommits: Number(r.distinct_commits),
        totalAdditions: r.total_additions !== null ? Number(r.total_additions) : null,
        totalDeletions: r.total_deletions !== null ? Number(r.total_deletions) : null,
        lastChangedAt: r.last_changed_at,
      }));

      return { data: hotspots };
    },
  );

  // GET /api/repositories/:id/co-changes
  fastify.get<{ Params: { id: string } }>(
    '/api/repositories/:id/co-changes',
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

      const queryParse = getCoChangesQuerySchema.safeParse(request.query);
      if (!queryParse.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_QUERY',
            message: queryParse.error.issues[0]?.message ?? 'Invalid query parameters.',
          },
        });
      }

      const { from, to, path: rawPath, minCount, limit } = queryParse.data;

      if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: "'from' date must be earlier than or equal to 'to' date.",
          },
        });
      }

      let sanitizedPath: string | null = null;
      if (rawPath) {
        sanitizedPath = sanitizeRelativePath(rawPath);
        if (!sanitizedPath) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PATH',
              message: 'Invalid path filter parameter.',
            },
          });
        }
      }

      const safetyThreshold = fastify.config.COCHANGE_MAX_FILES_PER_COMMIT ?? 200;

      // 1. Count excluded large commits
      const countConditions: string[] = ['fc.repo_id = ?'];
      const countParams: unknown[] = [repoId];
      if (from) {
        countConditions.push('c.author_time >= ?');
        countParams.push(from);
      }
      if (to) {
        countConditions.push('c.author_time <= ?');
        countParams.push(to);
      }
      countParams.push(safetyThreshold);

      const excludedSql = `
        SELECT COUNT(*) AS excluded_count
        FROM (
          SELECT fc.commit_hash
          FROM file_changes fc
          JOIN commits c ON fc.repo_id = c.repo_id AND fc.commit_hash = c.hash
          WHERE ${countConditions.join(' AND ')}
          GROUP BY fc.commit_hash
          HAVING COUNT(DISTINCT fc.path) > ?
        )
      `;

      const excludedRow = fastify.db.prepare(excludedSql).get(...countParams) as
        { excluded_count: number } | undefined;
      const excludedLargeCommitsCount = excludedRow?.excluded_count ?? 0;

      // 2. Query co-change pairs
      const cteConditions: string[] = ['fc.repo_id = ?'];
      const cteParams: unknown[] = [repoId];
      if (from) {
        cteConditions.push('c.author_time >= ?');
        cteParams.push(from);
      }
      if (to) {
        cteConditions.push('c.author_time <= ?');
        cteParams.push(to);
      }

      const mainConditions: string[] = [];
      const mainParams: unknown[] = [];
      if (sanitizedPath) {
        mainConditions.push('(ec1.path = ? OR ec1.path LIKE ? OR ec2.path = ? OR ec2.path LIKE ?)');
        mainParams.push(sanitizedPath, `${sanitizedPath}%`, sanitizedPath, `${sanitizedPath}%`);
      }

      const allParams = [
        ...cteParams,
        ...cteParams,
        safetyThreshold,
        ...mainParams,
        minCount,
        limit,
      ];

      const coChangeSql = `
        WITH commit_file_counts AS (
          SELECT
            fc.commit_hash,
            COUNT(DISTINCT fc.path) AS file_count
          FROM file_changes fc
          JOIN commits c ON fc.repo_id = c.repo_id AND fc.commit_hash = c.hash
          WHERE ${cteConditions.join(' AND ')}
          GROUP BY fc.commit_hash
        ),
        eligible_changes AS (
          SELECT DISTINCT
            fc.commit_hash,
            fc.path,
            c.author_time
          FROM file_changes fc
          JOIN commits c ON fc.repo_id = c.repo_id AND fc.commit_hash = c.hash
          JOIN commit_file_counts cfc ON fc.commit_hash = cfc.commit_hash
          WHERE ${cteConditions.join(' AND ')}
            AND cfc.file_count <= ?
        )
        SELECT
          ec1.path AS path_a,
          ec2.path AS path_b,
          COUNT(DISTINCT ec1.commit_hash) AS co_change_count,
          MAX(ec1.author_time) AS last_co_change_at
        FROM eligible_changes ec1
        JOIN eligible_changes ec2
          ON ec1.commit_hash = ec2.commit_hash
          AND ec1.path < ec2.path
        ${mainConditions.length > 0 ? `WHERE ${mainConditions.join(' AND ')}` : ''}
        GROUP BY ec1.path, ec2.path
        HAVING co_change_count >= ?
        ORDER BY
          co_change_count DESC,
          path_a ASC,
          path_b ASC
        LIMIT ?
      `;

      const rows = fastify.db.prepare(coChangeSql).all(...allParams) as {
        path_a: string;
        path_b: string;
        co_change_count: number;
        last_co_change_at: string;
      }[];

      const pairs: CoChangePair[] = rows.map((r) => ({
        pathA: r.path_a,
        pathB: r.path_b,
        coChangeCount: Number(r.co_change_count),
        lastCoChangeAt: r.last_co_change_at,
      }));

      return {
        data: {
          pairs,
          excludedLargeCommitsCount,
          safetyThreshold,
        },
      };
    },
  );
};
