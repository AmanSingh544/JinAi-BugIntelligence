import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const client = new Redis(config.get<string>('REDIS_URL', 'redis://localhost:6379'), {
      maxRetriesPerRequest: null,
    });
    client.on('error', (err) => console.error('[Redis]', err.message));
    return client;
  },
};
