import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthorizationService } from './authorization.service';

@Global()
@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [AuthService, JwtStrategy, AuthorizationService],
  controllers: [AuthController],
  exports: [AuthorizationService],
})
export class AuthModule {}
