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
