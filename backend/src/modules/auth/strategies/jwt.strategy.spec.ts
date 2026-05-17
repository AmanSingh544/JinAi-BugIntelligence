import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { REDIS_CLIENT } from '../../../shared/redis/redis.provider';

const mockPrisma = () => ({
  user: { findUnique: jest.fn() },
});

const mockConfig = () => ({
  get: jest.fn().mockImplementation((key: string, def?: string) => {
    if (key === 'JWT_SECRET') return 'test-secret';
    return def;
  }),
});

const mockRedis = () => ({
  get: jest.fn(),
});

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: ReturnType<typeof mockPrisma>;
  let redis: ReturnType<typeof mockRedis>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useFactory: mockPrisma },
        { provide: ConfigService, useFactory: mockConfig },
        { provide: REDIS_CLIENT, useFactory: mockRedis },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
    prisma = module.get(PrismaService);
    redis = module.get(REDIS_CLIENT);
  });

  it('returns user when jti is not blacklisted and user exists', async () => {
    redis.get.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'test@example.com' });

    const result = await strategy.validate({ sub: 'u1', email: 'test@example.com', jti: 'valid-jti' });

    expect(result).toEqual({ sub: 'u1', email: 'test@example.com' });
    expect(redis.get).toHaveBeenCalledWith('jwt:bl:valid-jti');
  });

  it('throws UnauthorizedException when jti is blacklisted', async () => {
    redis.get.mockResolvedValue('1');

    await expect(
      strategy.validate({ sub: 'u1', email: 'test@example.com', jti: 'revoked-jti' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when user does not exist', async () => {
    redis.get.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'u1', email: 'test@example.com', jti: 'valid-jti' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('skips Redis check when token has no jti (legacy token)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'test@example.com' });

    const result = await strategy.validate({ sub: 'u1', email: 'test@example.com' });

    expect(redis.get).not.toHaveBeenCalled();
    expect(result).toEqual({ sub: 'u1', email: 'test@example.com' });
  });
});
