import type { ChangeType, RefType } from '@gitscope/shared';

export interface GitRunOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ParsedFileChange {
  path: string;
  oldPath: string | null;
  changeType: ChangeType;
  additions: number | null;
  deletions: number | null;
  isBinary: boolean | null;
}

export interface ParsedCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  authorTime: string;
  committerName: string;
  committerEmail: string;
  committerTime: string;
  subject: string;
  body: string | null;
  parentHashes: string[];
  fileChanges: ParsedFileChange[];
}

export interface ParsedRef {
  name: string;
  refType: RefType;
  targetHash: string;
  isRemote: boolean;
}
