import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';

const TOKEN_CACHE_TTL_SECONDS = 55 * 60; // 55 min — 5 min buffer before 1-hour expiry
const RATELIMIT_CAPACITY = 4500;
const RATELIMIT_WINDOW_SECONDS = 3600;

export interface GitHubInstallationToken {
  token: string;
  expiresAt: string;
}

@Injectable()
export class GitHubAppService {
  private readonly logger = new Logger(GitHubAppService.name);
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly webhookSecret: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.appId = this.config.get<string>('GITHUB_APP_ID') ?? '';
    this.privateKey = (this.config.get<string>('GITHUB_APP_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n');
    this.webhookSecret = this.config.get<string>('GITHUB_WEBHOOK_SECRET') ?? '';
  }

  // ─── JWT for GitHub App auth ──────────────────────────────────────────────

  private generateAppJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // 60s in the past to allow for clock drift
      exp: now + 600, // 10-minute expiry (max allowed by GitHub)
      iss: this.appId,
    };

    // Manual JWT construction using RS256
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${header}.${body}`;

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signingInput);
    const signature = sign.sign(this.privateKey, 'base64url');

    return `${signingInput}.${signature}`;
  }

  // ─── Installation token (cached in Redis) ─────────────────────────────────

  async getInstallationToken(installationId: number): Promise<string> {
    const cacheKey = `github:token:${installationId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    await this.consumeRateLimit(installationId);

    const jwt = this.generateAppJwt();
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to get GitHub installation token [${response.status}]: ${body}`);
    }

    const data = (await response.json()) as GitHubInstallationToken;
    await this.redis.setex(cacheKey, TOKEN_CACHE_TTL_SECONDS, data.token);
    this.logger.debug(`Fetched installation token for installation=${installationId}`);
    return data.token;
  }

  // ─── GitHub API helper with automatic token + retry ──────────────────────

  async apiRequest(
    installationId: number,
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    // Retry schedule: 0s / 30s / 5m / 30m (4 attempts total)
    const backoffMs = [0, 30_000, 5 * 60_000, 30 * 60_000];

    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < backoffMs.length; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, backoffMs[attempt]));
      }

      await this.consumeRateLimit(installationId);
      const token = await this.getInstallationToken(installationId);
      const response = await fetch(`https://api.github.com${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
        },
      });

      // Success or a non-retriable client error — return immediately
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response;
      }

      // 429: respect Retry-After header before next attempt
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') ?? '60', 10);
        this.logger.warn(`GitHub 429 for installation=${installationId} — waiting ${retryAfter}s (Retry-After header)`);
        // Drain the rate limit bucket to 0 so subsequent calls also back off
        await this.redis.set(`github:ratelimit:${installationId}`, RATELIMIT_CAPACITY + 1, 'EX', retryAfter);
        if (attempt < backoffMs.length - 1) {
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
      }

      lastResponse = response;
      this.logger.warn(`GitHub API ${path} returned ${response.status} — attempt ${attempt + 1}/${backoffMs.length}`);
    }

    // All attempts exhausted — return the last response so callers can inspect status
    return lastResponse!;
  }

  // ─── Rate limit: per-installation token bucket ───────────────────────────

  private async consumeRateLimit(installationId: number): Promise<void> {
    const key = `github:ratelimit:${installationId}`;
    const used = await this.redis.incr(key);
    if (used === 1) {
      await this.redis.expire(key, RATELIMIT_WINDOW_SECONDS);
    }
    if (used > RATELIMIT_CAPACITY) {
      const ttl = await this.redis.ttl(key);
      throw new Error(`GitHub rate limit exceeded for installation=${installationId}. Resets in ${ttl}s`);
    }
  }

  // ─── Webhook signature verification ──────────────────────────────────────

  verifyWebhookSignature(payload: Buffer, signatureHeader: string): boolean {
    if (!signatureHeader.startsWith('sha256=')) return false;
    const expected = `sha256=${crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex')}`;
    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  // ─── App install URL ──────────────────────────────────────────────────────

  getInstallUrl(projectId: string): string {
    const appName = this.config.get<string>('GITHUB_APP_NAME') ?? '';
    return `https://github.com/apps/${appName}/installations/new?state=${projectId}`;
  }
}
