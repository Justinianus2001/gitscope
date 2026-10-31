'use client';

import React, { useState, useEffect, useCallback, useMemo, use } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type {
  RepositoryListItem,
  ActivityBucket,
  ContributorSummary,
  HotspotItem,
  CoChangePair,
  ActivityInterval,
} from '@gitscope/shared';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  ArrowLeft,
  Calendar,
  Flame,
  GitCommit,
  GitBranch,
  GitGraph,
  GitMerge,
  Layers,
  Link2,
  List,
  Loader2,
  RefreshCw,
  Search,
  Users,
  AlertTriangle,
  Info,
  TrendingUp,
} from 'lucide-react';

export default function AnalyticsDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: repoId } = use(params);

  const [repo, setRepo] = useState<RepositoryListItem | null>(null);

  // Time & aggregation controls
  const [interval, setInterval] = useState<ActivityInterval>('day');
  const [rangePreset, setRangePreset] = useState<'30d' | '90d' | '180d' | '1y' | 'all'>('1y');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Path filter
  const [pathFilter, setPathFilter] = useState<string>('');
  const [minCoChange, setMinCoChange] = useState<number>(2);

  // Data states
  const [activityBuckets, setActivityBuckets] = useState<ActivityBucket[]>([]);
  const [contributors, setContributors] = useState<ContributorSummary[]>([]);
  const [totalCommits, setTotalCommits] = useState<number>(0);
  const [totalContributors, setTotalContributors] = useState<number>(0);

  const [hotspots, setHotspots] = useState<HotspotItem[]>([]);
  const [coChangePairs, setCoChangePairs] = useState<CoChangePair[]>([]);
  const [excludedLargeCommits, setExcludedLargeCommits] = useState<number>(0);

  // Loading & Error states
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Compute preset dates
  const updateRangePreset = useCallback((preset: '30d' | '90d' | '180d' | '1y' | 'all') => {
    setRangePreset(preset);
    const now = new Date();
    const endIso = now.toISOString();

    if (preset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }

    const start = new Date(now);
    if (preset === '30d') {
      start.setUTCDate(start.getUTCDate() - 30);
    } else if (preset === '90d') {
      start.setUTCDate(start.getUTCDate() - 90);
    } else if (preset === '180d') {
      start.setUTCDate(start.getUTCDate() - 180);
    } else if (preset === '1y') {
      start.setUTCFullYear(start.getUTCFullYear() - 1);
    }

    setFromDate(start.toISOString().split('T')[0] || '');
    setToDate(endIso.split('T')[0] || '');
  }, []);

  // Initialize 1-year preset so repositories (including demo) display data immediately
  useEffect(() => {
    updateRangePreset('1y');
  }, [updateRangePreset]);

  // Load repository info
  useEffect(() => {
    api
      .getRepository(repoId)
      .then((data) => setRepo(data))
      .catch((err) => console.warn('Failed to load repo info', err));
  }, [repoId]);

  // Load all analytics data
  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    const fromIso = fromDate ? new Date(`${fromDate}T00:00:00.000Z`).toISOString() : undefined;
    const toIso = toDate ? new Date(`${toDate}T23:59:59.999Z`).toISOString() : undefined;

    try {
      const [actData, hotData, coData] = await Promise.all([
        api.getActivity(repoId, {
          from: fromIso,
          to: toIso,
          interval,
        }),
        api.getHotspots(repoId, {
          from: fromIso,
          to: toIso,
          path: pathFilter.trim() || undefined,
          limit: 50,
        }),
        api.getCoChanges(repoId, {
          from: fromIso,
          to: toIso,
          path: pathFilter.trim() || undefined,
          minCount: minCoChange,
          limit: 50,
        }),
      ]);

      setActivityBuckets(actData.buckets);
      setContributors(actData.contributors);
      setTotalCommits(actData.totalCommits);
      setTotalContributors(actData.totalContributors);

      setHotspots(hotData);

      setCoChangePairs(coData.pairs);
      setExcludedLargeCommits(coData.excludedLargeCommitsCount);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load analytics data.');
      }
    } finally {
      setLoading(false);
    }
  }, [repoId, fromDate, toDate, interval, pathFilter, minCoChange]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Peak commit stats
  const peakBucket = useMemo(() => {
    if (activityBuckets.length === 0) return null;
    return activityBuckets.reduce(
      (max, b) => (b.commitCount > (max?.commitCount ?? 0) ? b : max),
      activityBuckets[0] ?? null,
    );
  }, [activityBuckets]);

  const avgCommitsPerBucket = useMemo(() => {
    if (activityBuckets.length === 0) return 0;
    return (totalCommits / activityBuckets.length).toFixed(1);
  }, [totalCommits, activityBuckets.length]);

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb */}
      <div>
        <Link
          href={`/repositories/${repoId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Repository Explorer</span>
        </Link>
      </div>

      {/* Header & Tabs */}
      <div className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {repo?.name ?? 'Repository'} Analytics
            </h1>
            {repo?.defaultBranch && (
              <span className="inline-flex items-center gap-1 rounded-md bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300">
                <GitBranch className="h-3.5 w-3.5 text-neutral-400" />
                <span>{repo.defaultBranch}</span>
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Historical change frequency, hotspots, author patterns, and structural co-change
            coupling.
          </p>
        </div>

        {/* View Switcher Navigation */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/repositories/${repoId}?view=graph`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-700 transition"
          >
            <GitGraph className="h-3.5 w-3.5 text-blue-400" />
            <span>Interactive Graph</span>
          </Link>
          <Link
            href={`/repositories/${repoId}?view=commits`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-700 transition"
          >
            <List className="h-3.5 w-3.5 text-neutral-400" />
            <span>Commit Explorer</span>
          </Link>
        </div>
      </div>

      {/* Filter & Date Range Toolbar */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Presets */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-neutral-400 font-medium mr-1 flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              Window:
            </span>
            {(['30d', '90d', '180d', '1y', 'all'] as const).map((p) => (
              <button
                key={p}
                onClick={() => updateRangePreset(p)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  rangePreset === p
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                {p === '30d' && '30 Days'}
                {p === '90d' && '90 Days'}
                {p === '180d' && '6 Months'}
                {p === '1y' && '1 Year'}
                {p === 'all' && 'All Time'}
              </button>
            ))}
          </div>

          {/* Interval Buttons */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-neutral-400 font-medium mr-1">Bucket:</span>
            {(['day', 'week', 'month'] as const).map((intVal) => (
              <button
                key={intVal}
                onClick={() => setInterval(intVal)}
                className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition ${
                  interval === intVal
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                {intVal === 'day' ? 'Daily' : intVal === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date range and path filters */}
        <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-neutral-800/60 text-xs">
          <div>
            <label className="block text-[11px] text-neutral-400 mb-1">From (UTC)</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setRangePreset('all');
              }}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] text-neutral-400 mb-1">To (UTC)</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setRangePreset('all');
              }}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] text-neutral-400 mb-1">Path Filter (Prefix)</label>
            <div className="relative">
              <input
                type="text"
                placeholder="e.g. src/ or docs/"
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadAnalytics()}
            className="rounded bg-rose-900/40 px-2.5 py-1 text-rose-200 hover:bg-rose-900/60 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>Total Commits</span>
            <GitCommit className="h-4 w-4 text-blue-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white">
            {loading ? '-' : totalCommits.toLocaleString()}
          </p>
          <span className="text-[11px] text-neutral-500">In selected time window</span>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>Distinct Authors</span>
            <Users className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white">
            {loading ? '-' : totalContributors.toLocaleString()}
          </p>
          <span className="text-[11px] text-neutral-500">Normalized email identities</span>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>Avg Activity / Bucket</span>
            <TrendingUp className="h-4 w-4 text-purple-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white">
            {loading ? '-' : avgCommitsPerBucket}
          </p>
          <span className="text-[11px] text-neutral-500">Per {interval} in range</span>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>Peak Activity</span>
            <Flame className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white">
            {loading ? '-' : (peakBucket?.commitCount ?? 0)}
          </p>
          <span className="text-[11px] text-neutral-500 truncate block">
            {peakBucket?.bucket ? `On ${peakBucket.bucket}` : 'No activity'}
          </span>
        </div>
      </div>

      {/* Activity Over Time Chart */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-400" />
              <span>Commit Activity Over Time</span>
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5">
              Zero-filled chronological commit volume and active contributor count.
            </p>
          </div>
          <span className="text-xs text-neutral-500 font-mono">
            {activityBuckets.length} buckets ({interval})
          </span>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
          </div>
        ) : activityBuckets.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-neutral-500">
            <Info className="h-8 w-8 mb-2" />
            <p className="text-xs">No activity found for this range.</p>
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={activityBuckets}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis
                  dataKey="bucket"
                  stroke="#737373"
                  fontSize={11}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis stroke="#737373" fontSize={11} tickLine={false} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0]?.payload as ActivityBucket;
                      return (
                        <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl text-xs">
                          <p className="font-semibold text-white">{data.bucket}</p>
                          <div className="mt-1.5 space-y-1">
                            <p className="text-blue-400">
                              Commits: <span className="font-bold">{data.commitCount}</span>
                            </p>
                            <p className="text-emerald-400">
                              Contributors:{' '}
                              <span className="font-bold">{data.distinctContributors}</span>
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="commitCount"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#activityGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Grid: Contributor Overview & File Hotspots */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contributors List */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-400" />
              <span>Contributors Overview</span>
            </h3>
            <span className="text-xs text-neutral-500">{contributors.length} authors</span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[380px] divide-y divide-neutral-800/60 pr-1">
            {contributors.length === 0 ? (
              <p className="text-xs text-neutral-500 py-6 text-center">No contributors found.</p>
            ) : (
              contributors.map((c, i) => (
                <div
                  key={c.email || c.name}
                  className="py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white truncate">{c.name}</p>
                    <p className="text-[11px] text-neutral-500 truncate">{c.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-bold text-neutral-200">{c.commitCount}</span>
                    <span className="text-[10px] text-neutral-500 block">
                      {totalCommits > 0
                        ? `${Math.round((c.commitCount / totalCommits) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Hotspots Table */}
        <div className="lg:col-span-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-400" />
                <span>File Hotspots</span>
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                Files ranked by distinct modifying commits and churn volume.
              </p>
            </div>
            <span className="text-xs text-neutral-500 font-mono">{hotspots.length} files</span>
          </div>

          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-400">
                  <th className="pb-2 font-medium">File Path</th>
                  <th className="pb-2 font-medium text-right">Commits</th>
                  <th className="pb-2 font-medium text-right">Additions</th>
                  <th className="pb-2 font-medium text-right">Deletions</th>
                  <th className="pb-2 font-medium text-right">Last Modified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/40">
                {hotspots.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-neutral-500">
                      No file changes found matching filter criteria.
                    </td>
                  </tr>
                ) : (
                  hotspots.map((file, idx) => (
                    <tr key={file.path} className="hover:bg-neutral-800/30 transition-colors">
                      <td
                        className="py-2.5 font-mono text-neutral-200 max-w-xs truncate"
                        title={file.path}
                      >
                        <span className="text-neutral-500 mr-2 text-[11px]">#{idx + 1}</span>
                        {file.path}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-blue-400">
                        {file.distinctCommits}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {file.totalAdditions !== null ? (
                          <span className="text-emerald-400">
                            +{file.totalAdditions.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-neutral-500">binary</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {file.totalDeletions !== null ? (
                          <span className="text-rose-400">
                            -{file.totalDeletions.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-neutral-500">-</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right text-neutral-400 whitespace-nowrap">
                        {file.lastChangedAt
                          ? new Date(file.lastChangedAt).toLocaleDateString()
                          : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Co-Change Insights Section */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Link2 className="h-4 w-4 text-cyan-400" />
              <span>Co-Change Coupling (Logical File Associations)</span>
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5">
              Pairs of files frequently committed together in the same change set. Indicates
              historical coupling.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-400 font-medium">Min Support Count:</span>
            <select
              value={minCoChange}
              onChange={(e) => setMinCoChange(Number(e.target.value))}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value={1}>1 commit</option>
              <option value={2}>2 commits (default)</option>
              <option value={3}>3 commits</option>
              <option value={5}>5 commits</option>
              <option value={10}>10 commits</option>
            </select>
          </div>
        </div>

        {/* Bulk Commit Safety Exclusion Warning */}
        {excludedLargeCommits > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-950/20 border border-amber-900/40 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              {excludedLargeCommits} bulk {excludedLargeCommits === 1 ? 'commit' : 'commits'}{' '}
              touching over 200 files {excludedLargeCommits === 1 ? 'was' : 'were'} excluded to
              prevent quadratic combinatorial distortion.
            </span>
          </div>
        )}

        {/* Co-Change Pairs Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-400">
                <th className="pb-2 font-medium">Rank</th>
                <th className="pb-2 font-medium">File A</th>
                <th className="pb-2 font-medium">File B</th>
                <th className="pb-2 font-medium text-right">Shared Commits</th>
                <th className="pb-2 font-medium text-right">Last Co-Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/40">
              {coChangePairs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-neutral-500">
                    No co-change pairs meet the minimum support threshold ({minCoChange} commits).
                  </td>
                </tr>
              ) : (
                coChangePairs.map((pair, idx) => (
                  <tr
                    key={`${pair.pathA}-${pair.pathB}`}
                    className="hover:bg-neutral-800/30 transition-colors"
                  >
                    <td className="py-2.5 font-mono text-neutral-500 text-[11px]">#{idx + 1}</td>
                    <td
                      className="py-2.5 font-mono text-neutral-200 max-w-sm truncate"
                      title={pair.pathA}
                    >
                      {pair.pathA}
                    </td>
                    <td
                      className="py-2.5 font-mono text-neutral-200 max-w-sm truncate"
                      title={pair.pathB}
                    >
                      {pair.pathB}
                    </td>
                    <td className="py-2.5 text-right font-bold text-cyan-400">
                      <span className="inline-flex items-center gap-1 rounded bg-cyan-950/40 border border-cyan-900/40 px-2 py-0.5 text-xs">
                        <Link2 className="h-3 w-3" />
                        {pair.coChangeCount}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-neutral-400 whitespace-nowrap">
                      {pair.lastCoChangeAt
                        ? new Date(pair.lastCoChangeAt).toLocaleDateString()
                        : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
