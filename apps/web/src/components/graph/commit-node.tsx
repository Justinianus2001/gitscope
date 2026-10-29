'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { LayoutNodeData } from '@/lib/graph-layout';
import { GitCommit, GitMerge, Tag, GitBranch } from 'lucide-react';

const LANE_BORDER_COLORS = [
  'border-blue-500/70 hover:border-blue-400',
  'border-emerald-500/70 hover:border-emerald-400',
  'border-purple-500/70 hover:border-purple-400',
  'border-amber-500/70 hover:border-amber-400',
  'border-rose-500/70 hover:border-rose-400',
  'border-cyan-500/70 hover:border-cyan-400',
];

const LANE_DOT_COLORS = [
  'bg-blue-400 shadow-blue-500/50',
  'bg-emerald-400 shadow-emerald-500/50',
  'bg-purple-400 shadow-purple-500/50',
  'bg-amber-400 shadow-amber-500/50',
  'bg-rose-400 shadow-rose-500/50',
  'bg-cyan-400 shadow-cyan-500/50',
];

interface CommitNodeProps {
  data: LayoutNodeData;
  selected?: boolean;
}

export const CommitNode = React.memo(function CommitNode({ data, selected }: CommitNodeProps) {
  const laneIndex = (data.lane ?? 0) % LANE_BORDER_COLORS.length;
  const borderColor = LANE_BORDER_COLORS[laneIndex];
  const dotColor = LANE_DOT_COLORS[laneIndex];

  const formattedDate = React.useMemo(() => {
    try {
      const d = new Date(data.authorTime);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return data.authorTime;
    }
  }, [data.authorTime]);

  return (
    <div
      className={`group relative min-w-[260px] max-w-[320px] rounded-lg border bg-zinc-900/95 p-3 shadow-md backdrop-blur-sm transition-all duration-150 cursor-pointer ${
        selected ? 'ring-2 ring-blue-500 border-blue-400 shadow-lg' : borderColor
      }`}
      title={`${data.hash}\n${data.subject}`}
    >
      {/* Target handle: Incoming edge from child commit */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !rounded-full !bg-zinc-400 !border-zinc-800"
      />

      {/* Header: lane dot, abbreviated hash, merge indicator, date */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 font-mono text-zinc-300">
          <span className={`h-2.5 w-2.5 rounded-full shadow-sm ${dotColor}`} />
          <span className="font-semibold text-zinc-200">{data.abbreviatedHash}</span>
          {data.isMerge && (
            <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-300 border border-purple-500/40">
              <GitMerge className="h-3 w-3" />
              merge
            </span>
          )}
        </div>
        <span className="text-[11px] text-zinc-500">{formattedDate}</span>
      </div>

      {/* Subject */}
      <div className="mt-1.5 text-xs font-medium text-zinc-200 line-clamp-2 leading-relaxed">
        {data.subject}
      </div>

      {/* Author and Refs */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {data.authorName && (
          <span className="text-[11px] text-zinc-400 truncate max-w-[120px]">
            {data.authorName}
          </span>
        )}

        {/* Ref Badges (branches & tags) */}
        {data.refs && data.refs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.refs.map((ref) => {
              const isTag = ref.startsWith('v') || ref.includes('tag');
              return (
                <span
                  key={ref}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                    isTag
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  }`}
                >
                  {isTag ? <Tag className="h-2.5 w-2.5" /> : <GitBranch className="h-2.5 w-2.5" />}
                  {ref}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Source handle: Outgoing edge to parent commit */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !rounded-full !bg-zinc-400 !border-zinc-800"
      />
    </div>
  );
});
