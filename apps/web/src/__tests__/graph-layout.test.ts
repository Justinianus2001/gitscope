import { describe, it, expect } from 'vitest';
import { computeGraphLayout } from '../lib/graph-layout.js';
import type { GraphNode } from '@gitscope/shared';

describe('Graph Layout Engine', () => {
  it('returns empty result for empty input', () => {
    const result = computeGraphLayout([]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it('assigns single lane (lane 0) and vertical descent for linear history', () => {
    const commits: GraphNode[] = [
      {
        hash: 'c300000000000000000000000000000000000000',
        subject: 'Commit 3',
        authorTime: '2026-10-29T12:00:00.000Z',
        parentHashes: ['c200000000000000000000000000000000000000'],
        refs: ['main'],
      },
      {
        hash: 'c200000000000000000000000000000000000000',
        subject: 'Commit 2',
        authorTime: '2026-10-29T11:00:00.000Z',
        parentHashes: ['c100000000000000000000000000000000000000'],
        refs: [],
      },
      {
        hash: 'c100000000000000000000000000000000000000',
        subject: 'Commit 1',
        authorTime: '2026-10-29T10:00:00.000Z',
        parentHashes: [],
        refs: ['v1.0.0'],
      },
    ];

    const result = computeGraphLayout(commits);
    expect(result.nodes.length).toBe(3);
    expect(result.edges.length).toBe(2);

    // All commits in lane 0
    expect(result.nodes.every((n) => n.data.lane === 0)).toBe(true);

    // Children placed strictly above parents (topological order)
    const n3 = result.nodes.find((n) => n.id === commits[0]!.hash)!;
    const n2 = result.nodes.find((n) => n.id === commits[1]!.hash)!;
    const n1 = result.nodes.find((n) => n.id === commits[2]!.hash)!;

    expect(n3.position.y).toBeLessThan(n2.position.y);
    expect(n2.position.y).toBeLessThan(n1.position.y);

    // Edges correctly linked
    expect(result.edges).toContainEqual({
      id: `e-${commits[0]!.hash}-${commits[1]!.hash}`,
      source: commits[0]!.hash,
      target: commits[1]!.hash,
      type: 'smoothstep',
    });
    expect(result.edges).toContainEqual({
      id: `e-${commits[1]!.hash}-${commits[2]!.hash}`,
      source: commits[1]!.hash,
      target: commits[2]!.hash,
      type: 'smoothstep',
    });
  });

  it('allocates distinct lanes for branches and links merge commit to both parents', () => {
    // History:
    // Root A
    //  -> Main B
    //  -> Feature F
    //  -> Merge M (parents: [B, F])
    const commits: GraphNode[] = [
      {
        hash: 'm000000000000000000000000000000000000000',
        subject: 'Merge branch feature',
        authorTime: '2026-10-29T14:00:00.000Z',
        parentHashes: [
          'b000000000000000000000000000000000000000',
          'f00000000000000000000000000000000000000',
        ],
        refs: ['main'],
      },
      {
        hash: 'b000000000000000000000000000000000000000',
        subject: 'Main commit B',
        authorTime: '2026-10-29T13:00:00.000Z',
        parentHashes: ['a00000000000000000000000000000000000000'],
        refs: [],
      },
      {
        hash: 'f00000000000000000000000000000000000000',
        subject: 'Feature commit F',
        authorTime: '2026-10-29T12:00:00.000Z',
        parentHashes: ['a00000000000000000000000000000000000000'],
        refs: ['feature'],
      },
      {
        hash: 'a00000000000000000000000000000000000000',
        subject: 'Initial commit A',
        authorTime: '2026-10-29T10:00:00.000Z',
        parentHashes: [],
        refs: [],
      },
    ];

    const result = computeGraphLayout(commits);
    expect(result.nodes.length).toBe(4);
    expect(result.edges.length).toBe(4); // M->B, M->F, B->A, F->A

    const mergeNode = result.nodes.find((n) => n.id === commits[0]!.hash)!;
    expect(mergeNode.data.isMerge).toBe(true);

    const bNode = result.nodes.find((n) => n.id === commits[1]!.hash)!;
    const fNode = result.nodes.find((n) => n.id === commits[2]!.hash)!;
    const aNode = result.nodes.find((n) => n.id === commits[3]!.hash)!;

    // Branches B and F should occupy distinct lanes
    expect(bNode.data.lane).not.toBe(fNode.data.lane);

    // Merge commit has edges to both parents
    const mergeEdges = result.edges.filter((e) => e.source === mergeNode.id);
    expect(mergeEdges.length).toBe(2);
    expect(mergeEdges.map((e) => e.target)).toContain(bNode.id);
    expect(mergeEdges.map((e) => e.target)).toContain(fNode.id);

    // Topological order: all children strictly above parents
    for (const edge of result.edges) {
      const src = result.nodes.find((n) => n.id === edge.source)!;
      const tgt = result.nodes.find((n) => n.id === edge.target)!;
      expect(src.position.y).toBeLessThan(tgt.position.y);
    }
  });

  it('handles truncated history without creating dangling edges', () => {
    // Commit whose parent is not in the list
    const commits: GraphNode[] = [
      {
        hash: 'c200000000000000000000000000000000000000',
        subject: 'Latest commit',
        authorTime: '2026-10-29T12:00:00.000Z',
        parentHashes: ['c1_outside_bounded_window'],
        refs: ['main'],
      },
    ];

    const result = computeGraphLayout(commits);
    expect(result.nodes.length).toBe(1);
    // No edge created to the truncated parent
    expect(result.edges.length).toBe(0);
    expect(result.nodes[0]!.data.parentHashes).toEqual(['c1_outside_bounded_window']);
  });

  it('guarantees identical deterministic coordinates for repeated calls', () => {
    const commits: GraphNode[] = [
      {
        hash: 'm000000000000000000000000000000000000000',
        subject: 'Merge commit',
        authorTime: '2026-10-29T14:00:00.000Z',
        parentHashes: [
          'b000000000000000000000000000000000000000',
          'f00000000000000000000000000000000000000',
        ],
        refs: ['main'],
      },
      {
        hash: 'b000000000000000000000000000000000000000',
        subject: 'Branch commit',
        authorTime: '2026-10-29T13:00:00.000Z',
        parentHashes: ['a00000000000000000000000000000000000000'],
        refs: [],
      },
      {
        hash: 'f00000000000000000000000000000000000000',
        subject: 'Feature commit',
        authorTime: '2026-10-29T12:00:00.000Z',
        parentHashes: ['a00000000000000000000000000000000000000'],
        refs: ['feature'],
      },
      {
        hash: 'a00000000000000000000000000000000000000',
        subject: 'Root commit',
        authorTime: '2026-10-29T10:00:00.000Z',
        parentHashes: [],
        refs: [],
      },
    ];

    const result1 = computeGraphLayout(commits);
    const result2 = computeGraphLayout(commits);

    expect(result1.nodes).toEqual(result2.nodes);
    expect(result1.edges).toEqual(result2.edges);
    expect(result1.width).toEqual(result2.width);
    expect(result1.height).toEqual(result2.height);
  });
});
