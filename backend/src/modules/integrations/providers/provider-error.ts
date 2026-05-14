import { parseRetryAfter as parseRetryAfterImpl } from '../../../shared/http/parse-retry-after';

export class ProviderError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;
  readonly isRateLimit: boolean;
  readonly isServerError: boolean;
  readonly providerId: string;

  constructor(opts: {
    message: string;
    providerId: string;
    statusCode: number;
    retryAfterSeconds?: number;
    responseBody?: string;
  }) {
    super(
      `[${opts.providerId}] ${opts.message}` +
        (opts.statusCode ? ` (status=${opts.statusCode})` : '') +
        (opts.retryAfterSeconds ? ` [Retry-After=${opts.retryAfterSeconds}s]` : ''),
    );
    this.name = 'ProviderError';
    this.providerId = opts.providerId;
    this.statusCode = opts.statusCode;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.isRateLimit = opts.statusCode === 429;
    this.isServerError = opts.statusCode >= 500 && opts.statusCode < 600;
  }
}

/**
 * Parse a Retry-After header value.
 * Returns delay in seconds, or undefined if not parseable.
 * @deprecated Import from `../../../shared/http/parse-retry-after` directly.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  return parseRetryAfterImpl(value);
}
