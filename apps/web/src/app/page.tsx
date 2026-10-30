'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { RepositoryListItem } from '@gitscope/shared';
import {
  FolderGit2,
  Plus,
  RotateCw,
  GitCommit,
  GitBranch,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { InlineNotification } from '@/components/ui/inline-notification';

export default function RepositoriesPage() {
  const [repos, setRepos] = useState<RepositoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Global action notification
  const [actionNotification, setActionNotification] = useState<{
    type: 'error' | 'warning' | 'info' | 'success';
    title?: string;
    message: string;
  } | null>(null);

  // Registration form state
  const [pathInput, setPathInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Triggering analysis state
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());

  // Determine if any analysis is currently in progress
  const hasActiveAnalysis = useMemo(() => {
    return (
      analyzingIds.size > 0 ||
      repos.some((repo) => repo.analysisStatus === 'running' || repo.analysisStatus === 'queued')
    );
  }, [repos, analyzingIds]);

  const loadRepositories = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getRepositories();
      setRepos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to API service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRepositories();
  }, [loadRepositories]);

  // Status polling for active background analysis runs
  useEffect(() => {
    if (!hasActiveAnalysis) return;

    let active = true;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    const interval = setInterval(async () => {
      try {
        const data = await api.getRepositories();
        if (active) {
          consecutiveErrors = 0;
          setRepos(data);
          setAnalyzingIds((prev) => {
            if (prev.size === 0) return prev;
            const next = new Set(prev);
            for (const repo of data) {
              if (
                repo.analysisStatus === 'completed' ||
                repo.analysisStatus === 'failed' ||
                repo.analysisStatus === 'running'
              ) {
                next.delete(repo.id);
              }
            }
            return next;
          });
        }
      } catch (err) {
        consecutiveErrors++;
        console.warn(
          `Repository status polling error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
          err,
        );
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          clearInterval(interval);
          if (active) {
            setActionNotification({
              type: 'warning',
              title: 'Auto-Refresh Paused',
              message:
                'Multiple consecutive status checks failed. Please verify your connection to the API server.',
            });
          }
        }
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [hasActiveAnalysis]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!pathInput.trim()) return;

    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const res = await api.createRepository(pathInput.trim());
      setPathInput('');
      setFormSuccess(
        res.isExisting
          ? `Repository "${res.data.name}" is already registered.`
          : `Successfully registered "${res.data.name}".`,
      );
      await loadRepositories();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to register repository.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAnalyze(id: string) {
    setAnalyzingIds((prev) => new Set(prev).add(id));
    setActionNotification(null);
    try {
      await api.analyzeRepository(id);
      await loadRepositories();
    } catch (err) {
      setActionNotification({
        type: 'error',
        title: 'Analysis Failed',
        message: err instanceof Error ? err.message : 'Failed to start analysis.',
      });
    } finally {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Repositories</h1>
          <p className="text-sm text-neutral-400">
            Local Git repositories registered for history analysis and visualization.
          </p>
        </div>
      </div>

      {/* Action Notification (replaces browser alerts) */}
      {actionNotification && (
        <InlineNotification
          type={actionNotification.type}
          title={actionNotification.title}
          message={actionNotification.message}
          onDismiss={() => setActionNotification(null)}
        />
      )}

      {/* Registration Card */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-white">Register a Local Repository</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Enter an absolute or relative directory path within your configured{' '}
          <code className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-300">
            ALLOWED_REPOSITORY_ROOTS
          </code>
          .
        </p>

        <form onSubmit={handleRegister} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            placeholder="e.g. ./sample-repositories/my-project"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            disabled={submitting}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={submitting || !pathInput.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 transition-colors"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span>Register</span>
          </button>
        </form>

        {formError && (
          <div className="mt-3 flex items-center gap-2 text-xs text-rose-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {formSuccess && (
          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{formSuccess}</span>
          </div>
        )}
      </div>

      {/* Main Content: Repositories List or Empty State */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
          <h3 className="mt-2 text-sm font-semibold text-rose-200">Connection Error</h3>
          <p className="mt-1 text-xs text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              loadRepositories();
            }}
            className="mt-4 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            Retry Connection
          </button>
        </div>
      ) : repos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-800 p-12 text-center">
          <FolderGit2 className="mx-auto h-12 w-12 text-neutral-600" />
          <h3 className="mt-4 text-base font-medium text-white">No repositories registered</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-400">
            Register your first local Git repository using the form above to start exploring commit
            history and file hotspots.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {repos.map((repo) => {
            const isAnalyzing =
              analyzingIds.has(repo.id) ||
              repo.analysisStatus === 'running' ||
              repo.analysisStatus === 'queued';

            return (
              <div
                key={repo.id}
                className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 hover:border-neutral-700 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/repositories/${repo.id}`}
                      className="text-base font-semibold text-white hover:text-blue-400 transition-colors line-clamp-1"
                    >
                      {repo.name}
                    </Link>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        repo.analysisStatus === 'completed'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : repo.analysisStatus === 'running' || repo.analysisStatus === 'queued'
                            ? 'bg-blue-950 text-blue-400 border border-blue-800'
                            : repo.analysisStatus === 'failed'
                              ? 'bg-rose-950 text-rose-400 border border-rose-800'
                              : 'bg-neutral-800 text-neutral-400'
                      }`}
                    >
                      {repo.analysisStatus === 'running' && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      <span>{repo.analysisStatus || 'Unanalyzed'}</span>
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-xs text-neutral-400">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-3.5 w-3.5 text-neutral-500" />
                      <span>{repo.defaultBranch || 'Default branch not detected'}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <GitCommit className="h-3.5 w-3.5 text-neutral-500" />
                      <span>
                        {repo.commitsProcessed
                          ? `${repo.commitsProcessed.toLocaleString()} commits indexed`
                          : 'No commits indexed'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 text-neutral-500" />
                      <span>
                        {repo.lastAnalyzedAt
                          ? `Analyzed ${new Date(repo.lastAnalyzedAt).toLocaleDateString()}`
                          : 'Never analyzed'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-neutral-800/80 pt-4">
                  <Link
                    href={`/repositories/${repo.id}?view=commits`}
                    className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Explore Commits &rarr;
                  </Link>

                  <button
                    type="button"
                    onClick={() => handleAnalyze(repo.id)}
                    disabled={isAnalyzing}
                    className="inline-flex items-center gap-1.5 rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCw className="h-3 w-3" />
                    )}
                    <span>{repo.lastAnalyzedAt ? 'Re-analyze' : 'Analyze'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
