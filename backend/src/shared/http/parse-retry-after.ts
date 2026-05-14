/**
 * Parse a Retry-After header value.
 * Returns delay in seconds, or undefined if not parseable.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  // Retry-After: 120  (seconds)
  const asSeconds = parseInt(trimmed, 10);
  if (!Number.isNaN(asSeconds) && String(asSeconds) === trimmed) {
    return asSeconds;
  }

  // Retry-After: Wed, 21 Oct 2025 07:28:00 GMT  (HTTP-date)
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const delta = Math.ceil((asDate - Date.now()) / 1000);
    return Math.max(0, delta);
  }

  return undefined;
}
