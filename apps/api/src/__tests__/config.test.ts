import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config/index.js';

describe('Config Loader', () => {
  it('loads valid configuration with defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
    });
    expect(config.NODE_ENV).toBe('test');
    expect(config.API_PORT).toBe(4000);
    expect(config.ALLOWED_REPOSITORY_ROOTS).toEqual(['./sample-repositories']);
  });

  it('rejects invalid numeric configurations', () => {
    expect(() => {
      loadConfig({
        API_PORT: -10,
      });
    }).toThrow(/Configuration validation failed/);
  });
});
