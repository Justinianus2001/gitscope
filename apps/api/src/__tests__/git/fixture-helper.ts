import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TestGitRepo {
  dir: string;
  run: (args: string[]) => string;
  commitFile: (relativePath: string, content: string | Buffer, message: string) => string;
  renameFile: (oldPath: string, newPath: string, message: string) => string;
  deleteFile: (relativePath: string, message: string) => string;
  createBranch: (branchName: string) => void;
  checkoutBranch: (branchName: string) => void;
  mergeBranch: (branchName: string, message: string) => string;
  createTag: (tagName: string) => void;
  cleanup: () => void;
}

export function createTempGitRepo(prefix = 'gitscope-test-'): TestGitRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  const run = (args: string[]): string => {
    return execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
      },
    });
  };

  run(['init']);
  run(['config', 'user.name', 'GitScope Tester']);
  run(['config', 'user.email', 'test@gitscope.local']);
  run(['config', 'core.quotepath', 'false']);

  const commitFile = (relativePath: string, content: string | Buffer, message: string): string => {
    const fullPath = path.join(dir, relativePath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
    run(['add', relativePath]);
    run(['commit', '-m', message]);
    return run(['rev-parse', 'HEAD']).trim();
  };

  const renameFile = (oldPath: string, newPath: string, message: string): string => {
    run(['mv', oldPath, newPath]);
    run(['commit', '-m', message]);
    return run(['rev-parse', 'HEAD']).trim();
  };

  const deleteFile = (relativePath: string, message: string): string => {
    run(['rm', relativePath]);
    run(['commit', '-m', message]);
    return run(['rev-parse', 'HEAD']).trim();
  };

  const createBranch = (branchName: string): void => {
    run(['branch', branchName]);
  };

  const checkoutBranch = (branchName: string): void => {
    run(['checkout', branchName]);
  };

  const mergeBranch = (branchName: string, message: string): string => {
    run(['merge', '--no-ff', branchName, '-m', message]);
    return run(['rev-parse', 'HEAD']).trim();
  };

  const createTag = (tagName: string): void => {
    run(['tag', tagName]);
  };

  const cleanup = (): void => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on busy Windows handles
    }
  };

  return {
    dir,
    run,
    commitFile,
    renameFile,
    deleteFile,
    createBranch,
    checkoutBranch,
    mergeBranch,
    createTag,
    cleanup,
  };
}
