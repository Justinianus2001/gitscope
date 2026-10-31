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
 * Deterministically locates the workspace/monorepo root directory.
 * Searches upward from startDir (defaulting to process.cwd()) for workspace markers
 * ('pnpm-workspace.yaml' or root 'package.json' with name 'gitscope-monorepo').
 * If no workspace marker is found (e.g. standalone deployment or isolated test),
 * returns path.resolve(startDir).
 */
export function findWorkspaceRoot(startDir: string = process.cwd()): string {
  if (
    process.env.GITSCOPE_WORKSPACE_ROOT &&
    process.env.GITSCOPE_WORKSPACE_ROOT.trim().length > 0
  ) {
    return path.resolve(process.env.GITSCOPE_WORKSPACE_ROOT.trim());
  }

  const searchFrom = (dir: string): string | null => {
    let current = path.resolve(dir);
    while (true) {
      if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
        return current;
      }
      const pkgPath = path.join(current, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkg.name === 'gitscope-monorepo') {
            return current;
          }
        } catch {
          // ignore error
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  };

  const fromStart = searchFrom(startDir);
  if (fromStart) return fromStart;

  return path.resolve(startDir);
}

/**
 * Validates and canonicalizes a repository path against allowed roots.
 * Defends against path traversal, symlink escapes, and arbitrary directory access.
 * Relative paths are deterministically resolved against baseDir (defaulting to workspace root).
 */
export function validateRepositoryPath(
  inputPath: string,
  allowedRoots: string[],
  baseDir?: string,
): ValidatedPath {
  if (!inputPath || typeof inputPath !== 'string' || inputPath.trim().length === 0) {
    throw new PathValidationError('INVALID_INPUT', 'Repository path must not be empty.');
  }

  const resolutionBase = baseDir ? path.resolve(baseDir) : findWorkspaceRoot();
  const trimmedPath = inputPath.trim();
  const absoluteResolvedPath = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(resolutionBase, trimmedPath);

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
      const trimmed = root.trim();
      const absRoot = path.isAbsolute(trimmed)
        ? path.resolve(trimmed)
        : path.resolve(resolutionBase, trimmed);
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
