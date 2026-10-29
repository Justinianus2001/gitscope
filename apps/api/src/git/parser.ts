import type { ChangeType } from '@gitscope/shared';
import type { ParsedCommit, ParsedFileChange, ParsedRef } from './types.js';

export const COMMIT_RECORD_SEPARATOR = '\x1e';
export const COMMIT_FIELD_SEPARATOR = '\x1f';

/**
 * Normalizes Git raw status characters (A, M, D, R100, C100, T, etc.) to domain ChangeType.
 */
export function normalizeChangeType(statusChar: string): ChangeType {
  const code = statusChar.trim().toUpperCase()[0];
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type_changed';
    default:
      return 'unknown';
  }
}

/**
 * Parses Git for-each-ref output into structured branch and tag references.
 * Expected input format per line: "%(refname)\t%(objectname)\t%(*objectname)"
 */
export function parseGitRefs(rawOutput: string): ParsedRef[] {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return [];
  }

  const lines = rawOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const refs: ParsedRef[] = [];

  for (const line of lines) {
    const parts = line.split('\t');
    const refname = parts[0]?.trim();
    const objectHash = parts[1]?.trim();
    const peeledHash = parts[2]?.trim();

    // Prefer dereferenced commit hash for annotated tags (%*objectname)
    const targetHash = peeledHash && peeledHash.length === 40 ? peeledHash : objectHash;

    if (!refname || !targetHash || targetHash.length !== 40) {
      continue;
    }

    if (refname.startsWith('refs/heads/')) {
      refs.push({
        name: refname.replace('refs/heads/', ''),
        refType: 'branch',
        targetHash,
        isRemote: false,
      });
    } else if (refname.startsWith('refs/remotes/')) {
      const remoteName = refname.replace('refs/remotes/', '');
      // Exclude HEAD pointers like 'origin/HEAD'
      if (!remoteName.endsWith('/HEAD')) {
        refs.push({
          name: remoteName,
          refType: 'branch',
          targetHash,
          isRemote: true,
        });
      }
    } else if (refname.startsWith('refs/tags/')) {
      refs.push({
        name: refname.replace('refs/tags/', ''),
        refType: 'tag',
        targetHash,
        isRemote: false,
      });
    }
  }

  return refs;
}

interface RawFileEntry {
  path: string;
  oldPath: string | null;
  changeType: ChangeType;
}

interface NumstatFileEntry {
  path: string;
  additions: number | null;
  deletions: number | null;
  isBinary: boolean;
}

/**
 * Parses the diff portion (NUL-separated raw and numstat tokens) of a single commit.
 */
