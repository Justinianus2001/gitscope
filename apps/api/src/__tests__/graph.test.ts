import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { createTempGitRepo, type TestGitRepo } from './git/fixture-helper.js';
import { importRepository } from '../git/importer.js';

describe('Graph API (GET /api/repositories/:id/graph and /refs)', () => {
  let app: FastifyInstance;
  let repo: TestGitRepo;
  let repoId: string;
  let emptyRepo: TestGitRepo;
  let emptyRepoId: string;
  let secondRepo: TestGitRepo;
  let secondRepoId: string;

  let commit1Hash: string;
  let commit2Hash: string;
  let featureCommitHash: string;
  let mainCommit3Hash: string;
  let mergeCommitHash: string;

  beforeAll(async () => {
    // 1. Create primary test repository with linear, branching, and merge history
    repo = createTempGitRepo('gitscope-graph-test-');

    // Commit 1 on default branch
    commit1Hash = repo.commitFile('hello.txt', 'Hello world\n', 'Initial commit');
    repo.createTag('v0.1.0');

    // Commit 2 on default branch
    commit2Hash = repo.commitFile('hello.txt', 'Hello world v2\n', 'Update hello');

    // Branch: feature
    repo.createBranch('feature');
    repo.checkoutBranch('feature');
    featureCommitHash = repo.commitFile('feature.txt', 'Feature work\n', 'Add feature');

    // Return to default branch (determine if it is master or main)
    const currentBranch = repo.run(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const defaultBranchName = currentBranch === 'feature' ? 'master' : currentBranch;
    repo.checkoutBranch(defaultBranchName);

    // Commit 3 on default branch
    mainCommit3Hash = repo.commitFile('main.txt', 'Main branch progress\n', 'Advance main');

    // Merge feature into default branch
    mergeCommitHash = repo.mergeBranch('feature', 'Merge branch feature');
    repo.createTag('v1.0.0');

    // 2. Create empty repository
    emptyRepo = createTempGitRepo('gitscope-graph-empty-');

    // 3. Create second repository for isolation tests
    secondRepo = createTempGitRepo('gitscope-graph-iso-');
    secondRepo.commitFile('isolated.txt', 'Isolation data\n', 'Second repo commit');

    // Set up database and app
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

    // Register and import primary repo
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: repo.dir },
    });
    repoId = regRes.json().data.id;
    await importRepository(repoId, repo.dir, db);

    // Register and import empty repo
    const regEmptyRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: emptyRepo.dir },
    });
    emptyRepoId = regEmptyRes.json().data.id;
    await importRepository(emptyRepoId, emptyRepo.dir, db);

    // Register and import second repo
    const regIsoRes = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      payload: { path: secondRepo.dir },
    });
    secondRepoId = regIsoRes.json().data.id;
    await importRepository(secondRepoId, secondRepo.dir, db);
  });

  afterAll(async () => {
    await app.close();
    repo?.cleanup();
    emptyRepo?.cleanup();
    secondRepo?.cleanup();
  });

  it('rejects invalid UUID repository ID with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/repositories/not-a-uuid/graph',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ID');
  });

  it('returns 404 for non-existent repository', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/repositories/12345678-1234-4234-8234-1234567890ab/graph',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('REPOSITORY_NOT_FOUND');
  });

  it('returns empty nodes list for empty repository', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${emptyRepoId}/graph`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.nodes).toEqual([]);
    expect(body.data.truncated).toBe(false);
    expect(body.data.ref).toBeNull();
  });

  it('returns ancestry graph with merge commit, parents, and refs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.truncated).toBe(false);

    const nodes = body.data.nodes;
    expect(nodes.length).toBe(5); // merge, main3, feature, commit2, commit1

    // Find the merge commit node
    const mergeNode = nodes.find((n: { hash: string }) => n.hash === mergeCommitHash);
    expect(mergeNode).toBeDefined();
    expect(mergeNode.parentHashes.length).toBe(2);
    // Primary parent should be mainCommit3Hash, secondary parent should be featureCommitHash
    expect(mergeNode.parentHashes[0]).toBe(mainCommit3Hash);
    expect(mergeNode.parentHashes[1]).toBe(featureCommitHash);
    // Associated refs on merge commit: v1.0.0 and default branch
    expect(mergeNode.refs).toContain('v1.0.0');

    // Find commit1 node and verify tag v0.1.0
    const commit1Node = nodes.find((n: { hash: string }) => n.hash === commit1Hash);
    expect(commit1Node).toBeDefined();
    expect(commit1Node.parentHashes).toEqual([]);
    expect(commit1Node.refs).toContain('v0.1.0');
  });

  it('supports explicit ref selection for branches and tags', async () => {
    // Query feature branch graph
    const featureRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph?ref=feature`,
    });
    expect(featureRes.statusCode).toBe(200);
    const featureBody = featureRes.json();
    expect(featureBody.data.ref).toBe('feature');

    const featureHashes = featureBody.data.nodes.map((n: { hash: string }) => n.hash);
    expect(featureHashes).toContain(featureCommitHash);
    expect(featureHashes).toContain(commit2Hash);
    expect(featureHashes).toContain(commit1Hash);
    // Should NOT contain mainCommit3Hash or mergeCommitHash because they are not ancestors of feature
    expect(featureHashes).not.toContain(mainCommit3Hash);
    expect(featureHashes).not.toContain(mergeCommitHash);

    // Query tag ref
    const tagRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph?ref=v0.1.0`,
    });
    expect(tagRes.statusCode).toBe(200);
    const tagBody = tagRes.json();
    expect(tagBody.data.nodes.length).toBe(1);
    expect(tagBody.data.nodes[0].hash).toBe(commit1Hash);
  });

  it('returns 404 REF_NOT_FOUND when ref does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph?ref=does-not-exist`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('REF_NOT_FOUND');
  });

  it('respects limit and correctly sets truncated: true', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph?limit=2`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.nodes.length).toBe(2);
    expect(body.data.truncated).toBe(true);
  });

  it('enforces repository isolation (no cross-repo data leakage)', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph`,
    });
    const res2 = await app.inject({
      method: 'GET',
      url: `/api/repositories/${secondRepoId}/graph`,
    });

    const hashes1 = new Set(res1.json().data.nodes.map((n: { hash: string }) => n.hash));
    const hashes2 = new Set(res2.json().data.nodes.map((n: { hash: string }) => n.hash));

    // Intersection must be empty
    for (const h of hashes1) {
      expect(hashes2.has(h)).toBe(false);
    }
  });

  it('GET /api/repositories/:id/refs returns all branches and tags', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/refs`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);

    const refNames = body.data.map((r: { name: string }) => r.name);
    expect(refNames).toContain('feature');
    expect(refNames).toContain('v0.1.0');
    expect(refNames).toContain('v1.0.0');
  });

  it('supports lookup by commit hash directly (full hash and 7-char short hash)', async () => {
    // Lookup by full 40-char hash
    const fullRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph?ref=${commit2Hash}`,
    });
    expect(fullRes.statusCode).toBe(200);
    const fullNodes = fullRes.json().data.nodes;
    expect(fullNodes.map((n: { hash: string }) => n.hash)).toContain(commit2Hash);
    expect(fullRes.json().data.ref).toBe(commit2Hash.slice(0, 7));

    // Lookup by 7-char abbreviated hash
    const shortHash = commit2Hash.slice(0, 7);
    const shortRes = await app.inject({
      method: 'GET',
      url: `/api/repositories/${repoId}/graph?ref=${shortHash}`,
    });
    expect(shortRes.statusCode).toBe(200);
    const shortNodes = shortRes.json().data.nodes;
    expect(shortNodes.map((n: { hash: string }) => n.hash)).toContain(commit2Hash);
    expect(shortRes.json().data.ref).toBe(shortHash);
  });

  describe('Deep Scale Regression & Correctness (1,000 Commits)', () => {
    let scaleRepo: TestGitRepo;
    let scaleRepoId: string;

    beforeAll(async () => {
      scaleRepo = createTempGitRepo('gitscope-graph-scale-');
      // Create 1,000 commits programmatically with distinct timestamps
      const baseTs = 1700000000;
      let stream = '';
      for (let i = 1; i <= 1000; i++) {
        const ts = baseTs + i * 60;
        const msg = `Scale graph commit ${i}\n`;
        const data = `export const v = ${i};\n`;
        stream += 'commit refs/heads/main\n';
        stream += `committer Dev <dev@test.com> ${ts} +0000\n`;
        stream += `data ${Buffer.byteLength(msg)}\n${msg}`;
        stream += `M 644 inline src/app.ts\n`;
        stream += `data ${Buffer.byteLength(data)}\n${data}`;
      }
      const res = spawnSync('git', ['fast-import', '--quiet'], {
        cwd: scaleRepo.dir,
        input: stream,
      });
      if (res.status !== 0) throw new Error('fast-import failed');
      spawnSync('git', ['checkout', '-f', 'main'], { cwd: scaleRepo.dir });

      const reg = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: scaleRepo.dir },
      });
      scaleRepoId = reg.json().data.id;
      await importRepository(scaleRepoId, scaleRepo.dir, app.db);
    });

    afterAll(() => {
      scaleRepo?.cleanup();
    });

    it('retrieves bounded graph on 1,000 commits with strict topological order and correct parent links', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${scaleRepoId}/graph?limit=300`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.truncated).toBe(true);
      expect(body.data.nodes.length).toBe(300);

      // Verify strict descending author time order
      const nodes = body.data.nodes;
      for (let i = 0; i < nodes.length - 1; i++) {
        expect(new Date(nodes[i].authorTime).getTime()).toBeGreaterThanOrEqual(
          new Date(nodes[i + 1].authorTime).getTime(),
        );
        // In a linear history, node i should have node i+1 as its parent
        expect(nodes[i].parentHashes[0]).toBe(nodes[i + 1].hash);
      }

      // Boundary node (300th node) must retain its parent hash pointing to 301st commit outside window
      expect(nodes[299].parentHashes.length).toBe(1);
      expect(nodes[299].parentHashes[0]).toBeDefined();
    });

    it('preserves boundary node parent references when graph is truncated to small limits', async () => {
      // Request limit=5 on scaleRepo where order is strictly chronological
      const res = await app.inject({
        method: 'GET',
        url: `/api/repositories/${scaleRepoId}/graph?limit=5`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.truncated).toBe(true);
      expect(body.data.nodes.length).toBe(5);

      const nodes = body.data.nodes;
      // All nodes 0..4 have exactly 1 parent
      for (const n of nodes) {
        expect(n.parentHashes.length).toBe(1);
      }
      // Boundary 5th node points to the 6th commit (which is truncated)
      expect(nodes[4].parentHashes[0]).toBeDefined();
    });
  });
});
