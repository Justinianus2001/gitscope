import { z } from 'zod';
import { analysisStatusSchema, changeTypeSchema, repositoryPublicSchema } from './models.js';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const repositoryListItemSchema = repositoryPublicSchema.extend({
  analysisStatus: analysisStatusSchema.nullable().optional(),
  commitsProcessed: z.number().int().nonnegative().optional(),
});
export type RepositoryListItem = z.infer<typeof repositoryListItemSchema>;

export const createRepositoryRequestSchema = z.object({
  path: z.string().min(1),
});
export type CreateRepositoryRequest = z.infer<typeof createRepositoryRequestSchema>;

export const createRepositoryResponseSchema = z.object({
  data: repositoryListItemSchema,
  isExisting: z.boolean().optional(),
});
export type CreateRepositoryResponse = z.infer<typeof createRepositoryResponseSchema>;

export const getRepositoryResponseSchema = z.object({
  data: repositoryListItemSchema,
});
export type GetRepositoryResponse = z.infer<typeof getRepositoryResponseSchema>;

export const listRepositoriesResponseSchema = z.object({
  data: z.array(repositoryListItemSchema),
});
export type ListRepositoriesResponse = z.infer<typeof listRepositoriesResponseSchema>;

export const startAnalysisResponseSchema = z.object({
  data: z.object({
    runId: z.string().uuid(),
    status: analysisStatusSchema,
  }),
});
export type StartAnalysisResponse = z.infer<typeof startAnalysisResponseSchema>;

export const getAnalysisResponseSchema = z.object({
  data: z
    .object({
      runId: z.string().uuid(),
      status: analysisStatusSchema,
      commitsProcessed: z.number().int().nonnegative(),
      startedAt: z.string().datetime().nullable().optional(),
      finishedAt: z.string().datetime().nullable().optional(),
      errorCode: z.string().nullable().optional(),
      errorMessage: z.string().nullable().optional(),
    })
    .nullable(),
});
export type GetAnalysisResponse = z.infer<typeof getAnalysisResponseSchema>;

export const getCommitsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
  branch: z.string().optional(),
  author: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  path: z.string().optional(),
});
export type GetCommitsQuery = z.infer<typeof getCommitsQuerySchema>;

export const commitItemSchema = z.object({
  hash: z.string(),
  abbreviatedHash: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  authorTime: z.string(),
  committerTime: z.string(),
  subject: z.string(),
  body: z.string().nullable(),
  parentHashes: z.array(z.string()),
  parentCount: z.number().int().nonnegative(),
  refs: z.array(z.string()).optional(),
});
export type CommitItem = z.infer<typeof commitItemSchema>;

export const commitDetailFileChangeSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  changeType: changeTypeSchema,
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  isBinary: z.boolean().nullable(),
});
export type CommitDetailFileChange = z.infer<typeof commitDetailFileChangeSchema>;

export const commitDetailSchema = commitItemSchema.extend({
  fileChanges: z.array(commitDetailFileChangeSchema),
});
export type CommitDetail = z.infer<typeof commitDetailSchema>;

export const getCommitDetailResponseSchema = z.object({
  data: commitDetailSchema,
});
export type GetCommitDetailResponse = z.infer<typeof getCommitDetailResponseSchema>;

export const getCommitsResponseSchema = z.object({
  data: z.array(commitItemSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
  }),
});
export type GetCommitsResponse = z.infer<typeof getCommitsResponseSchema>;

export const fileHistoryItemSchema = commitItemSchema.extend({
  filePath: z.string(),
  oldPath: z.string().nullable(),
  changeType: changeTypeSchema,
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  isBinary: z.boolean().nullable(),
});
export type FileHistoryItem = z.infer<typeof fileHistoryItemSchema>;

export const getFileHistoryResponseSchema = z.object({
  data: z.array(fileHistoryItemSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
  }),
});
export type GetFileHistoryResponse = z.infer<typeof getFileHistoryResponseSchema>;

