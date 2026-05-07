import { Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';

const REQUESTS_PER_MINUTE = 60;
const WINDOW_SECONDS = 60;

@Injectable()
export class IngestRateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async checkAndIncrement(projectId: string): Promise<void> {
    const key = `ratelimit:ingest:${projectId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
    if (count > REQUESTS_PER_MINUTE) {
      throw new HttpException(
        { message: 'Rate limit exceeded', retryAfter: WINDOW_SECONDS },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
