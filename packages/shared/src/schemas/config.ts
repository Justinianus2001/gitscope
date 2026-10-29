import { z } from 'zod';

export const envConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default('./data/gitscope.sqlite'),
  ALLOWED_REPOSITORY_ROOTS: z
    .string()
    .default('./sample-repositories')
    .transform((val) =>
      val
        .split(';')
        .flatMap((s) => s.split(','))
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  GIT_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  MAX_GIT_OUTPUT_BYTES: z.coerce.number().int().positive().default(50000000),
  COCHANGE_MAX_FILES_PER_COMMIT: z.coerce.number().int().positive().default(200),
});

export type EnvConfig = z.infer<typeof envConfigSchema>;
