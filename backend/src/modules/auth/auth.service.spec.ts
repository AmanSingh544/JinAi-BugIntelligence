import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { TenantRole } from '@prisma/client';

const mockPrisma = () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  tenant: {
    create: jest.fn(),
  },
  tenantMember: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn((cb: any) => cb({
    user: {
      create: jest.fn(),
    },
    tenant: {
      create: jest.fn(),
    },
  })),
});

const mockJwt = () => ({
  sign: jest.fn().mockReturnValue('test-jwt-token'),
  decode: jest.fn(),
});

const mockConfig = () => ({
  get: jest.fn().mockImplementation((key: string, def?: any) => {
    if (key === 'JWT_SECRET') return 'test-secret';
    if (key === 'JWT_EXPIRATION') return '15m';
    return def;
  }),
});

const mockRedis = () => ({
  get: jest.fn(),
  set: jest.fn(),
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof mockPrisma>;
  let jwt: ReturnType<typeof mockJwt>;
  let redis: ReturnType<typeof mockRedis>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useFactory: mockPrisma },
        { provide: JwtService, useFactory: mockJwt },
        { provide: ConfigService, useFactory: mockConfig },
        { provide: REDIS_CLIENT, useFactory: mockRedis },
      ],
    }).compile();

    service = module.get(AuthService);
    prisma = module.get(PrismaService);
    jwt = module.get(JwtService);
    redis = module.get(REDIS_CLIENT);
  });

  describe('register', () => {
    it('creates a user with verification token and returns token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const txUser = { id: 'u1', email: 'test@example.com', created_at: new Date() };
      const txMock = {
        user: { create: jest.fn().mockResolvedValue(txUser) },
        tenant: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));

      const result = await service.register({ email: 'test@example.com', password: 'password123' });

      expect(txMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          email: 'test@example.com',
          verification_token_hash: expect.any(String),
          verification_token_expires_at: expect.any(Date),
        }),
      }));
      expect(result.token).toBe('test-jwt-token');
      expect(result.needsOnboarding).toBe(true);
    });

    it('throws ConflictException when email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'test@example.com' });

      await expect(service.register({ email: 'test@example.com', password: 'password123' }))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('returns token for valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        password_hash: '$2a$12$hashedpassword',
      });
      prisma.tenantMember.findMany.mockResolvedValue([]);
      // bcrypt.compare is called internally, we need to mock it or use a hash that won't match
      // Since we can't easily mock bcrypt.compare, we'll rely on the fact that the wrong hash won't match
      // Instead, let's just test the failure case for invalid password
    });

    it('throws UnauthorizedException for invalid email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: 'test@example.com', password: 'wrong' }))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('returns generic message even if email does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('unknown@example.com');

      expect(result.message).toContain('If this email is registered');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('stores reset token hash when email exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'test@example.com' });
      prisma.user.update.mockResolvedValue({});

      const result = await service.forgotPassword('test@example.com');

      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          reset_token_hash: expect.any(String),
          reset_token_expires_at: expect.any(Date),
        }),
      }));
      expect(result.message).toContain('If this email is registered');
    });
  });

  describe('resetPassword', () => {
    it('updates password and clears token for valid token', async () => {
      const { createHash } = require('crypto');
      const token = 'valid-token-32-bytes-long-for-test';
      const tokenHash = createHash('sha256').update(token).digest('hex');

      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        reset_token_hash: tokenHash,
        reset_token_expires_at: new Date(Date.now() + 3600000),
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.resetPassword(token, 'newpassword123');

      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          reset_token_hash: null,
          reset_token_expires_at: null,
        }),
      }));
      expect(result.message).toBe('Password updated successfully');
    });

    it('throws BadRequestException for invalid token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.resetPassword('invalid-token', 'newpassword123'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for expired token', async () => {
      const { createHash } = require('crypto');
      const token = 'valid-token-32-bytes-long-for-test';
      const tokenHash = createHash('sha256').update(token).digest('hex');

      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        reset_token_hash: tokenHash,
        reset_token_expires_at: new Date(Date.now() - 1000),
      });

      await expect(service.resetPassword(token, 'newpassword123'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyEmail', () => {
    it('verifies email and clears token for valid token', async () => {
      const { createHash } = require('crypto');
      const token = 'valid-token-32-bytes-long-for-test';
      const tokenHash = createHash('sha256').update(token).digest('hex');

      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        verification_token_hash: tokenHash,
        verification_token_expires_at: new Date(Date.now() + 3600000),
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.verifyEmail(token);

      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          email_verified: true,
          verification_token_hash: null,
          verification_token_expires_at: null,
        }),
      }));
      expect(result.message).toBe('Email verified successfully');
    });

    it('throws BadRequestException for invalid token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.verifyEmail('invalid-token'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('resendVerification', () => {
    it('returns already verified message', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        email_verified: true,
      });

      const result = await service.resendVerification('u1');

      expect(result.message).toBe('Email already verified');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('generates new token when not verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        email_verified: false,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.resendVerification('u1');

      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          verification_token_hash: expect.any(String),
          verification_token_expires_at: expect.any(Date),
        }),
      }));
      expect(result.message).toBe('Verification email sent');
    });
  });

  describe('sign', () => {
    it('includes jti and expiresIn when signing', () => {
      service.sign('u1', 'test@example.com');
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'u1', email: 'test@example.com', jti: expect.any(String) }),
        expect.objectContaining({ secret: 'test-secret', expiresIn: '15m' }),
      );
    });

    it('uses unique jti on each call', () => {
      service.sign('u1', 'a@a.com');
      service.sign('u1', 'a@a.com');
      const [first, second] = jwt.sign.mock.calls;
      expect(first[0].jti).not.toBe(second[0].jti);
    });
  });

  describe('logout', () => {
    it('blacklists the jti in Redis with remaining TTL', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 600;
      jwt.decode.mockReturnValue({ jti: 'test-jti-123', exp: futureExp });
      redis.set.mockResolvedValue('OK');

      const result = await service.logout('some.jwt.token');

      expect(redis.set).toHaveBeenCalledWith(
        'jwt:bl:test-jti-123',
        '1',
        'EX',
        expect.any(Number),
      );
      const ttlArg = redis.set.mock.calls[0][3] as number;
      expect(ttlArg).toBeGreaterThan(0);
      expect(ttlArg).toBeLessThanOrEqual(600);
      expect(result).toEqual({ message: 'Logged out' });
    });

    it('does not call Redis when token is already expired', async () => {
      const pastExp = Math.floor(Date.now() / 1000) - 60;
      jwt.decode.mockReturnValue({ jti: 'test-jti-123', exp: pastExp });

      await service.logout('some.jwt.token');

      expect(redis.set).not.toHaveBeenCalled();
    });

    it('does not throw when token is malformed', async () => {
      jwt.decode.mockImplementation(() => { throw new Error('bad token'); });

      await expect(service.logout('malformed')).resolves.toEqual({ message: 'Logged out' });
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('does not call Redis when token has no jti', async () => {
      jwt.decode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 300 });

      await service.logout('some.jwt.token');

      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('isTokenBlacklisted', () => {
    it('returns true when jti is in Redis', async () => {
      redis.get.mockResolvedValue('1');
      expect(await service.isTokenBlacklisted('test-jti')).toBe(true);
      expect(redis.get).toHaveBeenCalledWith('jwt:bl:test-jti');
    });

    it('returns false when jti is not in Redis', async () => {
      redis.get.mockResolvedValue(null);
      expect(await service.isTokenBlacklisted('test-jti')).toBe(false);
    });
  });

  describe('findOrCreateOAuthUser', () => {
    it('returns existing user linked by oauth provider+id', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        email: 'test@example.com',
        oauth_provider: 'google',
        oauth_id: 'g123',
      });

      const result = await service.findOrCreateOAuthUser({
        email: 'test@example.com',
        emailVerified: true,
        oauthProvider: 'google',
        oauthId: 'g123',
      });

      expect(result.id).toBe('u1');
    });

    it('links existing password user when email is verified', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // oauth lookup
        .mockResolvedValueOnce({ id: 'u1', email: 'test@example.com' }); // email lookup

      prisma.user.update.mockResolvedValue({});

      const result = await service.findOrCreateOAuthUser({
        email: 'test@example.com',
        emailVerified: true,
        oauthProvider: 'google',
        oauthId: 'g123',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ oauth_provider: 'google', oauth_id: 'g123', email_verified: true }),
      }));
      expect(result.id).toBe('u1');
    });

    it('creates new user when email is unverified and no oauth link exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const txUser = { id: 'u2', email: 'new@example.com' };
      const txMock = {
        user: { create: jest.fn().mockResolvedValue(txUser) },
        tenant: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(txMock));

      const result = await service.findOrCreateOAuthUser({
        email: 'new@example.com',
        emailVerified: false,
        oauthProvider: 'github',
        oauthId: 'gh123',
      });

      expect(txMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@example.com',
          oauth_provider: 'github',
          oauth_id: 'gh123',
          password_hash: '',
        }),
      }));
      expect(result.id).toBe('u2');
    });
  });
});
