export interface RetryPolicy {
  /** Maximum number of retry attempts (not counting the initial attempt). */
  maxAttempts: number;
  /** Base delay in milliseconds for exponential backoff. */
  baseDelayMs: number;
  /** Maximum delay between retries in milliseconds. */
  maxDelayMs: number;
  /** Maximum total time from first attempt to last retry (milliseconds). */
  maxRetryHorizonMs: number;
  /** Jitter factor (0–1). A delay of 1000ms with jitter 0.25 becomes 750–1250ms. */
  jitterFactor: number;
}

export const DEFAULT_DISPATCH_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 30_000,      // 30s
  maxDelayMs: 3_600_000,    // 1h
  maxRetryHorizonMs: 86_400_000, // 24h
  jitterFactor: 0.25,
};

/**
 * Compute the delay before the next retry attempt.
 *
 * Rules:
 * 1. Respect Retry-After as a MINIMUM delay.
 * 2. Apply exponential backoff: baseDelay * 2^(attempt - 1).
 * 3. Cap at maxDelayMs.
 * 4. Add jitter to prevent thundering herds.
 * 5. If the computed delay would exceed maxRetryHorizon, return null (give up).
 */
export function computeRetryDelay(
  attempt: number,
  firstAttemptAt: number,
  policy: RetryPolicy,
  retryAfterSeconds?: number,
): number | null {
  const now = Date.now();
  const elapsed = now - firstAttemptAt;

  // Check max retry horizon
  if (elapsed >= policy.maxRetryHorizonMs) {
    return null;
  }

  // Exponential backoff
  const exponential = policy.baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);

  // Jitter: multiply by [1 - jitterFactor, 1 + jitterFactor]
  const jitterRange = capped * policy.jitterFactor;
  const jitter = Math.random() * jitterRange * 2 - jitterRange;
  const backoffDelay = Math.max(0, Math.round(capped + jitter));

  // Respect Retry-After as minimum
  const minDelay = retryAfterSeconds ? retryAfterSeconds * 1000 : 0;
  const delay = Math.max(minDelay, backoffDelay);

  // Ensure we don't exceed maxRetryHorizon with this delay
  if (elapsed + delay >= policy.maxRetryHorizonMs) {
    return null;
  }

  return delay;
}
