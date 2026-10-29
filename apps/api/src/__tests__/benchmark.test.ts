import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { createTempGitRepo, type TestGitRepo } from './git/fixture-helper.js';
import { importRepository } from '../git/importer.js';

describe('Analytics & Co-Change Performance Benchmark', () => {
  let app: FastifyInstance;
  let repo: TestGitRepo;
  let repoId: string;

  let importDurationMs = 0;
  let activityDurationMs = 0;
  let hotspotsDurationMs = 0;
  let coChangesDurationMs = 0;

  beforeAll(async () => {
    repo = createTempGitRepo('gitscope-benchmark-');

    // Generate 30 regular commits modifying pairs of files
    for (let i = 1; i <= 30; i++) {
      const fileIndex = i % 10;
      const fileA = `modules/core/service_${fileIndex}.ts`;
      const fileB = `modules/core/service_${(fileIndex + 1) % 10}.ts`;
      const fileC = `modules/common/types.ts`;

      const fullPathA = path.join(repo.dir, fileA);
      const fullPathB = path.join(repo.dir, fileB);
      const fullPathC = path.join(repo.dir, fileC);

      fs.mkdirSync(path.dirname(fullPathA), { recursive: true });
      fs.mkdirSync(path.dirname(fullPathC), { recursive: true });

      fs.writeFileSync(fullPathA, `export const service${fileIndex} = ${i};\n`);
      fs.writeFileSync(fullPathB, `export const service${(fileIndex + 1) % 10} = ${i};\n`);
      fs.writeFileSync(fullPathC, `export type T${i} = string;\n`);

      repo.run(['add', '.']);
      repo.run(['commit', '-m', `Iterative commit ${i}`]);
    }

    // Add 1 large commit touching 250 files (exceeding the default 200 limit!)
    const largeDir = path.join(repo.dir, 'large_bundle');
    fs.mkdirSync(largeDir, { recursive: true });
    for (let j = 1; j <= 250; j++) {
      fs.writeFileSync(path.join(largeDir, `chunk_${j}.txt`), `chunk ${j}\n`);
    }
    repo.run(['add', '.']);
    repo.run(['commit', '-m', 'Bulk commit touching 250 files']);

    const db = createDb({ path: ':memory:' });
    app = await buildApp({
      db,
      config: {
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: 4000,
        WEB_PORT: 3000,
        DATABASE_PATH: ':memory:',
        ALLOWED_REPOSITORY_ROOTS: [os.tmpdir()],
        GIT_COMMAND_TIMEOUT_MS: 30000,
        MAX_GIT_OUTPUT_BYTES: 50000000,
        COCHANGE_MAX_FILES_PER_COMMIT: 200,
      },
      logger: false,
    });
    await app.ready();

    // Register repo
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: repo.dir },
    });
    repoId = regRes.json().data.id;

    // Measure cold import
    const t0 = performance.now();
    await importRepository(repoId, repo.dir, db);
    importDurationMs = performance.now() - t0;
  }, 30000);

  afterAll(async () => {
    await app.close();
    repo?.cleanup();

    console.log('\n=== GitScope Milestone 5 Benchmark Results ===');
    console.log(`- Cold Import (31 commits, 270+ file changes): ${importDurationMs.toFixed(2)} ms`);
    console.log(`- Activity Aggregation API: ${activityDurationMs.toFixed(2)} ms`);
    console.log(`- Hotspots Calculation API: ${hotspotsDurationMs.toFixed(2)} ms`);
    console.log(
      `- Co-Change Mining API (bounded quadratic join): ${coChangesDurationMs.toFixed(2)} ms`,
    );
    console.log('==============================================\n');
  });

  it('measures activity query latency', async () => {
    const t0 = performance.now();
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/activity?interval=day`,
    });
    activityDurationMs = performance.now() - t0;

    expect(res.statusCode).toBe(200);
    expect(res.json().data.totalCommits).toBe(31);
    expect(activityDurationMs).toBeLessThan(500); // well within interactive latency
  });

  it('measures hotspots query latency', async () => {
    const t0 = performance.now();
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/hotspots?limit=50`,
    });
    hotspotsDurationMs = performance.now() - t0;

    expect(res.statusCode).toBe(200);
    const hotspots = res.json().data;
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspotsDurationMs).toBeLessThan(500);
  });

  it('measures bounded co-change mining query latency and verifies safety ceiling', async () => {
    const t0 = performance.now();
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/co-changes?minCount=2&limit=50`,
    });
    coChangesDurationMs = performance.now() - t0;

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.safetyThreshold).toBe(200);
    // The 250-file bulk commit must be excluded from quadratic generation
    expect(body.data.excludedLargeCommitsCount).toBe(1);
    expect(body.data.pairs.length).toBeGreaterThan(0);
    expect(coChangesDurationMs).toBeLessThan(1000);
  });
});
