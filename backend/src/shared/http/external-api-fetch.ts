import { ProviderError } from '../../modules/integrations/providers/provider-error';
import { HTTP_CLIENT_DEFAULTS } from './http-client.constants';
import { assertSafeExternalUrl } from './validate-external-url';
import { parseRetryAfter } from './parse-retry-after';

export interface ExternalApiFetchOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function externalApiFetch(
  providerId: string,
  options: ExternalApiFetchOptions,
): Promise<Response> {
  try {
    assertSafeExternalUrl(options.url);
  } catch (err) {
    throw new ProviderError({
      providerId,
      message: err instanceof Error ? err.message : 'URL validation failed',
      statusCode: 0,
    });
  }

  const timeoutMs = options.timeoutMs ?? HTTP_CLIENT_DEFAULTS.timeoutMs;

  // Compose timeout with caller's abort signal
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), {
      once: true,
    });
  }

  let res: Response;
  try {
    res = await fetch(options.url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: 'manual',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    throw new ProviderError({
      providerId,
      message: `Request failed: ${message}`,
      statusCode: 0,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    let retryAfter = parseRetryAfter(res.headers.get('retry-after'));

    // GitHub signals primary rate limits as 403 + X-RateLimit-Remaining: 0
    // (with the reset time as a unix timestamp) rather than a 429.
    const ghRateLimited =
      res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0';
    if (ghRateLimited && retryAfter === undefined) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      if (Number.isFinite(reset) && reset > 0) {
        retryAfter = Math.max(1, Math.ceil(reset - Date.now() / 1000));
      }
    }

    throw new ProviderError({
      providerId,
      message: `HTTP ${res.status}: ${text}`,
      statusCode: res.status,
      retryAfterSeconds: retryAfter,
      responseBody: text,
      rateLimit: ghRateLimited || undefined,
    });
  }

  return res;
}
