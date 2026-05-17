import { Injectable, ConflictException, UnauthorizedException, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as nodemailer from 'nodemailer';
import type Redis from 'ioredis';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TenantRole } from '@prisma/client';

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const hash = await bcrypt.hash(dto.password, 12);

    const verificationToken = generateToken();
    const verificationTokenHash = hashToken(verificationToken);

    // Create user + default tenant in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          password_hash: hash,
          verification_token_hash: verificationTokenHash,
          verification_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        select: { id: true, email: true, created_at: true },
      });

      await tx.tenant.create({
        data: {
          name: `${dto.email.split('@')[0]}'s workspace`,
          members: {
            create: {
              user_id: user.id,
              role: TenantRole.owner,
            },
          },
        },
      });

      return user;
    });

    // Send verification email (fire and forget)
    this.sendVerificationEmail(result.email, verificationToken).catch(() => {});

    return { user: result, token: this.sign(result.id, result.email), needsOnboarding: true };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const memberships = await this.prisma.tenantMember.findMany({
      where: { user_id: user.id },
      select: { tenant: { select: { projects: { select: { id: true } } } } },
    });
    const projectCount = memberships.reduce((sum, m) => sum + m.tenant.projects.length, 0);

    return {
      user: { id: user.id, email: user.email },
      token: this.sign(user.id, user.email),
      needsOnboarding: projectCount === 0,
    };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Return success even if email doesn't exist to prevent enumeration
      return { message: 'If this email is registered, you will receive a reset link.' };
    }

    const token = generateToken();
    const tokenHash = hashToken(token);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        reset_token_hash: tokenHash,
        reset_token_expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    await this.sendPasswordResetEmail(user.email, token);

    return { message: 'If this email is registered, you will receive a reset link.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = hashToken(token);

    const user = await this.prisma.user.findUnique({
      where: { reset_token_hash: tokenHash },
    });

    if (!user || !user.reset_token_expires_at || user.reset_token_expires_at < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password_hash: newHash,
        reset_token_hash: null,
        reset_token_expires_at: null,
      },
    });

    return { message: 'Password updated successfully' };
  }

  async verifyEmail(token: string) {
    const tokenHash = hashToken(token);

    const user = await this.prisma.user.findUnique({
      where: { verification_token_hash: tokenHash },
    });

    if (!user || !user.verification_token_expires_at || user.verification_token_expires_at < new Date()) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email_verified: true,
        verification_token_hash: null,
        verification_token_expires_at: null,
      },
    });

    return { message: 'Email verified successfully' };
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.email_verified) return { message: 'Email already verified' };

    const token = generateToken();
    const tokenHash = hashToken(token);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verification_token_hash: tokenHash,
        verification_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await this.sendVerificationEmail(user.email, token);

    return { message: 'Verification email sent' };
  }

  async findOrCreateOAuthUser(params: {
    email: string;
    emailVerified: boolean;
    oauthProvider: string;
    oauthId: string;
  }) {
    const { email, emailVerified, oauthProvider, oauthId } = params;

    // 1. Try to find existing OAuth link
    const existingOAuth = await this.prisma.user.findUnique({
      where: { oauth_provider_oauth_id: { oauth_provider: oauthProvider, oauth_id: oauthId } },
    });
    if (existingOAuth) {
      return { id: existingOAuth.id, email: existingOAuth.email };
    }

    // 2. Try to find existing user by email
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      // Only link if the OAuth email is verified
      if (emailVerified) {
        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            oauth_provider: oauthProvider,
            oauth_id: oauthId,
            email_verified: true,
          },
        });
        return { id: existingUser.id, email: existingUser.email };
      }
      // Unverified email — don't link, create a new account
    }

    // 3. Create new user + tenant
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password_hash: '', // OAuth users have no password
          email_verified: emailVerified,
          oauth_provider: oauthProvider,
          oauth_id: oauthId,
        },
        select: { id: true, email: true },
      });

      await tx.tenant.create({
        data: {
          name: `${email.split('@')[0]}'s workspace`,
          members: {
            create: {
              user_id: user.id,
              role: TenantRole.owner,
            },
          },
        },
      });

      return user;
    });

    return { id: result.id, email: result.email };
  }

  sign(userId: string, email: string) {
    const expiresIn = this.config.get<string>('JWT_EXPIRATION', '15m');
    return this.jwt.sign(
      { sub: userId, email, jti: randomUUID() },
      { secret: this.config.get<string>('JWT_SECRET', 'fallback-secret'), expiresIn },
    );
  }

  async logout(token: string) {
    let payload: { jti?: string; exp?: number } | null = null;
    try {
      payload = this.jwt.decode(token) as { jti?: string; exp?: number } | null;
    } catch {
      // malformed token — nothing to blacklist
    }

    if (payload?.jti && payload?.exp) {
      const ttl = payload.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redis.set(`jwt:bl:${payload.jti}`, '1', 'EX', ttl);
      }
    }

    return { message: 'Logged out' };
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const val = await this.redis.get(`jwt:bl:${jti}`);
    return val !== null;
  }

  private getFromAddress(): string {
    const from = this.config.get<string>('SMTP_FROM');
    const user = this.config.get<string>('SMTP_USER');
    return from ?? (user ? `"Bug Intelligence Accounts" <${user}>` : 'accounts@bugintelligence.local');
  }

  private getMailTransporter() {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT') ?? 587;
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (!host || !user || !pass) return null;

    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  private async sendVerificationEmail(to: string, token: string) {
    const transporter = this.getMailTransporter();
    if (!transporter) return;

    const baseUrl = this.config.get<string>('DASHBOARD_URL', 'http://localhost:5173');
    const url = `${baseUrl}/verify-email?token=${token}`;

    await transporter.sendMail({
      from: this.getFromAddress(),
      to,
      subject: 'Verify your email address',
      text: `Click this link to verify your email: ${url}\n\nThis link expires in 24 hours.`,
      html: `<p>Click <a href="${url}">here</a> to verify your email address.</p><p>This link expires in 24 hours.</p>`,
    });
  }

  private async sendPasswordResetEmail(to: string, token: string) {
    const transporter = this.getMailTransporter();
    if (!transporter) return;

    const baseUrl = this.config.get<string>('DASHBOARD_URL', 'http://localhost:5173');
    const url = `${baseUrl}/reset-password?token=${token}`;

    await transporter.sendMail({
      from: this.getFromAddress(),
      to,
      subject: 'Reset your password',
      text: `Click this link to reset your password: ${url}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
      html: `<p>Click <a href="${url}">here</a> to reset your password.</p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
    });
  }
}
