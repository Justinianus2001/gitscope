import fs from 'node:fs';
import path from 'node:path';

export class PathValidationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'PATH_NOT_FOUND'
      | 'PATH_NOT_DIRECTORY'
      | 'PATH_NOT_ALLOWED'
      | 'NOT_A_GIT_REPOSITORY',
    message: string,
  ) {
    super(message);
    this.name = 'PathValidationError';
  }
}

export interface ValidatedPath {
  canonicalPath: string;
  name: string;
}

/**
 * Validates and canonicalizes a repository path against allowed roots.
 * Defends against path traversal, symlink escapes, and arbitrary directory access.
 */
export function validateRepositoryPath(inputPath: string, allowedRoots: string[]): ValidatedPath {
  if (!inputPath || typeof inputPath !== 'string' || inputPath.trim().length === 0) {
    throw new PathValidationError('INVALID_INPUT', 'Repository path must not be empty.');
  }

  const trimmedPath = inputPath.trim();
  const absoluteResolvedPath = path.resolve(trimmedPath);

  // Check existence and resolve symlinks to true canonical path
  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync.native
      ? fs.realpathSync.native(absoluteResolvedPath)
      : fs.realpathSync(absoluteResolvedPath);
  } catch {
    throw new PathValidationError(
      'PATH_NOT_FOUND',
      'The specified repository path does not exist or is inaccessible.',
    );
  }

  // Ensure target is a directory
  const stat = fs.statSync(canonicalPath);
  if (!stat.isDirectory()) {
    throw new PathValidationError(
      'PATH_NOT_DIRECTORY',
      'The specified repository path is not a directory.',
    );
  }

  // Canonicalize allowed roots
  const canonicalAllowedRoots = allowedRoots
    .map((root) => {
      const absRoot = path.resolve(root.trim());
      try {
        return fs.realpathSync.native ? fs.realpathSync.native(absRoot) : fs.realpathSync(absRoot);
      } catch {
        // If the allowed root directory doesn't exist on disk yet, return normalized absolute path
        return absRoot;
      }
    })
    .filter(Boolean);

  if (canonicalAllowedRoots.length === 0) {
    throw new PathValidationError(
      'PATH_NOT_ALLOWED',
      'No allowed repository roots are configured on the server.',
    );
  }

  // Check that canonicalPath is within at least one canonical allowed root
  const isAllowed = canonicalAllowedRoots.some((allowedRoot) => {
    // Exact match or subdirectory
    const normalizedTarget = canonicalPath.toLowerCase();
    const normalizedRoot = allowedRoot.toLowerCase();

    return (
      normalizedTarget === normalizedRoot ||
      normalizedTarget.startsWith(
        normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep,
      )
    );
  });

  if (!isAllowed) {
    throw new PathValidationError(
      'PATH_NOT_ALLOWED',
      'The specified path is outside the configured allowed repository roots.',
    );
  }

  // Check if directory is a valid Git repository
  const gitDir = path.join(canonicalPath, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new PathValidationError(
      'NOT_A_GIT_REPOSITORY',
      'The specified directory is not a Git repository (missing .git).',
    );
  }

  const name = path.basename(canonicalPath);

  return {
    canonicalPath,
    name,
  };
}
