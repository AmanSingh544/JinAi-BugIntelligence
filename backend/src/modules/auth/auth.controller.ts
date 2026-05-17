import { Body, Controller, Get, Post, UseGuards, Req, Res, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthRateLimitService } from '../../shared/rate-limit/auth-rate-limit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { PrismaService } from '../../shared/prisma/prisma.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  logout(@Headers('authorization') authHeader: string) {
    const token = authHeader?.replace(/^Bearer\s+/i, '') ?? '';
    return this.auth.logout(token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async me(@CurrentUser() user: { sub: string; email: string }) {
    const [memberships, userRecord] = await Promise.all([
      this.prisma.tenantMember.findMany({
        where: { user_id: user.sub },
        select: {
          tenant_id: true,
          role: true,
          tenant: { select: { projects: { select: { id: true } } } },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { email_verified: true },
      }),
    ]);
    return {
      id: user.sub,
      email: user.email,
      emailVerified: userRecord?.email_verified ?? false,
      memberships: memberships.map((m) => ({
        tenantId: m.tenant_id,
        role: m.role,
        projectIds: m.tenant.projects.map((p) => p.id),
      })),
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
      ?? req.ip
      ?? req.socket?.remoteAddress
      ?? 'unknown';
    await this.rateLimit.checkForgotPassword(dto.email, ip);
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async resendVerification(@CurrentUser() user: { sub: string }) {
    await this.rateLimit.checkResendVerification(user.sub);
    return this.auth.resendVerification(user.sub);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as { id: string; email: string };
    const token = this.auth.sign(user.id, user.email);
    const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
    res.redirect(`${dashboardUrl}/?token=${token}`);
  }

  @Get('github')
  @UseGuards(AuthGuard('github'))
  githubAuth() {}

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubAuthCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as { id: string; email: string };
    const token = this.auth.sign(user.id, user.email);
    const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
    res.redirect(`${dashboardUrl}/?token=${token}`);
  }
}
