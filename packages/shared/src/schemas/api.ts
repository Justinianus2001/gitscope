import { z } from 'zod';
import { analysisStatusSchema, repositoryPublicSchema } from './models.js';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const createRepositoryRequestSchema = z.object({
  path: z.string().min(1),
});
export type CreateRepositoryRequest = z.infer<typeof createRepositoryRequestSchema>;

export const createRepositoryResponseSchema = z.object({
  data: repositoryPublicSchema,
  isExisting: z.boolean().optional(),
});
export type CreateRepositoryResponse = z.infer<typeof createRepositoryResponseSchema>;

export const listRepositoriesResponseSchema = z.object({
  data: z.array(repositoryPublicSchema),
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
  data: z.object({
    runId: z.string().uuid(),
    status: analysisStatusSchema,
    commitsProcessed: z.number().int().nonnegative(),
    startedAt: z.string().datetime().nullable().optional(),
    finishedAt: z.string().datetime().nullable().optional(),
    errorCode: z.string().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
  }),
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

export const getCommitsResponseSchema = z.object({
  data: z.array(commitItemSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
  }),
});
export type GetCommitsResponse = z.infer<typeof getCommitsResponseSchema>;

export const graphNodeSchema = z.object({
  hash: z.string(),
  subject: z.string(),
  authorTime: z.string(),
  parentHashes: z.array(z.string()),
  refs: z.array(z.string()),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const getGraphResponseSchema = z.object({
  data: z.object({
    nodes: z.array(graphNodeSchema),
  }),
});
export type GetGraphResponse = z.infer<typeof getGraphResponseSchema>;
