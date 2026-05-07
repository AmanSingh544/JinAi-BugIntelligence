const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

function token() {
  return localStorage.getItem('token') ?? '';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...options?.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status}: ${err}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string) =>
      request<{ token: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
  },

  projects: {
    list: () => request<Project[]>('/projects'),
    create: (name: string, allowedOrigins: string[]) =>
      request<Project & { api_key: string }>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name, allowed_origins: allowedOrigins }),
      }),
    delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  },

  sessions: {
    list: (projectId: string) =>
      request<RawSession[]>(`/projects/${projectId}/sessions`).then((rows) =>
        rows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          startedAt: r.started_at,
          endedAt: r.ended_at,
          userAgent: r.user_agent,
          initialUrl: r.initial_url,
        } as Session))
      ),
  },

  bugs: {
    list: (projectId: string, params?: { status?: string; severity?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<RawBug[]>(`/projects/${projectId}/bugs${q ? `?${q}` : ''}`).then((rows) =>
        rows.map(mapBug)
      );
    },
    get: (projectId: string, bugId: string) =>
      request<RawBugDetail>(`/projects/${projectId}/bugs/${bugId}`).then(mapBugDetail),
    updateStatus: (projectId: string, bugId: string, status: string) =>
      request<RawBug>(`/projects/${projectId}/bugs/${bugId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }).then(mapBug),
  },
};

export interface Project {
  id: string;
  name: string;
  allowed_origins: string[];
  clustering_threshold: number;
  created_at: string;
}

interface RawSession {
  id: string;
  project_id: string;
  started_at: string;
  ended_at?: string;
  user_agent?: string;
  initial_url?: string;
}

export interface Session {
  id: string;
  projectId: string;
  startedAt: string;
  endedAt?: string;
  userAgent?: string;
  initialUrl?: string;
}

export interface Bug {
  id: string;
  projectId: string;
  sessionId: string;
  summary: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  createdAt: string;
}

export interface BugDetail extends Bug {
  rootCause: string;
  stepsToReproduce: string[];
  fixSuggestion: string;
  aiModelVersion: string;
  error: {
    message: string;
    stack?: string;
  };
  cluster?: {
    id: string;
    occurrenceCount: number;
  };
}

interface RawBug {
  id: string;
  project_id: string;
  session_id: string;
  summary: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  created_at: string;
}

interface RawBugDetail extends RawBug {
  root_cause: string;
  steps_to_reproduce: string[];
  fix_suggestion: string;
  ai_model_version: string;
  error: { message: string; stack?: string };
  cluster?: { id: string; occurrenceCount: number };
}

function mapBug(r: RawBug): Bug {
  return {
    id: r.id,
    projectId: r.project_id,
    sessionId: r.session_id,
    summary: r.summary,
    severity: r.severity,
    status: r.status,
    createdAt: r.created_at,
  };
}

function mapBugDetail(r: RawBugDetail): BugDetail {
  return {
    ...mapBug(r),
    rootCause: r.root_cause,
    stepsToReproduce: r.steps_to_reproduce ?? [],
    fixSuggestion: r.fix_suggestion,
    aiModelVersion: r.ai_model_version,
    error: r.error,
    cluster: r.cluster,
  };
}
