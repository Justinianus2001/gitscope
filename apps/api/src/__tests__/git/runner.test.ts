import { describe, it, expect } from 'vitest';
import { runGit, GitRunnerError } from '../../git/runner.js';
import { createTempGitRepo } from './fixture-helper.js';

describe('Git Runner', () => {
  it('executes Git commands and returns output', async () => {
    const repo = createTempGitRepo();
    try {
      const result = await runGit(['status'], { cwd: repo.dir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('On branch');
    } finally {
      repo.cleanup();
    }
  });

  it('handles Git command failures and returns sanitized errors', async () => {
    const repo = createTempGitRepo();
    try {
      await expect(runGit(['log'], { cwd: repo.dir })).rejects.toThrow(GitRunnerError);
    } finally {
      repo.cleanup();
    }
  });

  it('enforces command execution timeout', async () => {
    const repo = createTempGitRepo();
    try {
      // Set an impossible 1ms timeout
      await expect(runGit(['log', '--all'], { cwd: repo.dir, timeoutMs: 1 })).rejects.toThrow(
        /timed out/,
      );
    } finally {
      repo.cleanup();
    }
  });

  it('supports cancellation via AbortController', async () => {
    const repo = createTempGitRepo();
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(
        runGit(['status'], { cwd: repo.dir, signal: controller.signal }),
      ).rejects.toThrow(/cancelled/);
    } finally {
      repo.cleanup();
    }
  });
});