function parseCommitDiff(diffBuffer: string): ParsedFileChange[] {
  if (!diffBuffer || diffBuffer.length === 0) {
    return [];
  }

  // Tokens are separated by NUL \0
  const tokens = diffBuffer.split('\0');
  const rawEntries: RawFileEntry[] = [];
  const numstatEntries = new Map<string, NumstatFileEntry>();

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) {
      break;
    }

    const trimmed = token.replace(/^[\r\n]+/, '');

    // Check if it's a --raw descriptor line: starts with colon ":"
    if (trimmed.startsWith(':')) {
      // Format: :src_mode dst_mode src_sha dst_sha status
      const parts = trimmed.trim().split(/\s+/);
      const statusToken = parts[parts.length - 1] ?? 'M';
      const changeType = normalizeChangeType(statusToken);

      if (statusToken.startsWith('R') || statusToken.startsWith('C')) {
        // Renamed/copied has two path tokens: oldPath and newPath
        const oldPath = tokens[i + 1] ?? '';
        const newPath = tokens[i + 2] ?? '';
        rawEntries.push({
          path: newPath,
          oldPath,
          changeType,
        });
        i += 3;
      } else {
        const filePath = tokens[i + 1] ?? '';
        rawEntries.push({
          path: filePath,
          oldPath: null,
          changeType,
        });
        i += 2;
      }
      continue;
    }

    // Check if it's a --numstat line: "<additions>\t<deletions>\t"
    const tabParts = trimmed.split('\t');
    if (
      tabParts.length >= 2 &&
      /^-|\d+$/.test(tabParts[0] ?? '') &&
      /^-|\d+$/.test(tabParts[1] ?? '')
    ) {
      const addStr = tabParts[0] ?? '-';
      const delStr = tabParts[1] ?? '-';
      const isBinary = addStr === '-' || delStr === '-';
      const additions = isBinary ? null : Number.parseInt(addStr, 10);
      const deletions = isBinary ? null : Number.parseInt(delStr, 10);

      const pathPart = tabParts.slice(2).join('\t');
      if (pathPart.length === 0) {
        // In -z numstat, rename paths follow in next tokens: oldPath \0 newPath
        const newPath = tokens[i + 2] ?? '';
        numstatEntries.set(newPath, {
          path: newPath,
          additions,
          deletions,
          isBinary,
        });
        i += 3;
      } else {
        numstatEntries.set(pathPart, {
          path: pathPart,
          additions,
          deletions,
          isBinary,
        });
        i += 1;
      }
      continue;
    }

    // Unrecognized or whitespace/empty delimiter token
    i += 1;
  }

  // Combine raw entries with numstat statistics
  const results: ParsedFileChange[] = [];
  const processedPaths = new Set<string>();

  for (const raw of rawEntries) {
    if (!raw.path) continue;
    processedPaths.add(raw.path);

    const numstat = numstatEntries.get(raw.path);
    results.push({
      path: raw.path,
      oldPath: raw.oldPath,
      changeType: raw.changeType,
      additions: numstat?.additions ?? null,
      deletions: numstat?.deletions ?? null,
      isBinary: numstat?.isBinary ?? null,
    });
  }

  // If any numstat entry was not in raw (fallback), add it
  for (const [path, numstat] of numstatEntries.entries()) {
    if (!processedPaths.has(path) && path.length > 0) {
      results.push({
        path,
        oldPath: null,
        changeType: 'modified',
        additions: numstat.additions,
        deletions: numstat.deletions,
        isBinary: numstat.isBinary,
      });
    }
  }

  return results;
}

/**
 * Parses Git log output with structured record and field separators into ParsedCommit array.
 */
export function parseGitLog(rawOutput: string): ParsedCommit[] {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return [];
  }

  // Each commit starts with RECORD_SEPARATOR
  const chunks = rawOutput.split(COMMIT_RECORD_SEPARATOR);
  const commits: ParsedCommit[] = [];

  for (let i = 1; i < chunks.length; i += 2) {
    const headerChunk = chunks[i];
    const diffChunk = chunks[i + 1] ?? '';

    if (!headerChunk) continue;

    // Header fields separated by FIELD_SEPARATOR
    const fields = headerChunk.split(COMMIT_FIELD_SEPARATOR);
    if (fields.length < 10) {
      continue;
    }

    const hash = fields[0]?.trim() ?? '';
    const parentHashesStr = fields[1]?.trim() ?? '';
    const authorName = fields[2] ?? '';
    const authorEmail = fields[3] ?? '';
    const authorTime = fields[4]?.trim() ?? '';
    const committerName = fields[5] ?? '';
    const committerEmail = fields[6] ?? '';
    const committerTime = fields[7]?.trim() ?? '';
    const subject = fields[8] ?? '';
    const bodyRaw = fields[9] ?? '';

    if (!hash || hash.length !== 40) {
      continue;
    }

    const parentHashes =
      parentHashesStr.length > 0 ? parentHashesStr.split(/\s+/).filter(Boolean) : [];
    const body = bodyRaw.trim().length > 0 ? bodyRaw.trim() : null;

    const fileChanges = parseCommitDiff(diffChunk);

    commits.push({
      hash,
      authorName,
      authorEmail,
      authorTime,
      committerName,
      committerEmail,
      committerTime,
      subject,
      body,
      parentHashes,
      fileChanges,
    });
  }

  return commits;
}
