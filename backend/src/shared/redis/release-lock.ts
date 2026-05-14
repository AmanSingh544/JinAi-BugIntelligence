import type Redis from 'ioredis';

/**
 * Atomic Lua script for compare-and-delete.
 * Only deletes the key if its current value matches the provided token.
 * This prevents a stale worker from deleting a lock that was re-acquired
 * by another process after TTL expiry.
 */
const UNLOCK_LUA = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

/**
 * Release a distributed Redis lock atomically.
 *
 * @param redis — Redis client instance
 * @param key   — Full lock key
 * @param value — Unique token that was used during acquireLock
 *
 * Swallows errors — if release fails after successful work, the TTL will
 * eventually clean up. We log but never throw so the caller's success
 * is not invalidated by a cleanup failure.
 */
export async function releaseLock(
  redis: Redis,
  key: string,
  value: string,
): Promise<void> {
  await redis.eval(UNLOCK_LUA, 1, key, value);
}
