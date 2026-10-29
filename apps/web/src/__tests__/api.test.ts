import { describe, it, expect } from 'vitest';
import { ApiError } from '../lib/api.js';

describe('Web API Client', () => {
  it('creates ApiError with correct status and error code', () => {
    const error = new ApiError(404, 'NOT_FOUND', 'Repository not found');
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Repository not found');
    expect(error.name).toBe('ApiError');
  });
});
