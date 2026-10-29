import { describe, it, expect } from 'vitest';
import { parseGitRefs, parseGitLog, normalizeChangeType } from '../../git/parser.js';

describe('Git Parser', () => {
  it('normalizes change types accurately', () => {
    expect(normalizeChangeType('A')).toBe('added');
    expect(normalizeChangeType('M')).toBe('modified');
    expect(normalizeChangeType('D')).toBe('deleted');
    expect(normalizeChangeType('R100')).toBe('renamed');
    expect(normalizeChangeType('C095')).toBe('copied');
    expect(normalizeChangeType('T')).toBe('type_changed');
    expect(normalizeChangeType('X')).toBe('unknown');
  });

  it('parses Git references correctly', () => {
    const rawRefs = [
      'refs/heads/main\t1111111111111111111111111111111111111111\t',
      'refs/heads/feature/login\t2222222222222222222222222222222222222222\t',
      'refs/tags/v1.0.0\t9999999999999999999999999999999999999999\t3333333333333333333333333333333333333333',
      'refs/remotes/origin/main\t4444444444444444444444444444444444444444\t',
      'refs/remotes/origin/HEAD\t4444444444444444444444444444444444444444\t',
    ].join('\n');

    const parsed = parseGitRefs(rawRefs);
    expect(parsed).toEqual([
      {
        name: 'main',
        refType: 'branch',
        targetHash: '1111111111111111111111111111111111111111',
        isRemote: false,
      },
      {
        name: 'feature/login',
        refType: 'branch',
        targetHash: '2222222222222222222222222222222222222222',
        isRemote: false,
      },
      {
        name: 'v1.0.0',
        refType: 'tag',
        targetHash: '3333333333333333333333333333333333333333',
        isRemote: false,
      },
      {
        name: 'origin/main',
        refType: 'branch',
        targetHash: '4444444444444444444444444444444444444444',
        isRemote: true,
      },
    ]);
  });

  it('returns empty array for empty git log output', () => {
    expect(parseGitLog('')).toEqual([]);
    expect(parseGitLog('   ')).toEqual([]);
  });

  it('parses commit metadata, parent hashes, and diffs with NUL tokens', () => {
    const rawCommit = [
      '\x1e',
      '1234567890123456789012345678901234567890', // hash
      '\x1f',
      'parent1parent1parent1parent1parent1parent1 parent2parent2parent2parent2parent2parent2', // parents
      '\x1f',
      'Alice Dev', // authorName
      '\x1f',
      'alice@example.com', // authorEmail
      '\x1f',
      '2026-10-29T10:00:00.000Z', // authorTime
      '\x1f',
      'Bob Reviewer', // committerName
      '\x1f',
      'bob@example.com', // committerEmail
      '\x1f',
      '2026-10-29T10:05:00.000Z', // committerTime
      '\x1f',
      'Merge pull request #1 into main', // subject
      '\x1f',
      'Detailed merge explanation\nSecond line of body', // body
      '\x1e',
      '\0\n',
      ':100644 100644 1111111 2222222 M\0src/index.ts\0',
      ':100644 100644 3333333 4444444 R100\0old-file.txt\0new-file.txt\0',
      ':000000 100644 0000000 5555555 A\0assets/logo 🚀.png\0',
      '10\t2\tsrc/index.ts\0',
      '0\t0\t\0old-file.txt\0new-file.txt\0',
      '-\t-\tassets/logo 🚀.png\0',
    ].join('');

    const commits = parseGitLog(rawCommit);
    expect(commits).toHaveLength(1);

    const c = commits[0]!;
    expect(c.hash).toBe('1234567890123456789012345678901234567890');
    expect(c.parentHashes).toEqual([
      'parent1parent1parent1parent1parent1parent1',
      'parent2parent2parent2parent2parent2parent2',
    ]);
    expect(c.authorName).toBe('Alice Dev');
    expect(c.authorEmail).toBe('alice@example.com');
    expect(c.authorTime).toBe('2026-10-29T10:00:00.000Z');
    expect(c.subject).toBe('Merge pull request #1 into main');
    expect(c.body).toBe('Detailed merge explanation\nSecond line of body');

    expect(c.fileChanges).toEqual([
      {
        path: 'src/index.ts',
        oldPath: null,
        changeType: 'modified',
        additions: 10,
        deletions: 2,
        isBinary: false,
      },
      {
        path: 'new-file.txt',
        oldPath: 'old-file.txt',
        changeType: 'renamed',
        additions: 0,
        deletions: 0,
        isBinary: false,
      },
      {
        path: 'assets/logo 🚀.png',
        oldPath: null,
        changeType: 'added',
        additions: null,
        deletions: null,
        isBinary: true,
      },
    ]);
  });
});
