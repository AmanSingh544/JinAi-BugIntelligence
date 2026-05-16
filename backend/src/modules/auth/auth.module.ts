import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GitHubStrategy } from './strategies/github.strategy';
import { AuthorizationService } from './authorization.service';
import { AuthRateLimitService } from '../../shared/rate-limit/auth-rate-limit.service';

@Global()
@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [AuthService, JwtStrategy, GoogleStrategy, GitHubStrategy, AuthorizationService, AuthRateLimitService],
  controllers: [AuthController],
  exports: [AuthorizationService],
})
export class AuthModule {}
