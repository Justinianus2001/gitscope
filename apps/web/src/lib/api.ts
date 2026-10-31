import type {
  RepositoryListItem,
  GetAnalysisResponse,
  GetCommitsQuery,
  GetCommitsResponse,
  CommitDetail,
  GetFileHistoryResponse,
  AnalysisStatus,
  GetGraphResponse,
  RefItem,
  GetRefsResponse,
  GetActivityQuery,
  GetActivityResponse,
  GetHotspotsQuery,
  GetHotspotsResponse,
  HotspotItem,
  GetCoChangesQuery,
  GetCoChangesResponse,
} from '@gitscope/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [key, value] of options.headers) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, options.headers);
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = json?.error || {};
    throw new ApiError(
      res.status,
      error.code || 'UNKNOWN_ERROR',
      error.message || `Request failed with status ${res.status}`,
    );
  }

  return json as T;
}

export const api = {
  async getRepositories(): Promise<RepositoryListItem[]> {
    const res = await request<{ data: RepositoryListItem[] }>('/api/repositories');
    return res.data;
  },

  async getRepository(id: string): Promise<RepositoryListItem> {
    const res = await request<{ data: RepositoryListItem }>(`/api/repositories/${id}`);
    return res.data;
  },

  async createRepository(
    path: string,
  ): Promise<{ data: RepositoryListItem; isExisting?: boolean }> {
    return request<{ data: RepositoryListItem; isExisting?: boolean }>('/api/repositories', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  async analyzeRepository(id: string): Promise<{ runId: string; status: AnalysisStatus }> {
    const res = await request<{ data: { runId: string; status: AnalysisStatus } }>(
      `/api/repositories/${id}/analyze`,
      { method: 'POST' },
    );
    return res.data;
  },

  async getAnalysisStatus(id: string): Promise<GetAnalysisResponse['data']> {
    const res = await request<GetAnalysisResponse>(`/api/repositories/${id}/analysis`);
    return res.data;
  },

  async getCommits(id: string, query: Partial<GetCommitsQuery> = {}): Promise<GetCommitsResponse> {
    const params = new URLSearchParams();
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.branch) params.set('branch', query.branch);
    if (query.author) params.set('author', query.author);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.path) params.set('path', query.path);

    const qs = params.toString();
    const endpoint = `/api/repositories/${id}/commits${qs ? `?${qs}` : ''}`;
    return request<GetCommitsResponse>(endpoint);
  },

  async getCommitDetail(id: string, hash: string): Promise<CommitDetail> {
    const res = await request<{ data: CommitDetail }>(`/api/repositories/${id}/commits/${hash}`);
    return res.data;
  },

  async getFileHistory(
    id: string,
    filePath: string,
    query: { limit?: number; cursor?: string } = {},
  ): Promise<GetFileHistoryResponse> {
    const params = new URLSearchParams();
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);

    const qs = params.toString();
    const encodedPath = encodeURIComponent(filePath);
    const endpoint = `/api/repositories/${id}/files/${encodedPath}/history${qs ? `?${qs}` : ''}`;
    return request<GetFileHistoryResponse>(endpoint);
  },

  async getGraph(
    id: string,
    query: { ref?: string; limit?: number } = {},
  ): Promise<GetGraphResponse['data']> {
    const params = new URLSearchParams();
    if (query.ref) params.set('ref', query.ref);
    if (query.limit) params.set('limit', String(query.limit));

    const qs = params.toString();
    const endpoint = `/api/repositories/${id}/graph${qs ? `?${qs}` : ''}`;
    const res = await request<GetGraphResponse>(endpoint);
    return res.data;
  },

  async getRefs(id: string): Promise<RefItem[]> {
    const res = await request<GetRefsResponse>(`/api/repositories/${id}/refs`);
    return res.data;
  },

  async getActivity(
    id: string,
    query: Partial<GetActivityQuery> = {},
  ): Promise<GetActivityResponse['data']> {
    const params = new URLSearchParams();
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.interval) params.set('interval', query.interval);

    const qs = params.toString();
    const endpoint = `/api/repositories/${id}/activity${qs ? `?${qs}` : ''}`;
    const res = await request<GetActivityResponse>(endpoint);
    return res.data;
  },

  async getHotspots(id: string, query: Partial<GetHotspotsQuery> = {}): Promise<HotspotItem[]> {
    const params = new URLSearchParams();
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.path) params.set('path', query.path);
    if (query.limit) params.set('limit', String(query.limit));

    const qs = params.toString();
    const endpoint = `/api/repositories/${id}/hotspots${qs ? `?${qs}` : ''}`;
    const res = await request<GetHotspotsResponse>(endpoint);
    return res.data;
  },

  async getCoChanges(
    id: string,
    query: Partial<GetCoChangesQuery> = {},
  ): Promise<GetCoChangesResponse['data']> {
    const params = new URLSearchParams();
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.path) params.set('path', query.path);
    if (query.minCount) params.set('minCount', String(query.minCount));
    if (query.limit) params.set('limit', String(query.limit));

    const qs = params.toString();
    const endpoint = `/api/repositories/${id}/co-changes${qs ? `?${qs}` : ''}`;
    const res = await request<GetCoChangesResponse>(endpoint);
    return res.data;
  },
};
