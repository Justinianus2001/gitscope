import { describe, it, expect } from 'vitest';
import {
  envConfigSchema,
  repositorySchema,
  changeTypeSchema,
  getGraphQuerySchema,
  getGraphResponseSchema,
} from '../index.js';

describe('Shared Schemas', () => {
  it('validates and applies defaults for environment configuration', () => {
    const config = envConfigSchema.parse({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.API_PORT).toBe(4000);
    expect(config.ALLOWED_REPOSITORY_ROOTS).toEqual(['./sample-repositories']);
  });

  it('splits multiple allowed repository roots correctly', () => {
    const config = envConfigSchema.parse({
      ALLOWED_REPOSITORY_ROOTS: '/repos/alpha; /repos/beta, /repos/gamma',
    });
    expect(config.ALLOWED_REPOSITORY_ROOTS).toEqual([
      '/repos/alpha',
      '/repos/beta',
      '/repos/gamma',
    ]);
  });

  it('validates change types strictly', () => {
    expect(changeTypeSchema.safeParse('modified').success).toBe(true);
    expect(changeTypeSchema.safeParse('renamed').success).toBe(true);
    expect(changeTypeSchema.safeParse('invalid_type').success).toBe(false);
  });

  it('validates repository UUID and datetime', () => {
    const validRepo = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'gitscope',
      canonicalPath: '/path/to/repo',
      defaultBranch: 'main',
      lastAnalyzedAt: null,
      createdAt: '2026-10-29T00:00:00.000Z',
      updatedAt: '2026-10-29T00:00:00.000Z',
    };
    expect(repositorySchema.safeParse(validRepo).success).toBe(true);
  });

  it('validates graph query defaults and response schemas', () => {
    const parsedQuery = getGraphQuerySchema.parse({});
    expect(parsedQuery.limit).toBe(300);
    expect(parsedQuery.ref).toBeUndefined();

    const customQuery = getGraphQuerySchema.parse({ ref: 'feature/login', limit: '150' });
    expect(customQuery.limit).toBe(150);
    expect(customQuery.ref).toBe('feature/login');

    const validGraphResponse = {
      data: {
        nodes: [
          {
            hash: '0123456789abcdef0123456789abcdef01234567',
            subject: 'feat: add graph',
            authorTime: '2026-10-29T10:00:00.000Z',
            parentHashes: ['abcdef0123456789abcdef0123456789abcdef01'],
            refs: ['main', 'v1.0.0'],
          },
        ],
        truncated: false,
        ref: 'main',
      },
    };
    expect(getGraphResponseSchema.safeParse(validGraphResponse).success).toBe(true);
  });
});
