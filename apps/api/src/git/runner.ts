import { execFile } from 'node:child_process';
import type { GitRunOptions, GitRunResult } from './types.js';

export class GitRunnerError extends Error {
  constructor(
    public readonly code:
      'GIT_TIMEOUT' | 'GIT_BUFFER_OVERFLOW' | 'GIT_CANCELLED' | 'GIT_COMMAND_FAILED',
    message: string,
    public readonly exitCode: number | null = null,
    public readonly stderr: string = '',
  ) {
    super(message);
    this.name = 'GitRunnerError';
  }
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024; // 50MB

/**
 * Executes a Git command safely via execFile using explicit argument arrays.
 * Never invokes a shell, enforces execution timeouts, output limits, and signal cancellation.
 */
export function runGit(args: string[], options: GitRunOptions): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBuffer = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    // Enforce safe, headless, non-interactive environment
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    };

    execFile(
      'git',
      args,
      {
        cwd: options.cwd,
        timeout: timeoutMs,
        maxBuffer,
        encoding: 'utf-8',
        env,
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          // Check for timeout
          if (error.killed && (error as unknown as { signal?: string }).signal === 'SIGTERM') {
            return reject(
              new GitRunnerError(
                'GIT_TIMEOUT',
                `Git command timed out after ${timeoutMs}ms.`,
                null,
                stderr.toString().trim(),
              ),
            );
          }

          // Check for buffer overflow
          if (
            error.message.includes('maxBuffer') ||
            error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          ) {
            return reject(
              new GitRunnerError(
                'GIT_BUFFER_OVERFLOW',
                `Git output exceeded limit of ${maxBuffer} bytes.`,
                null,
                stderr.toString().trim(),
              ),
            );
          }

          // Check for abort / cancellation
          if (options.signal?.aborted || error.name === 'AbortError') {
            return reject(
              new GitRunnerError(
                'GIT_CANCELLED',
                'Git operation was cancelled.',
                null,
                stderr.toString().trim(),
              ),
            );
          }

          const exitCode = typeof error.code === 'number' ? error.code : 1;
          const sanitizedStderr = stderr
            .toString()
            .trim()
            .replace(/([a-zA-Z0-9_\-.]+:)[^\s@]+@/g, '$1***@');

          return reject(
            new GitRunnerError(
              'GIT_COMMAND_FAILED',
              `Git command failed (exit code ${exitCode}): ${sanitizedStderr || error.message}`,
              exitCode,
              sanitizedStderr,
            ),
          );
        }

        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString().trim(),
          exitCode: 0,
        });
      },
    );
  });
}
