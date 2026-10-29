'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type {
  RepositoryListItem,
  CommitItem,
  CommitDetail,
  GetCommitsQuery,
} from '@gitscope/shared';
import {
  ArrowLeft,
  RotateCw,
  GitCommit,
  GitBranch,
  GitMerge,
  Search,
  Calendar,
  FileCode,
  Tag,
  X,
  Plus,
  Minus,
  FileDiff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';

export default function RepositoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: repoId } = use(params);

  const [repo, setRepo] = useState<RepositoryListItem | null>(null);
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Analysis status polling
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);

  // Filter state
  const [authorFilter, setAuthorFilter] = useState('');
  const [pathFilter, setPathFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  // Commit Detail Modal state
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch repository metadata
  const loadRepo = useCallback(async () => {
    try {
      const data = await api.getRepository(repoId);
      setRepo(data);
      if (data.analysisStatus === 'running' || data.analysisStatus === 'queued') {
        setIsAnalyzing(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repository.');
    }
  }, [repoId]);

  // Fetch commits
  const loadCommits = useCallback(
    async (reset = true, cursor?: string) => {
      try {
        if (reset) setLoading(true);
        else setLoadingMore(true);

        const query: GetCommitsQuery = {
          limit: 25,
          cursor,
          author: authorFilter.trim() || undefined,
          path: pathFilter.trim() || undefined,
          from: fromFilter ? new Date(fromFilter).toISOString() : undefined,
          to: toFilter ? new Date(toFilter).toISOString() : undefined,
        };

        const res = await api.getCommits(repoId, query);
        if (reset) {
          setCommits(res.data);
        } else {
          setCommits((prev) => [...prev, ...res.data]);
        }
        setNextCursor(res.page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load commits.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [repoId, authorFilter, pathFilter, fromFilter, toFilter],
  );

  useEffect(() => {
    loadRepo();
    loadCommits(true);
  }, [loadRepo, loadCommits]);

  // Polling for analysis progress when running
  useEffect(() => {
    if (!isAnalyzing) return;

    const interval = setInterval(async () => {
      try {
        const status = await api.getAnalysisStatus(repoId);
        if (!status) return;

        setAnalysisProgress(status.commitsProcessed);
        if (status.status === 'completed') {
          setIsAnalyzing(false);
          await loadRepo();
          await loadCommits(true);
        } else if (status.status === 'failed' || status.status === 'cancelled') {
          setIsAnalyzing(false);
          await loadRepo();
        }
      } catch {
        // Ignore polling error
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isAnalyzing, repoId, loadRepo, loadCommits]);

  // Trigger analysis
  async function handleTriggerAnalysis() {
    setIsAnalyzing(true);
    try {
      await api.analyzeRepository(repoId);
    } catch (err) {
      setIsAnalyzing(false);
      alert(err instanceof Error ? err.message : 'Failed to start analysis.');
    }
  }

  // Open Commit Detail
  async function handleSelectCommit(hash: string) {
    setSelectedCommitHash(hash);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await api.getCommitDetail(repoId, hash);
      setCommitDetail(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to fetch commit details.');
    } finally {
      setDetailLoading(false);
    }
  }

  function handleClearFilters() {
    setAuthorFilter('');
    setPathFilter('');
    setFromFilter('');
    setToFilter('');
  }

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Repositories</span>
        </Link>
      </div>

      {/* Repository Header */}
      {repo && (
        <div className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-white">{repo.name}</h1>
              {repo.defaultBranch && (
                <span className="inline-flex items-center gap-1 rounded-md bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300">
                  <GitBranch className="h-3.5 w-3.5 text-neutral-400" />
                  <span>{repo.defaultBranch}</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-neutral-400">
              {repo.lastAnalyzedAt
                ? `Last indexed on ${new Date(repo.lastAnalyzedAt).toLocaleString()}`
                : 'Not yet indexed.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTriggerAnalysis}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              <RotateCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
              <span>{isAnalyzing ? 'Analyzing...' : 'Re-analyze'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Analysis Status Banner */}
      {isAnalyzing && (
        <div className="flex items-center justify-between rounded-lg border border-blue-900/50 bg-blue-950/30 px-4 py-3 text-xs text-blue-200">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            <span>
              Ingesting repository history...{' '}
              {analysisProgress > 0 && `(${analysisProgress.toLocaleString()} commits processed)`}
            </span>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadCommits(true);
          }}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 mb-1">Author</label>
            <input
              type="text"
              placeholder="Name or email..."
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-400 mb-1">File Path</label>
            <input
              type="text"
              placeholder="e.g. src/index.ts"
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-400 mb-1">From Date</label>
            <input
              type="date"
              value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-400 mb-1">To Date</label>
            <input
              type="date"
              value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4 justify-end mt-1">
            <button
              type="button"
              onClick={() => {
                handleClearFilters();
                loadCommits(true);
              }}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              Clear
            </button>
            <button
              type="submit"
              className="rounded-md bg-neutral-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 transition-colors"
            >
              Filter Commits
            </button>
          </div>
        </form>
      </div>

      {/* Commits List */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-400">
            <AlertTriangle className="mx-auto h-6 w-6 text-rose-500 mb-2" />
            <span>{error}</span>
          </div>
        ) : commits.length === 0 ? (
          <div className="p-12 text-center">
            <GitCommit className="mx-auto h-8 w-8 text-neutral-600 mb-2" />
            <h4 className="text-sm font-medium text-white">No commits found</h4>
            <p className="mt-1 text-xs text-neutral-400">
              No commits match the selected filters or the repository has not been indexed yet.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {commits.map((commit) => {
              const isMerge = commit.parentCount > 1;

              return (
                <div
                  key={commit.hash}
                  onClick={() => handleSelectCommit(commit.hash)}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-neutral-800/40 cursor-pointer transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 shrink-0 rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300">
                      {commit.abbreviatedHash}
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-white line-clamp-1">
                          {commit.subject}
                        </span>
                        {isMerge && (
                          <span className="inline-flex items-center gap-1 rounded bg-purple-950 px-1.5 py-0.5 text-[10px] font-medium text-purple-300 border border-purple-800">
                            <GitMerge className="h-3 w-3" />
                            <span>Merge</span>
                          </span>
                        )}
                        {commit.refs?.map((ref) => (
                          <span
                            key={ref}
                            className="inline-flex items-center gap-1 rounded bg-blue-950 px-1.5 py-0.5 text-[10px] font-medium text-blue-300 border border-blue-800"
                          >
                            <Tag className="h-2.5 w-2.5" />
                            <span>{ref}</span>
                          </span>
                        ))}
                      </div>

                      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-400">
                        <span>{commit.authorName}</span>
                        <span>&bull;</span>
                        <span>{new Date(commit.authorTime).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <ChevronRight className="h-4 w-4 shrink-0 text-neutral-600" />
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {nextCursor && !loading && (
          <div className="border-t border-neutral-800 p-4 text-center">
            <button
              onClick={() => loadCommits(false, nextCursor)}
              disabled={loadingMore}
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
            >
              {loadingMore ? 'Loading next page...' : 'Load More Commits'}
            </button>
          </div>
        )}
      </div>

      {/* Commit Detail Drawer */}
      {selectedCommitHash && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm">
          <div className="h-full w-full max-w-xl border-l border-neutral-800 bg-neutral-900 p-6 shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
              <h3 className="text-base font-semibold text-white">Commit Details</h3>
              <button
                onClick={() => setSelectedCommitHash(null)}
                className="rounded p-1 text-neutral-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
              </div>
            ) : detailError ? (
              <div className="p-4 text-center text-xs text-rose-400">{detailError}</div>
            ) : commitDetail ? (
              <div className="mt-6 space-y-6">
                <div>
                  <h4 className="text-lg font-semibold text-white">{commitDetail.subject}</h4>
                  {commitDetail.body && (
                    <pre className="mt-2 text-xs text-neutral-300 font-mono whitespace-pre-wrap bg-neutral-950 p-3 rounded-lg border border-neutral-800">
                      {commitDetail.body}
                    </pre>
                  )}
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-neutral-800/60">
                    <span className="text-neutral-400">Full Hash</span>
                    <span className="font-mono text-neutral-200 select-all">
                      {commitDetail.hash}
                    </span>
                  </div>

                  <div className="flex justify-between py-1 border-b border-neutral-800/60">
                    <span className="text-neutral-400">Author</span>
                    <span className="text-neutral-200">
                      {commitDetail.authorName} &lt;{commitDetail.authorEmail}&gt;
                    </span>
                  </div>

                  <div className="flex justify-between py-1 border-b border-neutral-800/60">
                    <span className="text-neutral-400">Author Date</span>
                    <span className="text-neutral-200">
                      {new Date(commitDetail.authorTime).toLocaleString()}
                    </span>
                  </div>

                  {commitDetail.parentHashes.length > 0 && (
                    <div className="py-1 border-b border-neutral-800/60">
                      <span className="text-neutral-400 block mb-1">
                        Parents ({commitDetail.parentHashes.length})
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {commitDetail.parentHashes.map((p) => (
                          <span
                            key={p}
                            className="font-mono text-[11px] bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800 text-neutral-300"
                          >
                            {p.slice(0, 7)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {commitDetail.refs && commitDetail.refs.length > 0 && (
                    <div className="py-1 border-b border-neutral-800/60">
                      <span className="text-neutral-400 block mb-1">Branches / Tags</span>
                      <div className="flex flex-wrap gap-1.5">
                        {commitDetail.refs.map((r) => (
                          <span
                            key={r}
                            className="inline-flex items-center gap-1 rounded bg-blue-950 px-2 py-0.5 text-[11px] font-medium text-blue-300 border border-blue-800"
                          >
                            <Tag className="h-3 w-3" />
                            <span>{r}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Changed Files */}
                <div>
                  <h5 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">
                    Changed Files ({commitDetail.fileChanges.length})
                  </h5>
                  <div className="space-y-2">
                    {commitDetail.fileChanges.map((file) => (
                      <div
                        key={file.path}
                        className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                                file.changeType === 'added'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : file.changeType === 'deleted'
                                    ? 'bg-rose-950 text-rose-400 border border-rose-800'
                                    : file.changeType === 'renamed'
                                      ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                      : 'bg-blue-950 text-blue-400 border border-blue-800'
                              }`}
                            >
                              {file.changeType}
                            </span>
                            <span className="font-mono text-neutral-200 truncate">{file.path}</span>
                          </div>

                          {file.oldPath && (
                            <p className="mt-1 text-[11px] text-neutral-500 font-mono">
                              renamed from {file.oldPath}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 flex items-center gap-2 font-mono text-[11px]">
                          {file.isBinary ? (
                            <span className="text-neutral-500">binary</span>
                          ) : (
                            <>
                              {file.additions !== null && (
                                <span className="text-emerald-400">+{file.additions}</span>
                              )}
                              {file.deletions !== null && (
                                <span className="text-rose-400">-{file.deletions}</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
