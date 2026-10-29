import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';

describe('GET /api/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const db = createDb({ path: ':memory:' });
    app = await buildApp({ db, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns status ok with 200 HTTP code', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
