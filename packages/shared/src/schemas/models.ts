import { z } from 'zod';

export const changeTypeSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'type_changed',
  'unknown',
]);
export type ChangeType = z.infer<typeof changeTypeSchema>;

export const refTypeSchema = z.enum(['branch', 'tag']);
export type RefType = z.infer<typeof refTypeSchema>;

export const analysisStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

export const repositorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  canonicalPath: z.string().min(1),
  defaultBranch: z.string().nullable(),
  lastAnalyzedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Repository = z.infer<typeof repositorySchema>;

export const repositoryPublicSchema = repositorySchema.omit({ canonicalPath: true });
export type RepositoryPublic = z.infer<typeof repositoryPublicSchema>;

export const commitSchema = z.object({
  repoId: z.string().uuid(),
  hash: z.string().length(40),
  authorName: z.string(),
  authorEmail: z.string(),
  authorTime: z.string().datetime(),
  committerTime: z.string().datetime(),
  subject: z.string(),
  body: z.string().nullable(),
});
export type Commit = z.infer<typeof commitSchema>;

export const commitParentSchema = z.object({
  repoId: z.string().uuid(),
  commitHash: z.string().length(40),
  parentHash: z.string().length(40),
  parentIndex: z.number().int().nonnegative(),
});
export type CommitParent = z.infer<typeof commitParentSchema>;

export const refSchema = z.object({
  repoId: z.string().uuid(),
  name: z.string().min(1),
  refType: refTypeSchema,
  targetHash: z.string().length(40),
  isRemote: z.boolean(),
});
export type Ref = z.infer<typeof refSchema>;

export const fileChangeSchema = z.object({
  id: z.number().int().positive().optional(),
  repoId: z.string().uuid(),
  commitHash: z.string().length(40),
  path: z.string().min(1),
  oldPath: z.string().nullable().optional(),
  changeType: changeTypeSchema,
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  isBinary: z.boolean().nullable(),
});
export type FileChange = z.infer<typeof fileChangeSchema>;

export const analysisRunSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  status: analysisStatusSchema,
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  commitsProcessed: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
});
export type AnalysisRun = z.infer<typeof analysisRunSchema>;
