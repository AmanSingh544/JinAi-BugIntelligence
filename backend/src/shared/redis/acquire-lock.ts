import type Redis from 'ioredis';

/**
 * Acquire a distributed Redis lock using SET NX EX (atomic set-if-not-exists with expiry).
 *
 * @param redis      — Redis client instance
 * @param key        — Full lock key (caller is responsible for namespacing)
 * @param value      — Unique token (e.g. `${jobId}:${Date.now()}`) — must be used when releasing
 * @param ttlSeconds — Lock TTL in seconds (auto-expires if holder crashes)
 * @returns true if lock was acquired, false if already held by another worker
 */
export async function acquireLock(
  redis: Redis,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<boolean> {
  const result = await redis.set(key, value, 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}
