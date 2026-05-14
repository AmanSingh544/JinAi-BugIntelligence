import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TenantRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const hash = await bcrypt.hash(dto.password, 12);

    // Create user + default tenant in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: dto.email, password_hash: hash },
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

    return { user: result, token: this.sign(result.id, result.email) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return {
      user: { id: user.id, email: user.email },
      token: this.sign(user.id, user.email),
    };
  }

  private sign(userId: string, email: string) {
    return this.jwt.sign(
      { sub: userId, email },
      { secret: this.config.get<string>('JWT_SECRET', 'fallback-secret') },
    );
  }
}
