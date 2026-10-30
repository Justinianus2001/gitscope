import { describe, it, expect } from 'vitest';
import type { RepositoryListItem } from '@gitscope/shared';

// Helper matching logic implemented in RepositoryDetailPage
export function resolveActiveView(viewParam: string | null): 'graph' | 'commits' {
  return viewParam === 'commits' ? 'commits' : 'graph';
}

export function buildViewQueryString(
  currentSearchParams: URLSearchParams,
  newView: 'graph' | 'commits',
): string {
  const params = new URLSearchParams(currentSearchParams.toString());
  if (newView === 'commits') {
    params.set('view', 'commits');
  } else {
    params.set('view', 'graph');
  }
  return params.toString();
}

// Helper matching logic implemented in RepositoriesPage polling
export function shouldPollRepositories(
  repos: Array<Pick<RepositoryListItem, 'id' | 'analysisStatus'>>,
  analyzingIds: Set<string>,
): boolean {
  return (
    analyzingIds.size > 0 ||
    repos.some((r) => r.analysisStatus === 'running' || r.analysisStatus === 'queued')
  );
}

export function pruneAnalyzingIds(
  currentAnalyzingIds: Set<string>,
  latestRepos: Array<Pick<RepositoryListItem, 'id' | 'analysisStatus'>>,
): Set<string> {
  if (currentAnalyzingIds.size === 0) return currentAnalyzingIds;
  const next = new Set(currentAnalyzingIds);
  for (const repo of latestRepos) {
    if (
      repo.analysisStatus === 'completed' ||
      repo.analysisStatus === 'failed' ||
      repo.analysisStatus === 'running'
    ) {
      next.delete(repo.id);
    }
  }
  return next;
}

// Focus trap navigation helper
export function getNextTrappedFocus(
  elements: Array<{ id: string }>,
  currentElementId: string,
  isShiftTab: boolean,
): { id: string } | null {
  if (elements.length === 0) return null;
  const currentIndex = elements.findIndex((el) => el.id === currentElementId);
  const first = elements[0]!;
  const last = elements[elements.length - 1]!;

  if (isShiftTab) {
    // Shift + Tab: if on first element or outside, wrap to last
    if (currentIndex <= 0) return last;
    return elements[currentIndex - 1] ?? last;
  } else {
    // Tab: if on last element, wrap to first
    if (currentIndex === elements.length - 1 || currentIndex < 0) return first;
    return elements[currentIndex + 1] ?? first;
  }
}

// Circuit breaker helper for consecutive polling errors
export function shouldHaltPollingOnErrors(
  consecutiveErrorCount: number,
  maxAllowed: number = 5,
): boolean {
  return consecutiveErrorCount >= maxAllowed;
}

describe('UX State Management & Navigation Helpers', () => {
  describe('View Navigation with URL searchParams', () => {
    it('resolves active view correctly from query string', () => {
      expect(resolveActiveView('commits')).toBe('commits');
      expect(resolveActiveView('graph')).toBe('graph');
      expect(resolveActiveView(null)).toBe('graph');
      expect(resolveActiveView('')).toBe('graph');
      expect(resolveActiveView('unknown-view')).toBe('graph');
    });

    it('builds view query string while preserving existing parameters', () => {
      const existing = new URLSearchParams('author=alice&path=src%2Findex.ts');

      const commitsQs = buildViewQueryString(existing, 'commits');
      expect(commitsQs).toContain('view=commits');
      expect(commitsQs).toContain('author=alice');
      expect(commitsQs).toContain('path=src%2Findex.ts');

      const graphQs = buildViewQueryString(existing, 'graph');
      expect(graphQs).toContain('view=graph');
      expect(graphQs).toContain('author=alice');
    });
  });

  describe('Home Page Repository Polling Lifecycle', () => {
    it('activates polling when any repository is running or queued', () => {
      const idleRepos = [
        { id: '1', analysisStatus: 'completed' as const },
        { id: '2', analysisStatus: null },
      ];
      expect(shouldPollRepositories(idleRepos, new Set())).toBe(false);

      const runningRepos = [
        { id: '1', analysisStatus: 'completed' as const },
        { id: '2', analysisStatus: 'running' as const },
      ];
      expect(shouldPollRepositories(runningRepos, new Set())).toBe(true);

      const queuedRepos = [
        { id: '1', analysisStatus: 'queued' as const },
        { id: '2', analysisStatus: 'failed' as const },
      ];
      expect(shouldPollRepositories(queuedRepos, new Set())).toBe(true);
    });

    it('activates polling when analyzingIds has pending requests', () => {
      const idleRepos = [{ id: '1', analysisStatus: 'completed' as const }];
      expect(shouldPollRepositories(idleRepos, new Set(['1']))).toBe(true);
    });

    it('cleans up analyzingIds when repository status updates to terminal or running state', () => {
      const analyzingIds = new Set(['repo-1', 'repo-2']);
      const updatedRepos = [
        { id: 'repo-1', analysisStatus: 'running' as const },
        { id: 'repo-3', analysisStatus: 'completed' as const },
      ];

      const pruned = pruneAnalyzingIds(analyzingIds, updatedRepos);
      expect(pruned.has('repo-1')).toBe(false);
      expect(pruned.has('repo-2')).toBe(true);
    });

    it('deactivates polling when all repositories reach completed or failed status', () => {
      const completedRepos = [
        { id: '1', analysisStatus: 'completed' as const },
        { id: '2', analysisStatus: 'failed' as const },
      ];
      expect(shouldPollRepositories(completedRepos, new Set())).toBe(false);
    });

    it('halts polling when consecutive error count reaches circuit breaker threshold', () => {
      expect(shouldHaltPollingOnErrors(0, 5)).toBe(false);
      expect(shouldHaltPollingOnErrors(4, 5)).toBe(false);
      expect(shouldHaltPollingOnErrors(5, 5)).toBe(true);
      expect(shouldHaltPollingOnErrors(6, 5)).toBe(true);
    });
  });

  describe('Commit Drawer Focus Trapping & Cycling', () => {
    const focusable = [{ id: 'close-btn' }, { id: 'file-1' }, { id: 'file-2' }];

    it('wraps focus from last element to first element on Tab', () => {
      const next = getNextTrappedFocus(focusable, 'file-2', false);
      expect(next?.id).toBe('close-btn');
    });

    it('advances focus forward on Tab', () => {
      const next = getNextTrappedFocus(focusable, 'close-btn', false);
      expect(next?.id).toBe('file-1');
    });

    it('wraps focus from first element to last element on Shift+Tab', () => {
      const next = getNextTrappedFocus(focusable, 'close-btn', true);
      expect(next?.id).toBe('file-2');
    });

    it('advances focus backward on Shift+Tab', () => {
      const next = getNextTrappedFocus(focusable, 'file-2', true);
      expect(next?.id).toBe('file-1');
    });

    it('returns null when no focusable elements exist', () => {
      const next = getNextTrappedFocus([], 'none', false);
      expect(next).toBeNull();
    });
  });
});
