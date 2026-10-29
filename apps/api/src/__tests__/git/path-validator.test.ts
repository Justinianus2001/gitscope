import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRepositoryPath, PathValidationError } from '../../git/path-validator.js';
import { createTempGitRepo } from './fixture-helper.js';

describe('Path Validator', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscope-validator-root-'));
  const allowedRoots = [rootDir];

  afterAll(() => {
    try {
      fs.rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('rejects empty or whitespace-only paths', () => {
    expect(() => validateRepositoryPath('', allowedRoots)).toThrow(PathValidationError);
    expect(() => validateRepositoryPath('   ', allowedRoots)).toThrow(
      /Repository path must not be empty/,
    );
  });

  it('rejects nonexistent paths', () => {
    const nonexistent = path.join(rootDir, 'does-not-exist');
    expect(() => validateRepositoryPath(nonexistent, allowedRoots)).toThrow(
      /does not exist or is inaccessible/,
    );
  });

  it('rejects files instead of directories', () => {
    const filePath = path.join(rootDir, 'sample.txt');
    fs.writeFileSync(filePath, 'hello');

    expect(() => validateRepositoryPath(filePath, allowedRoots)).toThrow(/is not a directory/);
  });

  it('rejects paths outside allowed roots', () => {
    const outsideRepo = createTempGitRepo('gitscope-outside-');
    try {
      expect(() => validateRepositoryPath(outsideRepo.dir, allowedRoots)).toThrow(
        /outside the configured allowed repository roots/,
      );
    } finally {
      outsideRepo.cleanup();
    }
  });

  it('prevents path traversal outside allowed roots', () => {
    const repoInside = path.join(rootDir, 'inner-repo');
    fs.mkdirSync(repoInside, { recursive: true });
    fs.mkdirSync(path.join(repoInside, '.git'));

    // Attempt traversal ../
    const traversalPath = path.join(rootDir, 'inner-repo', '..', '..');
    expect(() => validateRepositoryPath(traversalPath, [repoInside])).toThrow(
      /outside the configured allowed repository roots/,
    );
  });

  it('rejects directories that are not Git repositories', () => {
    const nonGitDir = path.join(rootDir, 'not-a-repo');
    fs.mkdirSync(nonGitDir, { recursive: true });

    expect(() => validateRepositoryPath(nonGitDir, allowedRoots)).toThrow(
      /is not a Git repository/,
    );
  });

  it('validates and returns canonical path and name for a valid Git repository', () => {
    const validRepoDir = path.join(rootDir, 'my-test-repo');
    fs.mkdirSync(validRepoDir, { recursive: true });
    fs.mkdirSync(path.join(validRepoDir, '.git'));

    const result = validateRepositoryPath(validRepoDir, allowedRoots);
    expect(result.name).toBe('my-test-repo');
    expect(result.canonicalPath.toLowerCase()).toBe(
      (fs.realpathSync.native
        ? fs.realpathSync.native(validRepoDir)
        : fs.realpathSync(validRepoDir)
      ).toLowerCase(),
    );
  });
});
