'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { api, ApiError } from '@/lib/api';
import {
  computeGraphLayout,
  type LayoutNode,
  type LayoutEdge,
  type LayoutNodeData,
} from '@/lib/graph-layout';
import { CommitNode } from './commit-node';
import type { GraphNode, RefItem } from '@gitscope/shared';
import {
  GitBranch,
  Tag,
  AlertTriangle,
  RefreshCw,
  List,
  GitCommit,
  Maximize2,
  Info,
} from 'lucide-react';

interface CommitGraphProps {
  repoId: string;
  defaultBranch?: string | null;
  onSelectCommit: (hash: string) => void;
  onSwitchToListView?: () => void;
}

const nodeTypes = {
  commit: CommitNode,
};

const defaultEdgeOptions = {
  type: 'smoothstep',
  style: { stroke: '#475569', strokeWidth: 2 },
};

export function CommitGraph({
  repoId,
  defaultBranch,
  onSelectCommit,
  onSwitchToListView,
}: CommitGraphProps) {
  const [refs, setRefs] = useState<RefItem[]>([]);
  const [selectedRef, setSelectedRef] = useState<string>(defaultBranch || '');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<boolean>(false);
  const [rawNodes, setRawNodes] = useState<GraphNode[]>([]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<LayoutNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // 1. Fetch available branches and tags
  useEffect(() => {
    let active = true;
    api
      .getRefs(repoId)
      .then((data) => {
        if (!active) return;
        setRefs(data);
        // Default to defaultBranch if selectedRef is empty
        if (!selectedRef) {
          const matched = data.find((r) => r.name === defaultBranch);
          if (matched) {
            setSelectedRef(matched.name);
          } else if (data.length > 0 && data[0]) {
            setSelectedRef(data[0].name);
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to load refs:', err);
      });

    return () => {
      active = false;
    };
  }, [repoId, defaultBranch]);

  // 2. Fetch Graph Data
  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const graphData = await api.getGraph(repoId, {
        ref: selectedRef || undefined,
        limit: 300,
      });

      setRawNodes(graphData.nodes);
      setTruncated(graphData.truncated);

      // Compute deterministic layout
      const layout = computeGraphLayout(graphData.nodes, {
        rowHeight: 90,
        laneWidth: 340,
        paddingX: 40,
        paddingY: 40,
      });

      // Map to ReactFlow nodes
      const rfNodes: Node<LayoutNodeData>[] = layout.nodes.map((n) => ({
        id: n.id,
        type: 'commit',
        position: n.position,
        data: n.data,
        selected: n.id === selectedHash,
      }));

      // Map to ReactFlow edges
      const rfEdges: Edge[] = layout.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        style: { stroke: '#475569', strokeWidth: 2 },
      }));

      setNodes(rfNodes);
      setEdges(rfEdges);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load commit graph.');
      }
    } finally {
      setLoading(false);
    }
  }, [repoId, selectedRef, selectedHash, setNodes, setEdges]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Handle clicking a commit node
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<LayoutNodeData>) => {
      setSelectedHash(node.id);
      onSelectCommit(node.id);

      // Update selected status on nodes
      setNodes((prevNodes) =>
        prevNodes.map((n) => ({
          ...n,
          selected: n.id === node.id,
        })),
      );
    },
    [onSelectCommit, setNodes],
  );

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px] w-full rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden shadow-2xl">
      {/* Graph Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-900/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <GitCommit className="h-4 w-4 text-blue-400" />
            <span>Interactive Ancestry Graph</span>
          </div>

          {/* Ref (Branch/Tag) Selector */}
          <div className="flex items-center gap-1.5 sm:border-l sm:border-neutral-800 sm:pl-3 text-xs">
            <GitBranch className="h-3.5 w-3.5 text-neutral-400" />
            <select
              value={selectedRef}
              onChange={(e) => setSelectedRef(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Default Branch ({defaultBranch || 'HEAD'})</option>
              {refs.map((ref) => (
                <option key={`${ref.refType}-${ref.name}`} value={ref.name}>
                  {ref.refType === 'tag' ? `tag: ${ref.name}` : ref.name}
                  {ref.isRemote ? ' (remote)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh Button */}
          <button
            onClick={() => loadGraph()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition disabled:opacity-50"
            title="Reload graph"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {/* Fallback to accessible list view */}
          {onSwitchToListView && (
            <button
              onClick={onSwitchToListView}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition"
              title="Switch to accessible tabular commit explorer"
            >
              <List className="h-3 w-3" />
              Accessible List View
            </button>
          )}
        </div>
      </div>

      {/* Truncation Notice Banner */}
      {truncated && (
        <div className="flex items-center gap-2 bg-amber-950/40 border-b border-amber-900/50 px-4 py-2 text-xs text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            History is bounded to the most recent 300 commits for this ref. Older ancestor commits
            are truncated to maintain smooth browser performance.
          </span>
        </div>
      )}

      {/* Canvas Area */}
      <div className="relative flex-1 w-full h-full bg-neutral-950">
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-neutral-950/70 backdrop-blur-xs">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-500 mb-2" />
            <span className="text-sm text-neutral-400 font-medium">Computing graph layout...</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-rose-500 mb-2" />
            <h3 className="text-sm font-semibold text-neutral-100">Unable to load graph</h3>
            <p className="mt-1 text-xs text-neutral-400 max-w-sm">{error}</p>
            <button
              onClick={() => loadGraph()}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        )}

        {!loading && !error && rawNodes.length === 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center">
            <Info className="h-10 w-10 text-neutral-600 mb-2" />
            <h3 className="text-sm font-semibold text-neutral-200">No commits found</h3>
            <p className="mt-1 text-xs text-neutral-500 max-w-sm">
              The selected ref does not contain any indexed commits yet. Trigger an analysis if this
              is a new repository.
            </p>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          className="gitscope-react-flow"
        >
          <Background color="#262626" gap={20} size={1.5} variant={BackgroundVariant.Dots} />
          <Controls
            className="!bg-neutral-900 !border-neutral-800 !fill-neutral-300 [&>button]:!border-neutral-800 [&>button]:!bg-neutral-900 [&>button:hover]:!bg-neutral-800"
            showInteractive={false}
          />
          <MiniMap
            className="!bg-neutral-900/90 !border-neutral-800 !rounded-lg overflow-hidden"
            nodeColor={(n) => {
              const lane = (n.data as { lane?: number })?.lane ?? 0;
              const colors = ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#f43f5e', '#06b6d4'];
              return colors[lane % colors.length] ?? '#3b82f6';
            }}
            maskColor="rgba(10, 10, 10, 0.7)"
          />
        </ReactFlow>
      </div>

      {/* Footer Instructions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-neutral-800/80 bg-neutral-900/50 px-4 py-2 text-[11px] text-neutral-400">
        <div className="flex items-center gap-2">
          <span>Click any commit node to inspect changes, diff statistics, and file history.</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span>Nodes: {rawNodes.length}</span>
          <span>Pan: Drag</span>
          <span>Zoom: Scroll</span>
        </div>
      </div>
    </div>
  );
}
