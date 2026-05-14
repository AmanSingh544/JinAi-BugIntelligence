export const HTTP_CLIENT_DEFAULTS = {
  timeoutMs: 10_000,
  maxResponseBytes: 1_000_000,
  maxRedirects: 0, // 'manual' — never follow
} as const;
