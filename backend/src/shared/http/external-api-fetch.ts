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
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
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
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    throw new ProviderError({
      providerId,
      message: `HTTP ${res.status}: ${text}`,
      statusCode: res.status,
      retryAfterSeconds: retryAfter,
      responseBody: text,
    });
  }

  return res;
}
