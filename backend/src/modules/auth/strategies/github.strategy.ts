import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GitHubStrategy extends PassportStrategy(Strategy, 'github') {
  private readonly logger = new Logger(GitHubStrategy.name);
  readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const clientID = config.get<string>('GITHUB_CLIENT_ID', '');
    const clientSecret = config.get<string>('GITHUB_CLIENT_SECRET', '');
    const enabled = clientID.length > 0 && clientSecret.length > 0;

    super({
      clientID: enabled ? clientID : 'dummy-client-id',
      clientSecret: enabled ? clientSecret : 'dummy-client-secret',
      callbackURL: config.get<string>('GITHUB_CALLBACK_URL', 'http://localhost:4000/api/v1/auth/github/callback'),
      scope: ['user:email'],
    });

    this.enabled = enabled;
    if (!enabled) {
      this.logger.warn('GitHub OAuth is not configured (missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET). GitHub login will not work.');
    }
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (err: Error | null, user?: any) => void,
  ) {
    const primaryEmail = profile.emails?.find((e: any) => e.primary) ?? profile.emails?.[0];
    const email = primaryEmail?.value;
    const emailVerified = primaryEmail?.verified ?? false;
    const oauthId = profile.id;

    if (!email) return done(new Error('No email from GitHub'), false);

    const user = await this.authService.findOrCreateOAuthUser({
      email,
      emailVerified,
      oauthProvider: 'github',
      oauthId,
    });

    done(null, user);
  }
}
