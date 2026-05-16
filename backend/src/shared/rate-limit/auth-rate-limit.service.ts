import { Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';

const FORGOT_PASSWORD_WINDOW_SECONDS = 900; // 15 minutes
const FORGOT_PASSWORD_MAX_REQUESTS = 3;
const RESEND_VERIFY_WINDOW_SECONDS = 900; // 15 minutes
const RESEND_VERIFY_MAX_REQUESTS = 3;

@Injectable()
export class AuthRateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async checkForgotPassword(email: string, ip: string): Promise<void> {
    const key = `ratelimit:auth:forgot:${this.hash(email)}:${this.hash(ip)}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, FORGOT_PASSWORD_WINDOW_SECONDS);
    }
    if (count > FORGOT_PASSWORD_MAX_REQUESTS) {
      throw new HttpException(
        { message: 'Too many requests. Please try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async checkResendVerification(userId: string): Promise<void> {
    const key = `ratelimit:auth:resend-verify:${this.hash(userId)}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, RESEND_VERIFY_WINDOW_SECONDS);
    }
    if (count > RESEND_VERIFY_MAX_REQUESTS) {
      throw new HttpException(
        { message: 'Too many requests. Please try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
  }
}
