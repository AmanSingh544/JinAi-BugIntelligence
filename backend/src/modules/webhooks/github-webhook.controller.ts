import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GitHubAppService } from '../autofix/github-app.service';
import { GitHubWebhookService } from './github-webhook.service';

@ApiTags('webhooks')
@Controller('webhooks/github')
export class GitHubWebhookController {
  private readonly logger = new Logger(GitHubWebhookController.name);

  constructor(
    private readonly github: GitHubAppService,
    private readonly handler: GitHubWebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: any,
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') event: string,
  ) {
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody) throw new BadRequestException('Missing raw body');

    if (!this.github.verifyWebhookSignature(rawBody, signature ?? '')) {
      this.logger.warn(`Invalid webhook signature for event=${event}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    await this.handler.dispatch(event, payload);
    return { ok: true };
  }
}
