import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);
  readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID', '');
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET', '');
    const enabled = clientID.length > 0 && clientSecret.length > 0;

    super({
      clientID: enabled ? clientID : 'dummy-client-id',
      clientSecret: enabled ? clientSecret : 'dummy-client-secret',
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL', 'http://localhost:4000/api/v1/auth/google/callback'),
      scope: ['email', 'profile'],
    });

    this.enabled = enabled;
    if (!enabled) {
      this.logger.warn('Google OAuth is not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET). Google login will not work.');
    }
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ) {
    const email = profile.emails?.[0]?.value;
    const emailVerified = profile.emails?.[0]?.verified ?? false;
    const oauthId = profile.id;

    if (!email) return done(new Error('No email from Google'), false);

    const user = await this.authService.findOrCreateOAuthUser({
      email,
      emailVerified,
      oauthProvider: 'google',
      oauthId,
    });

    done(null, user);
  }
}
