import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateRepositoryPath,
  PathValidationError,
  findWorkspaceRoot,
} from '../../git/path-validator.js';
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

  describe('Workspace Root & Relative Resolution', () => {
    it('detects monorepo workspace root from cwd and nested subdirectories', () => {
      const detectedFromRoot = findWorkspaceRoot(process.cwd());
      expect(fs.existsSync(path.join(detectedFromRoot, 'pnpm-workspace.yaml'))).toBe(true);

      const nestedSubdir = path.join(detectedFromRoot, 'apps', 'api');
      const detectedFromNested = findWorkspaceRoot(nestedSubdir);
      expect(detectedFromNested.toLowerCase()).toBe(detectedFromRoot.toLowerCase());
    });

    it('resolves relative repository path and allowed roots against explicit baseDir', () => {
      const fixtureSubdir = path.join(rootDir, 'sample-repos');
      const repoSubdir = path.join(fixtureSubdir, 'demo-sub');
      fs.mkdirSync(repoSubdir, { recursive: true });
      fs.mkdirSync(path.join(repoSubdir, '.git'));

      // Validate using relative paths with rootDir as baseDir
      const result = validateRepositoryPath('./sample-repos/demo-sub', ['./sample-repos'], rootDir);
      expect(result.name).toBe('demo-sub');
      expect(result.canonicalPath.toLowerCase()).toBe(
        (fs.realpathSync.native
          ? fs.realpathSync.native(repoSubdir)
          : fs.realpathSync(repoSubdir)
        ).toLowerCase(),
      );
    });

    it('rejects relative path traversal attempting to escape baseDir', () => {
      const fixtureSubdir = path.join(rootDir, 'allowed-boundary');
      fs.mkdirSync(fixtureSubdir, { recursive: true });

      const outsideRepo = path.join(rootDir, 'escaped-repo');
      fs.mkdirSync(outsideRepo, { recursive: true });
      fs.mkdirSync(path.join(outsideRepo, '.git'));

      // Relative path trying to traverse up and out
      expect(() =>
        validateRepositoryPath(
          './allowed-boundary/../escaped-repo',
          ['./allowed-boundary'],
          rootDir,
        ),
      ).toThrow(/outside the configured allowed repository roots/);
    });

    it('honors valid explicit GITSCOPE_WORKSPACE_ROOT override', () => {
      const originalEnv = process.env.GITSCOPE_WORKSPACE_ROOT;
      try {
        process.env.GITSCOPE_WORKSPACE_ROOT = rootDir;
        expect(findWorkspaceRoot()).toBe(path.resolve(rootDir));
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITSCOPE_WORKSPACE_ROOT = originalEnv;
        } else {
          delete process.env.GITSCOPE_WORKSPACE_ROOT;
        }
      }
    });

    it('handles nonexistent GITSCOPE_WORKSPACE_ROOT by causing relative lookup to fail with PATH_NOT_FOUND', () => {
      const originalEnv = process.env.GITSCOPE_WORKSPACE_ROOT;
      try {
        process.env.GITSCOPE_WORKSPACE_ROOT = path.join(rootDir, 'nonexistent-workspace-root');
        expect(() => validateRepositoryPath('./sample-repos', [rootDir])).toThrow(
          /does not exist or is inaccessible/,
        );
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITSCOPE_WORKSPACE_ROOT = originalEnv;
        } else {
          delete process.env.GITSCOPE_WORKSPACE_ROOT;
        }
      }
    });

    it('ignores whitespace-only GITSCOPE_WORKSPACE_ROOT and discovers monorepo root', () => {
      const originalEnv = process.env.GITSCOPE_WORKSPACE_ROOT;
      try {
        process.env.GITSCOPE_WORKSPACE_ROOT = '   ';
        const detected = findWorkspaceRoot(process.cwd());
        expect(fs.existsSync(path.join(detected, 'pnpm-workspace.yaml'))).toBe(true);
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITSCOPE_WORKSPACE_ROOT = originalEnv;
        } else {
          delete process.env.GITSCOPE_WORKSPACE_ROOT;
        }
      }
    });

    it('falls back to startDir for standalone deployments without workspace markers', () => {
      const standaloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscope-standalone-'));
      try {
        const detected = findWorkspaceRoot(standaloneDir);
        expect(detected.toLowerCase()).toBe(path.resolve(standaloneDir).toLowerCase());
      } finally {
        fs.rmSync(standaloneDir, { recursive: true, force: true });
      }
    });

    it('preserves absolute paths without modifying them with baseDir', () => {
      const validRepoDir = path.join(rootDir, 'my-test-repo');
      const result = validateRepositoryPath(validRepoDir, allowedRoots, 'C:\\some\\other\\base');
      expect(result.canonicalPath.toLowerCase()).toBe(
        (fs.realpathSync.native
          ? fs.realpathSync.native(validRepoDir)
          : fs.realpathSync(validRepoDir)
        ).toLowerCase(),
      );
    });
  });
});
