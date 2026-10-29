import { envConfigSchema, type EnvConfig } from '@gitscope/shared';

export function loadConfig(overrides?: Partial<Record<string, unknown>>): EnvConfig {
  const env = {
    ...process.env,
    ...overrides,
  };

  const parsed = envConfigSchema.safeParse(env);
  if (!parsed.success) {
    const errorIssues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errorIssues}`);
  }

  return parsed.data;
}
