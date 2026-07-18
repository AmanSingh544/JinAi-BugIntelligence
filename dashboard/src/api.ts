import type { ProviderSchema } from '../../shared/provider-schema';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

function token() {
  return localStorage.getItem('token') ?? '';
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
      request<{ token: string; needsOnboarding: boolean }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string) =>
      request<{ token: string; needsOnboarding: boolean }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<{ id: string; email: string; emailVerified: boolean; memberships: { tenantId: string; role: string; projectIds: string[] }[] }>('/auth/me'),
    forgotPassword: (email: string) =>
      request<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    resetPassword: (token: string, newPassword: string) =>
      request<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      }),
    verifyEmail: (token: string) =>
      request<{ message: string }>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    resendVerification: () =>
      request<{ message: string }>('/auth/resend-verification', { method: 'POST' }),
    logout: () =>
      request<{ message: string }>('/auth/logout', { method: 'POST' }),
    refresh: () =>
      request<{ token: string }>('/auth/refresh', { method: 'POST' }),
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
    list: (projectId: string, page = 1, limit = 20) =>
      request<{ items: RawSession[]; total: number }>(`/projects/${projectId}/sessions?page=${page}&limit=${limit}`).then((res) => ({
        items: res.items.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          startedAt: r.started_at,
          endedAt: r.ended_at,
          userAgent: r.user_agent,
          initialUrl: r.initial_url,
        } as Session)),
        total: res.total,
      })),
    replay: (projectId: string, sessionId: string) =>
      request<{ events: unknown[] }>(`/projects/${projectId}/sessions/${sessionId}/replay`),
    timeline: (projectId: string, sessionId: string, limit = 200) =>
      request<{ events: TimelineEvent[] }>(`/projects/${projectId}/sessions/${sessionId}/timeline?limit=${limit}`),
  },

  bugs: {
    list: (projectId: string, params?: Record<string, string | string[] | number | undefined>) => {
      const q = new URLSearchParams();
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            for (const v of value) q.append(key, String(v));
          } else {
            q.set(key, String(value));
          }
        }
      }
      const qs = q.toString();
      return request<{ items: RawBug[]; total: number }>(`/projects/${projectId}/bugs${qs ? `?${qs}` : ''}`).then((res) => ({
        items: res.items.map(mapBug),
        total: res.total,
      }));
    },
    get: (projectId: string, bugId: string) =>
      request<RawBugDetail>(`/projects/${projectId}/bugs/${bugId}`).then(mapBugDetail),
    update: (
      projectId: string,
      bugId: string,
      fields: { summary?: string; rootCause?: string; fixSuggestion?: string; stepsToReproduce?: string[] },
    ) =>
      request<RawBug>(`/projects/${projectId}/bugs/${bugId}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      }).then(mapBug),
    updateStatus: (projectId: string, bugId: string, status: string) =>
      request<RawBug>(`/projects/${projectId}/bugs/${bugId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }).then(mapBug),
    assign: (projectId: string, bugId: string, userId: string) =>
      request<RawBug>(`/projects/${projectId}/bugs/${bugId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ userId }),
      }).then(mapBug),
    bulkStatus: (projectId: string, bugIds: string[], status: string) =>
      request<{ updated: number }>(`/projects/${projectId}/bugs/bulk-status`, {
        method: 'POST',
        body: JSON.stringify({ bugIds, status }),
      }),
    archiveOld: (projectId: string, daysOld?: number) =>
      request<{ jobId: string; message: string }>(`/projects/${projectId}/bugs/archive-old`, {
        method: 'POST',
        body: JSON.stringify({ daysOld }),
      }),
    unarchive: (projectId: string, bugId: string) =>
      request<RawBug>(`/projects/${projectId}/bugs/${bugId}/unarchive`, { method: 'POST' }).then(mapBug),
    similar: (projectId: string, bugId: string) =>
      request<{ similar: SimilarBug[] }>(`/projects/${projectId}/bugs/${bugId}/similar`),
    clusterMembers: (projectId: string, bugId: string) =>
      request<{ members: ClusterMember[] }>(`/projects/${projectId}/bugs/${bugId}/cluster-members`),
    chat: {
      getThread: (projectId: string, bugId: string) =>
        request<ChatThread>(`/projects/${projectId}/bugs/${bugId}/chat`),
      sendMessage: (projectId: string, bugId: string, message: string) =>
        request<ChatMessage>(`/projects/${projectId}/bugs/${bugId}/chat`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        }),
    },
    fixAttempts: {
      list: (projectId: string, bugId: string) =>
        request<{ attempts: FixAttempt[] }>(`/projects/${projectId}/bugs/${bugId}/fix-attempts`),
      trigger: (projectId: string, bugId: string, requireApproval = true) =>
        request<{ message: string; bugId: string }>(`/projects/${projectId}/bugs/${bugId}/fix-attempts`, {
          method: 'POST',
          body: JSON.stringify({ requireApproval }),
        }),
      cancel: (projectId: string, bugId: string, attemptId: string) =>
        request<FixAttempt>(`/projects/${projectId}/bugs/${bugId}/fix-attempts/${attemptId}/cancel`, {
          method: 'PATCH',
        }),
    },
  },

  environments: {
    list: (projectId: string) => request<Environment[]>(`/projects/${projectId}/environments`),
    update: (projectId: string, envId: string, dto: Partial<UpdateEnvironmentDto>) =>
      request<Environment>(`/projects/${projectId}/environments/${envId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }),
  },

  releases: {
    list: (projectId: string, page = 1, limit = 20) =>
      request<{ items: Release[]; total: number }>(`/projects/${projectId}/releases?page=${page}&limit=${limit}`).then((res) => ({
        items: res.items,
        total: res.total,
      })),
    create: (projectId: string, body: { version: string; metadata?: Record<string, unknown> }) =>
      request<Release>(`/projects/${projectId}/releases`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    listSourcemaps: (projectId: string, releaseId: string, limit = 50, offset = 0) =>
      request<{ items: ReleaseSourcemap[]; total: number; limit: number; offset: number }>(
        `/projects/${projectId}/releases/${releaseId}/sourcemaps?limit=${limit}&offset=${offset}`
      ),
  },

  integrations: {
    list: (projectId: string) => request<Integration[]>(`/projects/${projectId}/integrations`),
    create: (projectId: string, body: { provider_id: string; config: Record<string, unknown>; is_active?: boolean }) =>
      request<Integration>(`/projects/${projectId}/integrations`, { method: 'POST', body: JSON.stringify(body) }),
    update: (projectId: string, id: string, body: { config?: Record<string, unknown>; is_active?: boolean }) =>
      request<Integration>(`/projects/${projectId}/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (projectId: string, id: string) => request<void>(`/projects/${projectId}/integrations/${id}`, { method: 'DELETE' }),
    validate: (projectId: string, id: string) =>
      request<{ valid: boolean; error?: string }>(`/projects/${projectId}/integrations/${id}/validate`, { method: 'POST' }),
    providers: () => request<ProviderSchema[]>('/integrations/providers'),
  },

  clusters: {
    list: (projectId: string, page = 1, limit = 20) =>
      request<{ clusters: Cluster[]; total: number; page: number; limit: number }>(
        `/projects/${projectId}/clusters?page=${page}&limit=${limit}`
      ),
    detail: (projectId: string, clusterId: string, days?: number) =>
      request<{ cluster: ClusterDetail; bugs: ClusterBug[]; trend: TrendPoint[] }>(
        `/projects/${projectId}/clusters/${clusterId}${days ? `?days=${days}` : ''}`
      ),
  },

  notifications: {
    list: (params?: { unreadOnly?: boolean; limit?: number; offset?: number }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ items: UserNotification[]; total: number; unreadCount: number }>(`/notifications${q ? `?${q}` : ''}`);
    },
    unreadCount: () => request<{ unreadCount: number }>('/notifications/unread-count'),
    markAsRead: (id: string) => request<void>(`/notifications/${id}/read`, { method: 'PATCH' }),
    markAllAsRead: () => request<void>('/notifications/read-all', { method: 'PATCH' }),
    delete: (id: string) => request<void>(`/notifications/${id}`, { method: 'DELETE' }),
  },

  repository: {
    get: (projectId: string) =>
      request<ProjectRepository>(`/projects/${projectId}/repository`),
    connect: (projectId: string, dto: ConnectRepositoryDto) =>
      request<ProjectRepository>(`/projects/${projectId}/repository`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    update: (projectId: string, dto: Partial<ConnectRepositoryDto>) =>
      request<ProjectRepository>(`/projects/${projectId}/repository`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }),
    disconnect: (projectId: string) =>
      request<{ message: string }>(`/projects/${projectId}/repository`, { method: 'DELETE' }),
    validate: (projectId: string) =>
      request<{ valid: boolean; message: string }>(`/projects/${projectId}/repository/validate`),
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
  regressionDetectedAt?: string;
  assignee?: { id: string; email: string };
  regressionRelease?: { id: string; version: string };
  archivedAt?: string;
  createdAt: string;
}

export interface BugDetail extends Bug {
  rootCause: string;
  stepsToReproduce: string[];
  fixSuggestion: string;
  aiModelVersion: string;
  aiConfidence?: number;
  screenshotUrl?: string;
  regressionDetectedAt?: string;
  assignee?: { id: string; email: string };
  regressionRelease?: { id: string; version: string };
  release?: { id: string; version: string };
  archivedAt?: string;
  fixStatus?: string | null;
  error: {
    message: string;
    stack?: string;
  };
  cluster?: {
    id: string;
    occurrenceCount: number;
  };
}

export interface SimilarBug {
  id: string;
  summary: string | null;
  severity: string | null;
  status: string;
  createdAt: string;
  distance: number;
}

export interface ClusterMember {
  id: string;
  summary: string | null;
  severity: string | null;
  status: string;
  createdAt: string;
  errorMessage: string;
}

export interface Cluster {
  id: string;
  occurrenceCount: number;
  lastSeenAt: string;
  createdAt: string;
  bug?: { id: string; summary: string | null; severity: string | null; status: string };
  uniqueSessions: number;
}

export interface ClusterDetail {
  id: string;
  occurrenceCount: number;
  lastSeenAt: string;
  createdAt: string;
  bug?: { id: string; summary: string | null; severity: string | null; status: string };
}

export interface ClusterBug {
  id: string;
  summary: string | null;
  severity: string | null;
  status: string;
  createdAt: string;
  errorMessage: string;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface TimelineEvent {
  id: string;
  type: string;
  timestamp: number;
  url: string;
  payload: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  bugId: string;
  messages: ChatMessage[];
}

export interface Environment {
  id: string;
  project_id: string;
  name: string;
  config_version: number;
  sampling_click: number;
  sampling_navigation: number;
  sampling_console: number;
  sampling_api: number;
  sampling_error: number;
  replay_enabled: boolean;
  screenshot_on_error: boolean;
  created_at: string;
}

export interface UpdateEnvironmentDto {
  sampling_click?: number;
  sampling_navigation?: number;
  sampling_console?: number;
  sampling_api?: number;
  sampling_error?: number;
  replay_enabled?: boolean;
  screenshot_on_error?: boolean;
}

export interface Release {
  id: string;
  project_id: string;
  version: string;
  sourcemap: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ReleaseSourcemap {
  id: string;
  release_id: string;
  minified_filename: string;
  declared_file: string | null;
  sourcemap_size: number | null;
  content_hash: string | null;
  sourcemap_parsed: boolean;
  sourcemap_error: string | null;
  parse_warnings: string[] | null;
  uploaded_at: string;
}

export interface Integration {
  id: string;
  project_id: string;
  provider_id: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface UserNotification {
  id: string;
  project_id: string;
  project: { id: string; name: string };
  bug_id?: string;
  bug?: { id: string; summary: string };
  type: string;
  title: string;
  body?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  read_at?: string;
  created_at: string;
}

interface RawBug {
  id: string;
  project_id: string;
  session_id: string;
  summary: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  archived_at?: string;
  created_at: string;
}

interface RawBugDetail extends RawBug {
  root_cause: string;
  steps_to_reproduce: string[];
  fix_suggestion: string;
  ai_model_version: string;
  fix_status?: string | null;
  error: { message: string; stack?: string };
  cluster?: { id: string; occurrenceCount: number };
}

export interface ProjectRepository {
  id: string;
  project_id: string;
  github_owner: string;
  github_repo: string;
  default_branch: string;
  source_root_prefix: string;
  path_overrides: Record<string, string>;
  installation_id: number;
  merge_strategy: string;
  auto_merge_enabled: boolean;
  min_severity: string;
  fix_confidence_min: number;
  created_at: string;
  updated_at: string;
}

export interface ConnectRepositoryDto {
  github_owner: string;
  github_repo: string;
  default_branch?: string;
  source_root_prefix?: string;
  path_overrides?: Record<string, string>;
  installation_id: number;
  merge_strategy?: string;
  auto_merge_enabled?: boolean;
  min_severity?: string;
  fix_confidence_min?: number;
}

export interface FixAttempt {
  id: string;
  bug_id: string;
  repository_id: string;
  attempt_number: number;
  status: 'generating' | 'validating' | 'validated' | 'pr_open' | 'merged' | 'failed' | 'cancelled';
  target_file: string | null;
  start_line: number | null;
  end_line: number | null;
  original_code: string | null;
  fixed_code: string | null;
  fix_explanation: string | null;
  fix_confidence: number | null;
  branch_name: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_merged_at: string | null;
  validation_passed: boolean | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

function mapBug(r: RawBug): Bug {
  return {
    id: r.id,
    projectId: r.project_id,
    sessionId: r.session_id,
    summary: r.summary,
    severity: r.severity,
    status: r.status,
    archivedAt: r.archived_at,
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
    fixStatus: r.fix_status,
    error: r.error,
    cluster: r.cluster,
  };
}
