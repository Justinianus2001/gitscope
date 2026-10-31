import { describe, it, expect, vi } from 'vitest';
import { ApiError, api } from '../lib/api.js';

describe('Web API Client', () => {
  it('creates ApiError with correct status and error code', () => {
    const error = new ApiError(404, 'NOT_FOUND', 'Repository not found');
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Repository not found');
    expect(error.name).toBe('ApiError');
  });

  it('builds activity, hotspots, and co-changes query URLs and parses responses', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/activity')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                buckets: [
                  {
                    bucket: '2026-10-29',
                    date: '2026-10-29T00:00:00.000Z',
                    commitCount: 3,
                    distinctContributors: 1,
                  },
                ],
                interval: 'day',
                totalCommits: 3,
                totalContributors: 1,
                contributors: [],
                from: '2026-10-29T00:00:00.000Z',
                to: '2026-10-29T23:59:59.999Z',
              },
            }),
        });
      }
      if (url.includes('/hotspots')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  path: 'src/index.ts',
                  distinctCommits: 5,
                  totalAdditions: 40,
                  totalDeletions: 10,
                  lastChangedAt: '2026-10-29T12:00:00.000Z',
                },
              ],
            }),
        });
      }
      if (url.includes('/co-changes')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                pairs: [
                  {
                    pathA: 'src/a.ts',
                    pathB: 'src/b.ts',
                    coChangeCount: 2,
                    lastCoChangeAt: '2026-10-29T12:00:00.000Z',
                  },
                ],
                excludedLargeCommitsCount: 0,
                safetyThreshold: 200,
              },
            }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    global.fetch = mockFetch;

    const activity = await api.getActivity('12345678-1234-4234-8234-1234567890ab', {
      interval: 'day',
    });
    expect(activity.totalCommits).toBe(3);
    expect(mockFetch.mock.calls[0][0]).toContain('/activity?interval=day');

    const hotspots = await api.getHotspots('12345678-1234-4234-8234-1234567890ab', {
      limit: 10,
    });
    expect(hotspots[0].path).toBe('src/index.ts');
    expect(mockFetch.mock.calls[1][0]).toContain('/hotspots?limit=10');

    const coChanges = await api.getCoChanges('12345678-1234-4234-8234-1234567890ab', {
      minCount: 2,
    });
    expect(coChanges.pairs[0].coChangeCount).toBe(2);
    expect(mockFetch.mock.calls[2][0]).toContain('/co-changes?minCount=2');
  });

  it('omits Content-Type header when request has no body (e.g. analyzeRepository)', async () => {
    let capturedOptions: RequestInit | undefined;
    const mockFetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      capturedOptions = options;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              runId: '12345678-1234-4234-8234-1234567890ab',
              status: 'queued',
            },
          }),
      });
    });

    global.fetch = mockFetch;

    const res = await api.analyzeRepository('12345678-1234-4234-8234-1234567890ab');
    expect(res.status).toBe('queued');
    expect(res.runId).toBe('12345678-1234-4234-8234-1234567890ab');
    expect(capturedOptions?.method).toBe('POST');
    expect(capturedOptions?.body).toBeUndefined();
    expect((capturedOptions?.headers as Record<string, string>)?.['Content-Type']).toBeUndefined();
  });

  it('includes Content-Type: application/json when request has body (e.g. createRepository)', async () => {
    let capturedOptions: RequestInit | undefined;
    const mockFetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      capturedOptions = options;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              id: '12345678-1234-4234-8234-1234567890ab',
              name: 'demo-repo',
            },
          }),
      });
    });

    global.fetch = mockFetch;

    const res = await api.createRepository('/path/to/repo');
    expect(res.data.id).toBe('12345678-1234-4234-8234-1234567890ab');
    expect(capturedOptions?.method).toBe('POST');
    expect(capturedOptions?.body).toBe(JSON.stringify({ path: '/path/to/repo' }));
    expect((capturedOptions?.headers as Record<string, string>)?.['Content-Type']).toBe(
      'application/json',
    );
  });
});