export const getGraphQuerySchema = z.object({
  ref: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(300),
});
export type GetGraphQuery = z.infer<typeof getGraphQuerySchema>;

export const graphNodeSchema = z.object({
  hash: z.string(),
  subject: z.string(),
  authorTime: z.string(),
  authorName: z.string().optional(),
  parentHashes: z.array(z.string()),
  refs: z.array(z.string()),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const getGraphResponseSchema = z.object({
  data: z.object({
    nodes: z.array(graphNodeSchema),
    truncated: z.boolean(),
    ref: z.string().nullable(),
  }),
});
export type GetGraphResponse = z.infer<typeof getGraphResponseSchema>;

export const refItemSchema = z.object({
  name: z.string(),
  refType: z.enum(['branch', 'tag']),
  targetHash: z.string(),
  isRemote: z.boolean(),
});
export type RefItem = z.infer<typeof refItemSchema>;

export const getRefsResponseSchema = z.object({
  data: z.array(refItemSchema),
});
export type GetRefsResponse = z.infer<typeof getRefsResponseSchema>;

// Analytics Schemas

export const activityIntervalSchema = z.enum(['day', 'week', 'month']).default('day');
export type ActivityInterval = z.infer<typeof activityIntervalSchema>;

export const getActivityQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  interval: activityIntervalSchema,
});
export type GetActivityQuery = z.infer<typeof getActivityQuerySchema>;

export const activityBucketSchema = z.object({
  bucket: z.string(),
  date: z.string(),
  commitCount: z.number().int().nonnegative(),
  distinctContributors: z.number().int().nonnegative(),
});
export type ActivityBucket = z.infer<typeof activityBucketSchema>;

export const contributorSummarySchema = z.object({
  name: z.string(),
  email: z.string(),
  commitCount: z.number().int().nonnegative(),
  firstCommitAt: z.string(),
  lastCommitAt: z.string(),
});
export type ContributorSummary = z.infer<typeof contributorSummarySchema>;

export const getActivityResponseSchema = z.object({
  data: z.object({
    buckets: z.array(activityBucketSchema),
    interval: activityIntervalSchema,
    totalCommits: z.number().int().nonnegative(),
    totalContributors: z.number().int().nonnegative(),
    contributors: z.array(contributorSummarySchema),
    from: z.string(),
    to: z.string(),
  }),
});
export type GetActivityResponse = z.infer<typeof getActivityResponseSchema>;

export const getHotspotsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  path: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
});
export type GetHotspotsQuery = z.infer<typeof getHotspotsQuerySchema>;

export const hotspotItemSchema = z.object({
  path: z.string(),
  distinctCommits: z.number().int().nonnegative(),
  totalAdditions: z.number().int().nonnegative().nullable(),
  totalDeletions: z.number().int().nonnegative().nullable(),
  lastChangedAt: z.string().nullable(),
});
export type HotspotItem = z.infer<typeof hotspotItemSchema>;

export const getHotspotsResponseSchema = z.object({
  data: z.array(hotspotItemSchema),
});
export type GetHotspotsResponse = z.infer<typeof getHotspotsResponseSchema>;

export const getCoChangesQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  path: z.string().optional(),
  minCount: z.coerce.number().int().positive().default(2),
  limit: z.coerce.number().int().positive().max(500).default(50),
});
export type GetCoChangesQuery = z.infer<typeof getCoChangesQuerySchema>;

export const coChangePairSchema = z.object({
  pathA: z.string(),
  pathB: z.string(),
  coChangeCount: z.number().int().positive(),
  lastCoChangeAt: z.string().optional(),
});
export type CoChangePair = z.infer<typeof coChangePairSchema>;

export const getCoChangesResponseSchema = z.object({
  data: z.object({
    pairs: z.array(coChangePairSchema),
    excludedLargeCommitsCount: z.number().int().nonnegative(),
    safetyThreshold: z.number().int().positive(),
  }),
});
export type GetCoChangesResponse = z.infer<typeof getCoChangesResponseSchema>;
