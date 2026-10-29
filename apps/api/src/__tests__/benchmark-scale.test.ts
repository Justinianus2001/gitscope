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

interface BenchmarkResult {
  scale: string;
  commitCount: number;
  coldImportMs: number;
  noopReimportMs: number;
  incrementalReimportMs: number;
  historyRewriteReimportMs: number;
  commitPaginationMedianMs: number;
  fileHistoryMedianMs: number;
  commitGraphMedianMs: number;
  activityMedianMs: number;
  hotspotsMedianMs: number;
  coChangesMedianMs: number;
  dbSizeBytes: number;
}

export const benchmarkResults: BenchmarkResult[] = [];

function getDbSize(dbFile: string): number {
  let size = 0;
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    if (fs.existsSync(f)) {
      size += fs.statSync(f).size;
    }
  }
  return size;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

describe('GitScope Scalability & Performance Benchmark', { timeout: 240000 }, () => {
  // -------------------------------------------------------------
  // Small Scale Fixture (~100 commits)
  // -------------------------------------------------------------
  describe('Small Scale Benchmark (~100 commits)', () => {
    let app: FastifyInstance;
    let repo: TestGitRepo;
    let repoId: string;
    let dbFile: string;

    const result: BenchmarkResult = {
      scale: 'Small',
      commitCount: 100,
      coldImportMs: 0,
      noopReimportMs: 0,
      incrementalReimportMs: 0,
      historyRewriteReimportMs: 0,
      commitPaginationMedianMs: 0,
      fileHistoryMedianMs: 0,
      commitGraphMedianMs: 0,
      activityMedianMs: 0,
      hotspotsMedianMs: 0,
      coChangesMedianMs: 0,
      dbSizeBytes: 0,
    };

    beforeAll(async () => {
      repo = createTempGitRepo('gitscope-bench-small-');
      const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscope-db-small-'));
      dbFile = path.join(tempDbDir, 'gitscope_small.sqlite');

      // Generate 100 commits across multiple files
      for (let i = 1; i <= 100; i++) {
        const fileIdx = i % 8;
        const fileA = `src/module_${fileIdx}.ts`;
        const fileB = `src/shared.ts`;
        const fullA = path.join(repo.dir, fileA);
        const fullB = path.join(repo.dir, fileB);
        fs.mkdirSync(path.dirname(fullA), { recursive: true });
        fs.writeFileSync(fullA, `export const mod${fileIdx} = ${i};\n`);
        fs.writeFileSync(fullB, `export const sharedCounter = ${i};\n`);
        repo.run(['add', '.']);
        repo.run(['commit', '-m', `Commit ${i} in small benchmark`]);
        if (i % 20 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Add a rename commit
      repo.renameFile('src/shared.ts', 'src/common_shared.ts', 'Rename shared to common_shared');

      const db = createDb({ path: dbFile });
      app = await buildApp({
        db,
        config: {
          NODE_ENV: 'test',
          API_HOST: '127.0.0.1',
          API_PORT: 4000,
          WEB_PORT: 3000,
          DATABASE_PATH: dbFile,
          ALLOWED_REPOSITORY_ROOTS: [path.dirname(repo.dir)],
          GIT_COMMAND_TIMEOUT_MS: 30000,
          MAX_GIT_OUTPUT_BYTES: 50000000,
          COCHANGE_MAX_FILES_PER_COMMIT: 200,
        },
        logger: false,
      });
      await app.ready();

      const reg = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: repo.dir },
      });
      repoId = reg.json().data.id;
    }, 60000);

    afterAll(async () => {
      await app.close();
      repo?.cleanup();
      try {
        fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
      } catch {}
      benchmarkResults.push(result);
    });

    it('measures cold import latency', async () => {
      const t0 = performance.now();
      const run = await importRepository(repoId, repo.dir, app.db);
      result.coldImportMs = performance.now() - t0;
      expect(run.status).toBe('completed');
      expect(run.commitsProcessed).toBeGreaterThanOrEqual(101);

      result.dbSizeBytes = getDbSize(dbFile);
    });

    it('measures no-op re-import latency', async () => {
      const t0 = performance.now();
      const run = await importRepository(repoId, repo.dir, app.db);
      result.noopReimportMs = performance.now() - t0;
      expect(run.status).toBe('completed');
    });

    it('measures incremental re-import after adding 5 commits', async () => {
      for (let k = 1; k <= 5; k++) {
        repo.commitFile(`src/inc_${k}.txt`, `line ${k}\n`, `Incremental commit ${k}`);
      }

      const t0 = performance.now();
      const run = await importRepository(repoId, repo.dir, app.db);
      result.incrementalReimportMs = performance.now() - t0;
      expect(run.status).toBe('completed');
      expect(run.commitsProcessed).toBeGreaterThanOrEqual(106);
    });

    it('measures re-import latency after history rewrite / reset', async () => {
      repo.run(['reset', '--hard', 'HEAD~5']);

      const t0 = performance.now();
      const run = await importRepository(repoId, repo.dir, app.db);
      result.historyRewriteReimportMs = performance.now() - t0;
      expect(run.status).toBe('completed');
    });

    it('measures query latencies across multiple repetitions', async () => {
      // 1. Commit Pagination (5 repetitions)
      const pageTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const p1 = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/commits?limit=50`,
        });
        expect(p1.statusCode).toBe(200);
        const cursor = p1.json().page.nextCursor;
        if (cursor) {
          const p2 = await app.inject({
            method: 'GET',
            url: `/api/repositories/${repoId}/commits?limit=50&cursor=${cursor}`,
          });
          expect(p2.statusCode).toBe(200);
        }
        pageTimes.push(performance.now() - t0);
      }
      result.commitPaginationMedianMs = median(pageTimes);

      // 2. File History with Renames (5 repetitions)
      const fileHistTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const fRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/files/src/common_shared.ts/history`,
        });
        expect(fRes.statusCode).toBe(200);
        fileHistTimes.push(performance.now() - t0);
      }
      result.fileHistoryMedianMs = median(fileHistTimes);

      // 3. Commit Graph (5 repetitions)
      const graphTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const gRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/graph?limit=300`,
        });
        expect(gRes.statusCode).toBe(200);
        graphTimes.push(performance.now() - t0);
      }
      result.commitGraphMedianMs = median(graphTimes);

      // 4. Activity Aggregation (5 repetitions)
      const actTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const aRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/activity?interval=day`,
        });
        expect(aRes.statusCode).toBe(200);
        actTimes.push(performance.now() - t0);
      }
      result.activityMedianMs = median(actTimes);

      // 5. Hotspots Aggregation (5 repetitions)
      const hotTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const hRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/hotspots?limit=50`,
        });
        expect(hRes.statusCode).toBe(200);
        hotTimes.push(performance.now() - t0);
      }
      result.hotspotsMedianMs = median(hotTimes);

      // 6. Co-Changes Mining (5 repetitions)
      const coTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const cRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/co-changes?minCount=2&limit=50`,
        });
        expect(cRes.statusCode).toBe(200);
        coTimes.push(performance.now() - t0);
      }
      result.coChangesMedianMs = median(coTimes);

      // Assert that interactive API operations execute under interactive response target (50ms)
      expect(result.commitPaginationMedianMs).toBeLessThan(100);
      expect(result.fileHistoryMedianMs).toBeLessThan(50);
      expect(result.commitGraphMedianMs).toBeLessThan(100);
      expect(result.activityMedianMs).toBeLessThan(50);
      expect(result.hotspotsMedianMs).toBeLessThan(50);
      expect(result.coChangesMedianMs).toBeLessThan(50);
    });
  });

  // -------------------------------------------------------------
  // Medium Scale Fixture (~500 commits)
  // -------------------------------------------------------------
  describe('Medium Scale Benchmark (~500 commits)', () => {
    let app: FastifyInstance;
    let repo: TestGitRepo;
    let repoId: string;
    let dbFile: string;

    const result: BenchmarkResult = {
      scale: 'Medium',
      commitCount: 500,
      coldImportMs: 0,
      noopReimportMs: 0,
      incrementalReimportMs: 0,
      historyRewriteReimportMs: 0,
      commitPaginationMedianMs: 0,
      fileHistoryMedianMs: 0,
      commitGraphMedianMs: 0,
      activityMedianMs: 0,
      hotspotsMedianMs: 0,
      coChangesMedianMs: 0,
      dbSizeBytes: 0,
    };

    beforeAll(async () => {
      repo = createTempGitRepo('gitscope-bench-med-');
      const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscope-db-med-'));
      dbFile = path.join(tempDbDir, 'gitscope_med.sqlite');

      // Generate 500 commits
      for (let i = 1; i <= 500; i++) {
        const fileIdx = i % 20;
        const fileA = `services/core/service_${fileIdx}.ts`;
        const fileB = `services/core/service_${(fileIdx + 1) % 20}.ts`;
        const fullA = path.join(repo.dir, fileA);
        const fullB = path.join(repo.dir, fileB);
        fs.mkdirSync(path.dirname(fullA), { recursive: true });
        fs.writeFileSync(fullA, `export const s${fileIdx} = ${i};\n`);
        fs.writeFileSync(fullB, `export const sPair = ${i};\n`);
        repo.run(['add', '.']);
        repo.run(['commit', '-m', `Medium scale commit ${i}`]);
        if (i % 20 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      const db = createDb({ path: dbFile });
      app = await buildApp({
        db,
        config: {
          NODE_ENV: 'test',
          API_HOST: '127.0.0.1',
          API_PORT: 4000,
          WEB_PORT: 3000,
          DATABASE_PATH: dbFile,
          ALLOWED_REPOSITORY_ROOTS: [path.dirname(repo.dir)],
          GIT_COMMAND_TIMEOUT_MS: 60000,
          MAX_GIT_OUTPUT_BYTES: 50000000,
          COCHANGE_MAX_FILES_PER_COMMIT: 200,
        },
        logger: false,
      });
      await app.ready();

      const reg = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: repo.dir },
      });
      repoId = reg.json().data.id;
    }, 180000);

    afterAll(async () => {
      await app.close();
      repo?.cleanup();
      try {
        fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
      } catch {}
      benchmarkResults.push(result);

      console.log('\n======================================================');
      console.log('       GITSCOPE SYNTHETIC SCALABILITY RESULTS         ');
      console.log('======================================================');
      for (const b of benchmarkResults) {
        console.log(`\n[${b.scale} Scale — ${b.commitCount} Commits]`);
        console.log(`- Database Size on Disk:          ${(b.dbSizeBytes / 1024).toFixed(1)} KB`);
        console.log(`- Cold Initial Import:            ${b.coldImportMs.toFixed(2)} ms`);
        console.log(`- No-op Re-import:                ${b.noopReimportMs.toFixed(2)} ms`);
        console.log(`- Incremental Re-import (+5 com): ${b.incrementalReimportMs.toFixed(2)} ms`);
        console.log(
          `- History Rewrite Re-import:      ${b.historyRewriteReimportMs.toFixed(2)} ms`,
        );
        console.log(
          `- Commit Pagination (Median):     ${b.commitPaginationMedianMs.toFixed(2)} ms`,
        );
        console.log(`- File History (Median):          ${b.fileHistoryMedianMs.toFixed(2)} ms`);
        console.log(`- Commit Graph (Median):          ${b.commitGraphMedianMs.toFixed(2)} ms`);
        console.log(`- Activity Aggregation (Median):  ${b.activityMedianMs.toFixed(2)} ms`);
        console.log(`- Hotspots Calculation (Median):  ${b.hotspotsMedianMs.toFixed(2)} ms`);
        console.log(`- Co-Change Mining (Median):      ${b.coChangesMedianMs.toFixed(2)} ms`);
      }
      console.log('======================================================\n');
    });

    it('measures cold import latency for 500 commits', async () => {
      const t0 = performance.now();
      const run = await importRepository(repoId, repo.dir, app.db);
      result.coldImportMs = performance.now() - t0;
      expect(run.status).toBe('completed');
      expect(run.commitsProcessed).toBeGreaterThanOrEqual(500);

      result.dbSizeBytes = getDbSize(dbFile);
    });

    it('measures no-op re-import latency for 500 commits', async () => {
      const t0 = performance.now();
      const run = await importRepository(repoId, repo.dir, app.db);
      result.noopReimportMs = performance.now() - t0;
      expect(run.status).toBe('completed');
    });

    it('measures incremental re-import after adding 5 commits', async () => {
      for (let k = 1; k <= 5; k++) {
        repo.commitFile(`services/inc_${k}.txt`, `inc ${k}\n`, `Inc commit ${k}`);
      }

      const t0 = performance.now();
      const run = await importRepository(repoId, repo.dir, app.db);
      result.incrementalReimportMs = performance.now() - t0;
      expect(run.status).toBe('completed');
      expect(run.commitsProcessed).toBeGreaterThanOrEqual(505);
    });

    it('measures re-import latency after history rewrite / reset', async () => {
      repo.run(['reset', '--hard', 'HEAD~5']);

      const t0 = performance.now();
      const run = await importRepository(repoId, repo.dir, app.db);
      result.historyRewriteReimportMs = performance.now() - t0;
      expect(run.status).toBe('completed');
    });

    it('measures query latencies across 500-commit repository', async () => {
      // 1. Commit Pagination
      const pageTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const p1 = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/commits?limit=50`,
        });
        expect(p1.statusCode).toBe(200);
        const cursor = p1.json().page.nextCursor;
        if (cursor) {
          const p2 = await app.inject({
            method: 'GET',
            url: `/api/repositories/${repoId}/commits?limit=50&cursor=${cursor}`,
          });
          expect(p2.statusCode).toBe(200);
        }
        pageTimes.push(performance.now() - t0);
      }
      result.commitPaginationMedianMs = median(pageTimes);

      // 2. File History
      const fileHistTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const fRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/files/services/core/service_1.ts/history`,
        });
        expect(fRes.statusCode).toBe(200);
        fileHistTimes.push(performance.now() - t0);
      }
      result.fileHistoryMedianMs = median(fileHistTimes);

      // 3. Commit Graph
      const graphTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const gRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/graph?limit=300`,
        });
        expect(gRes.statusCode).toBe(200);
        graphTimes.push(performance.now() - t0);
      }
      result.commitGraphMedianMs = median(graphTimes);

      // 4. Activity Aggregation
      const actTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const aRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/activity?interval=day`,
        });
        expect(aRes.statusCode).toBe(200);
        actTimes.push(performance.now() - t0);
      }
      result.activityMedianMs = median(actTimes);

      // 5. Hotspots Aggregation
      const hotTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const hRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/hotspots?limit=50`,
        });
        expect(hRes.statusCode).toBe(200);
        hotTimes.push(performance.now() - t0);
      }
      result.hotspotsMedianMs = median(hotTimes);

      // 6. Co-Changes Mining
      const coTimes: number[] = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        const cRes = await app.inject({
          method: 'GET',
          url: `/api/repositories/${repoId}/co-changes?minCount=2&limit=50`,
        });
        expect(cRes.statusCode).toBe(200);
        coTimes.push(performance.now() - t0);
      }
      result.coChangesMedianMs = median(coTimes);

      // In 500-commit database, all endpoints must comfortably remain sub-100ms
      expect(result.commitPaginationMedianMs).toBeLessThan(100);
      expect(result.fileHistoryMedianMs).toBeLessThan(50);
      expect(result.commitGraphMedianMs).toBeLessThan(150);
      expect(result.activityMedianMs).toBeLessThan(50);
      expect(result.hotspotsMedianMs).toBeLessThan(50);
      expect(result.coChangesMedianMs).toBeLessThan(100);
    });
  });
});
