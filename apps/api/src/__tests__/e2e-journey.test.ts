import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../app.js';
import { loadConfig } from '../config/index.js';
import { createTempGitRepo, type TestGitRepo } from './git/fixture-helper.js';
import type { FastifyInstance } from 'fastify';

describe('End-to-End User Journey Audit', () => {
  let app: FastifyInstance;
  let tempRepo: TestGitRepo;
  let emptyRepo: TestGitRepo;
  let repoId: string;

  beforeEach(async () => {
    tempRepo = createTempGitRepo('gitscope-e2e-');
    emptyRepo = createTempGitRepo('gitscope-e2e-empty-');

    const config = loadConfig({
      DATABASE_PATH: ':memory:',
      ALLOWED_REPOSITORY_ROOTS: [path.dirname(tempRepo.dir), path.dirname(emptyRepo.dir)].join(';'),
      COCHANGE_MAX_FILES_PER_COMMIT: 200,
    });

    app = await buildApp({
      config,
      logger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    tempRepo.cleanup();
    emptyRepo.cleanup();
  });

  async function pollAnalysisUntilComplete(id: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${id}/analysis`,
      });
      const data = res.json().data;
      if (data && (data.status === 'completed' || data.status === 'failed')) {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Analysis polling timed out');
  }

  it('executes full end-to-end user workflow against realistic multi-branch Git fixture', async () => {
    // -------------------------------------------------------------
    // Step 1: Create a realistic Git repository with diverse artifacts
    // -------------------------------------------------------------
    // Commit 1: Initial commit with Unicode, spaces, and binary file
    tempRepo.run(['config', 'user.name', 'Alice Analyst']);
    tempRepo.run(['config', 'user.email', 'alice@gitscope.test']);

    tempRepo.commitFile('README.md', '# GitScope Fixture\n', 'Initial commit');
    tempRepo.commitFile('src/index.ts', 'export const version = "1.0.0";\n', 'Add index');
    tempRepo.commitFile(
      'tài_liệu/hướng_dẫn.md',
      '# Hướng dẫn sử dụng\n',
      'Add Vietnamese documentation',
    );
    const cBinary = tempRepo.commitFile(
      'assets with space/logo.png',
      Buffer.from([0x00, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'Add binary logo',
    );

    // Commit 2: Added by Bob
    tempRepo.run(['config', 'user.name', 'Bob Builder']);
    tempRepo.run(['config', 'user.email', 'bob@gitscope.test']);
    tempRepo.commitFile('docs/guide.txt', 'Step 1: Install\nStep 2: Run\n', 'Add user guide');

    // Commit 3: File Rename by Bob
    tempRepo.renameFile('docs/guide.txt', 'docs/manual.txt', 'Rename guide to manual');

    // Create feature branch
    tempRepo.createBranch('feature/billing');
    tempRepo.checkoutBranch('feature/billing');

    // Commit 4: Feature branch work by Charlie touching two files together
    tempRepo.run(['config', 'user.name', 'Charlie Coder']);
    tempRepo.run(['config', 'user.email', 'charlie@gitscope.test']);
    const billingPath = path.join(tempRepo.dir, 'src/billing.ts');
    const indexPath = path.join(tempRepo.dir, 'src/index.ts');
    fs.writeFileSync(billingPath, 'export function bill() { return true; }\n');
    fs.writeFileSync(indexPath, 'export const version = "1.1.0";\nexport * from "./billing.js";\n');
    tempRepo.run(['add', 'src/billing.ts', 'src/index.ts']);
    tempRepo.run(['commit', '-m', 'Implement billing module and update index']);

    // Switch back to default branch (master or main)
    const branches = tempRepo
      .run(['branch'])
      .split('\n')
      .map((b) => b.replace('*', '').trim());
    const defaultBranch = branches.find((b) => b === 'main' || b === 'master') || 'master';
    tempRepo.checkoutBranch(defaultBranch);

    // Commit 5: Alice commits to main
    tempRepo.run(['config', 'user.name', 'Alice Analyst']);
    tempRepo.run(['config', 'user.email', 'alice@gitscope.test']);
    tempRepo.commitFile(
      'src/config.ts',
      'export const config = { port: 3000 };\n',
      'Add application config',
    );

    // Commit 6: Merge commit (merge feature/billing into main)
    const mergeHash = tempRepo.mergeBranch('feature/billing', 'Merge branch feature/billing');

    // Tag creation at merge commit
    tempRepo.createTag('v1.0.0');

    // -------------------------------------------------------------
    // Step 2: Register repository via POST /api/repositories
    // -------------------------------------------------------------
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: tempRepo.dir },
    });
    expect(regRes.statusCode).toBe(201);
    const regData = regRes.json().data;
    expect(regData.id).toBeDefined();
    repoId = regData.id;

    // Verify duplicate registration idempotency (returns 200 with isExisting: true)
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: tempRepo.dir },
    });
    expect(dupRes.statusCode).toBe(200);
    expect(dupRes.json().isExisting).toBe(true);
    expect(dupRes.json().data.id).toBe(repoId);

    // -------------------------------------------------------------
    // Step 3: Trigger & poll initial analysis
    // -------------------------------------------------------------
    const analyzeRes = await app.inject({
      method: 'POST',
      url: `/api/repositories/${repoId}/analyze`,
    });
    expect(analyzeRes.statusCode).toBe(202);
    expect(analyzeRes.json().data.status).toBe('queued');

    // Concurrency guard: immediate second analyze request returns 409
    const conflictRes = await app.inject({
      method: 'POST',
      url: `/api/repositories/${repoId}/analyze`,
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().error.code).toBe('ANALYSIS_ALREADY_RUNNING');

    // Poll until completed
    await pollAnalysisUntilComplete(repoId);

    // -------------------------------------------------------------
    // Step 4: Repository overview & metadata
    // -------------------------------------------------------------
    const getRepoRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}`,
    });
    expect(getRepoRes.statusCode).toBe(200);
    expect(getRepoRes.json().data.analysisStatus).toBe('completed');
    expect(getRepoRes.json().data.commitsProcessed).toBeGreaterThanOrEqual(6);

    const listReposRes = await app.inject({
      method: 'GET',
      url: '/api/repositories',
    });
    expect(listReposRes.statusCode).toBe(200);
    expect(listReposRes.json().data.some((r: { id: string }) => r.id === repoId)).toBe(true);

    // -------------------------------------------------------------
    // Step 5: Commit Explorer with cursor pagination & filters
    // -------------------------------------------------------------
    // Page 1 with limit=3
    const commitsPage1 = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?limit=3`,
    });
    expect(commitsPage1.statusCode).toBe(200);
    expect(commitsPage1.json().data).toHaveLength(3);
    expect(commitsPage1.json().page.nextCursor).toBeDefined();

    // Page 2 using cursor
    const cursor = commitsPage1.json().page.nextCursor;
    const commitsPage2 = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?limit=3&cursor=${cursor}`,
    });
    expect(commitsPage2.statusCode).toBe(200);
    expect(commitsPage2.json().data.length).toBeGreaterThanOrEqual(1);

    // Author filtering (Bob Builder)
    const bobCommits = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?author=Bob`,
    });
    expect(bobCommits.statusCode).toBe(200);
    for (const c of bobCommits.json().data) {
      expect(c.authorName).toContain('Bob');
    }

    // Branch reachability filtering (feature/billing)
    const featureCommits = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?branch=feature/billing`,
    });
    expect(featureCommits.statusCode).toBe(200);
    expect(
      featureCommits
        .json()
        .data.some((c: { subject: string }) => c.subject.includes('Implement billing')),
    ).toBe(true);

    // Path filtering (src/billing.ts)
    const billingCommits = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits?path=src/billing.ts`,
    });
    expect(billingCommits.statusCode).toBe(200);
    expect(billingCommits.json().data.length).toBeGreaterThanOrEqual(1);

    // -------------------------------------------------------------
    // Step 6: Commit Details Drawer (merge commit & binary file)
    // -------------------------------------------------------------
    const mergeDetailRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits/${mergeHash}`,
    });
    expect(mergeDetailRes.statusCode).toBe(200);
    const mergeDetail = mergeDetailRes.json().data;
    expect(mergeDetail.parentHashes).toHaveLength(2);
    expect(mergeDetail.refs).toContain('v1.0.0');

    // Binary file commit detail
    const cBinaryDetailRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits/${cBinary}`,
    });
    expect(cBinaryDetailRes.statusCode).toBe(200);
    const cBinaryDetail = cBinaryDetailRes.json().data;
    const binaryFile = cBinaryDetail.fileChanges.find((f: { path: string }) =>
      f.path.includes('logo.png'),
    );
    expect(binaryFile).toBeDefined();
    expect(binaryFile.isBinary).toBe(true);
    expect(binaryFile.additions).toBeNull();
    expect(binaryFile.deletions).toBeNull();

    // -------------------------------------------------------------
    // Step 7: File History across rename
    // -------------------------------------------------------------
    const historyRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/files/docs/guide.txt/history`,
    });
    expect(historyRes.statusCode).toBe(200);
    const historyRows = historyRes.json().data;
    expect(historyRows.length).toBeGreaterThanOrEqual(2);
    expect(
      historyRows.some(
        (h: { changeType: string; oldPath: string | null }) =>
          h.changeType === 'renamed' && h.oldPath === 'docs/guide.txt',
      ),
    ).toBe(true);

    // -------------------------------------------------------------
    // Step 8: Commit Graph & Ref Selector
    // -------------------------------------------------------------
    const graphRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph?limit=100`,
    });
    expect(graphRes.statusCode).toBe(200);
    expect(graphRes.json().data.nodes.length).toBeGreaterThanOrEqual(6);

    const refsRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/refs`,
    });
    expect(refsRes.statusCode).toBe(200);
    const refsList = refsRes.json().data;
    expect(
      refsList.some(
        (r: { name: string; refType: string }) => r.name === 'v1.0.0' && r.refType === 'tag',
      ),
    ).toBe(true);
    expect(
      refsList.some(
        (r: { name: string; refType: string }) =>
          r.name === 'feature/billing' && r.refType === 'branch',
      ),
    ).toBe(true);

    // -------------------------------------------------------------
    // Step 9: Analytics Dashboard (Activity, Hotspots, Co-Changes)
    // -------------------------------------------------------------
    const activityRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/activity?interval=day`,
    });
    expect(activityRes.statusCode).toBe(200);
    const actData = activityRes.json().data;
    expect(actData.totalCommits).toBeGreaterThanOrEqual(6);
    expect(actData.totalContributors).toBe(3); // Alice, Bob, Charlie
    expect(actData.buckets.length).toBeGreaterThan(0);

    const hotspotsRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/hotspots`,
    });
    expect(hotspotsRes.statusCode).toBe(200);
    const hotData = hotspotsRes.json().data;
    expect(hotData.some((h: { path: string }) => h.path === 'src/index.ts')).toBe(true);

    const coChangeRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/co-changes?minCount=1`,
    });
    expect(coChangeRes.statusCode).toBe(200);
    const coData = coChangeRes.json().data;
    // Commit 4 touched src/billing.ts and src/index.ts together
    expect(
      coData.pairs.some(
        (p: { pathA: string; pathB: string }) =>
          (p.pathA === 'src/billing.ts' && p.pathB === 'src/index.ts') ||
          (p.pathA === 'src/index.ts' && p.pathB === 'src/billing.ts'),
      ),
    ).toBe(true);

    // -------------------------------------------------------------
    // Step 10: Incremental Commit & Re-Import
    // -------------------------------------------------------------
    const cNew = tempRepo.commitFile(
      'src/analytics.ts',
      'export const metrics = true;\n',
      'Add analytics service',
    );
    const reanalyzeRes = await app.inject({
      method: 'POST',
      url: `/api/repositories/${repoId}/analyze`,
    });
    expect(reanalyzeRes.statusCode).toBe(202);
    await pollAnalysisUntilComplete(repoId);

    const newCommitCheck = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits/${cNew}`,
    });
    expect(newCommitCheck.statusCode).toBe(200);

    // -------------------------------------------------------------
    // Step 11: History Rewrite / Force-Push Pruning
    // -------------------------------------------------------------
    // Reset branch back 1 commit (rewrites tip, making cNew unreachable)
    tempRepo.run(['reset', '--hard', 'HEAD~1']);

    const rewriteAnalyzeRes = await app.inject({
      method: 'POST',
      url: `/api/repositories/${repoId}/analyze`,
    });
    expect(rewriteAnalyzeRes.statusCode).toBe(202);
    await pollAnalysisUntilComplete(repoId);

    // Obsolete commit must now return 404
    const prunedCheck = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/commits/${cNew}`,
    });
    expect(prunedCheck.statusCode).toBe(404);

    // -------------------------------------------------------------
    // Step 12: Empty repository and edge case validation
    // -------------------------------------------------------------
    const emptyReg = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: emptyRepo.dir },
    });
    expect(emptyReg.statusCode).toBe(201);
    const emptyId = emptyReg.json().data.id;

    await app.inject({ method: 'POST', url: `/api/repositories/${emptyId}/analyze` });
    await pollAnalysisUntilComplete(emptyId);

    const emptyAct = await app.inject({
      method: 'GET',
      url: `/api/repositories/${emptyId}/activity`,
    });
    expect(emptyAct.statusCode).toBe(200);
    expect(emptyAct.json().data.totalCommits).toBe(0);

    const emptyHotspots = await app.inject({
      method: 'GET',
      url: `/api/repositories/${emptyId}/hotspots`,
    });
    expect(emptyHotspots.statusCode).toBe(200);
    expect(emptyHotspots.json().data).toEqual([]);

    const emptyCo = await app.inject({
      method: 'GET',
      url: `/api/repositories/${emptyId}/co-changes`,
    });
    expect(emptyCo.statusCode).toBe(200);
    expect(emptyCo.json().data.pairs).toEqual([]);

    // Validation rejection checks
    const badUuidRes = await app.inject({ method: 'GET', url: '/api/repositories/not-a-uuid' });
    expect(badUuidRes.statusCode).toBe(400);

    const badDateRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/activity?from=2026-12-01T00:00:00Z&to=2026-01-01T00:00:00Z`,
    });
    expect(badDateRes.statusCode).toBe(400);
    expect(badDateRes.json().error.code).toBe('INVALID_DATE_RANGE');
  }, 30000);
});
