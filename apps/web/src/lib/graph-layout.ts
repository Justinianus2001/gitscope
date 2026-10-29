import type { GraphNode } from '@gitscope/shared';

export interface LayoutNodeData extends Record<string, unknown> {
  hash: string;
  abbreviatedHash: string;
  subject: string;
  authorTime: string;
  authorName?: string;
  parentHashes: string[];
  refs: string[];
  lane: number;
  isMerge: boolean;
  isRoot: boolean;
}

export interface LayoutNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: LayoutNodeData;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface LayoutOptions {
  rowHeight?: number;
  laneWidth?: number;
  paddingX?: number;
  paddingY?: number;
}

export interface GraphLayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  rowHeight: 80,
  laneWidth: 160,
  paddingX: 50,
  paddingY: 50,
};

/**
 * Computes deterministic 2D coordinates and edges for a commit DAG.
 * Uses topological sorting so children always precede parents vertically,
 * and assigns distinct horizontal lanes to branches and merges.
 */
export function computeGraphLayout(
  graphNodes: GraphNode[],
  options?: LayoutOptions,
): GraphLayoutResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (graphNodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
    };
  }

  const nodeMap = new Map<string, GraphNode>();
  for (const n of graphNodes) {
    nodeMap.set(n.hash, n);
  }

  // 1. Build adjacency for topological sorting (descendants before ancestors)
  // For each node P, which children C in the set have P in C.parentHashes?
  const childCount = new Map<string, number>();
  const childrenMap = new Map<string, string[]>();

  for (const n of graphNodes) {
    childCount.set(n.hash, 0);
    childrenMap.set(n.hash, []);
  }

  for (const n of graphNodes) {
    for (const parentHash of n.parentHashes) {
      if (nodeMap.has(parentHash)) {
        childCount.set(parentHash, (childCount.get(parentHash) ?? 0) + 1);
        const children = childrenMap.get(parentHash) ?? [];
        children.push(n.hash);
        childrenMap.set(parentHash, children);
      }
    }
  }

  // Priority queue / available list: nodes with childCount === 0
  // Sorted by authorTime DESC, hash DESC
  const compareNodes = (aHash: string, bHash: string): number => {
    const a = nodeMap.get(aHash);
    const b = nodeMap.get(bHash);
    if (!a || !b) return 0;
    if (a.authorTime !== b.authorTime) {
      return a.authorTime < b.authorTime ? 1 : -1;
    }
    return a.hash < b.hash ? 1 : -1;
  };

  const available: string[] = [];
  for (const [hash, count] of childCount.entries()) {
    if (count === 0) {
      available.push(hash);
    }
  }
  available.sort(compareNodes);

  const topologicalOrder: GraphNode[] = [];
  const placed = new Set<string>();

  while (available.length > 0) {
    const nextHash = available.shift()!;
    if (placed.has(nextHash)) continue;

    placed.add(nextHash);
    const node = nodeMap.get(nextHash);
    if (!node) continue;
    topologicalOrder.push(node);

    for (const parentHash of node.parentHashes) {
      if (nodeMap.has(parentHash) && !placed.has(parentHash)) {
        const remaining = (childCount.get(parentHash) ?? 1) - 1;
        childCount.set(parentHash, remaining);
        if (remaining === 0) {
          // Insert parent in sorted position
          let insertIdx = 0;
          while (
            insertIdx < available.length &&
            compareNodes(available[insertIdx]!, parentHash) < 0
          ) {
            insertIdx++;
          }
          available.splice(insertIdx, 0, parentHash);
        }
      }
    }

    // Safety fallback: if available queue empty but unplaced nodes remain (e.g. disconnected)
    if (available.length === 0 && placed.size < graphNodes.length) {
      const remainingUnplaced = graphNodes
        .filter((n) => !placed.has(n.hash))
        .sort((a, b) => compareNodes(a.hash, b.hash));
      if (remainingUnplaced.length > 0 && remainingUnplaced[0]) {
        available.push(remainingUnplaced[0].hash);
      }
    }
  }

  // 2. Assign horizontal lanes to branches
  const activeLanes: (string | null)[] = [];
  const layoutNodes: LayoutNode[] = [];
  let maxLane = 0;

  for (let rowIndex = 0; rowIndex < topologicalOrder.length; rowIndex++) {
    const node = topologicalOrder[rowIndex]!;
    const hash = node.hash;

    // Check if node is already tracked in an active lane
    let lane = activeLanes.indexOf(hash);
    if (lane === -1) {
      // Find first available lane slot or append new lane
      const firstFree = activeLanes.indexOf(null);
      if (firstFree !== -1) {
        lane = firstFree;
      } else {
        lane = activeLanes.length;
        activeLanes.push(null);
      }
    }

    if (lane > maxLane) {
      maxLane = lane;
    }

    // Filter parents to those present in the layout node set
    const validParents = node.parentHashes.filter((p) => nodeMap.has(p));

    if (validParents.length > 0 && validParents[0]) {
      const primaryParent = validParents[0];
      const existingParentLane = activeLanes.indexOf(primaryParent);

      if (existingParentLane !== -1 && existingParentLane !== lane) {
        // Primary parent already tracked in another lane; free current lane
        activeLanes[lane] = null;
      } else {
        // Primary parent continues down this lane
        activeLanes[lane] = primaryParent;
      }

      // Secondary parents (for merge commits)
      for (let pIdx = 1; pIdx < validParents.length; pIdx++) {
        const secParent = validParents[pIdx]!;
        if (!activeLanes.includes(secParent)) {
          const freeSlot = activeLanes.indexOf(null);
          if (freeSlot !== -1) {
            activeLanes[freeSlot] = secParent;
            if (freeSlot > maxLane) maxLane = freeSlot;
          } else {
            activeLanes.push(secParent);
            if (activeLanes.length - 1 > maxLane) maxLane = activeLanes.length - 1;
          }
        }
      }
    } else {
      // Root or parent outside bounded window
      activeLanes[lane] = null;
    }

    // Trim trailing empty lanes
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop();
    }

    const x = opts.paddingX + lane * opts.laneWidth;
    const y = opts.paddingY + rowIndex * opts.rowHeight;

    layoutNodes.push({
      id: hash,
      type: 'commit',
      position: { x, y },
      data: {
        hash,
        abbreviatedHash: hash.slice(0, 7),
        subject: node.subject,
        authorTime: node.authorTime,
        authorName: node.authorName,
        parentHashes: node.parentHashes,
        refs: node.refs,
        lane,
        isMerge: node.parentHashes.length > 1,
        isRoot: node.parentHashes.length === 0,
      },
    });
  }

  // 3. Generate directed edges
  const layoutEdges: LayoutEdge[] = [];
  for (const node of topologicalOrder) {
    for (const parentHash of node.parentHashes) {
      if (nodeMap.has(parentHash)) {
        layoutEdges.push({
          id: `e-${node.hash}-${parentHash}`,
          source: node.hash,
          target: parentHash,
          type: 'smoothstep',
        });
      }
    }
  }

  const width = opts.paddingX * 2 + (maxLane + 1) * opts.laneWidth;
  const height = opts.paddingY * 2 + topologicalOrder.length * opts.rowHeight;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width,
    height,
  };
}
