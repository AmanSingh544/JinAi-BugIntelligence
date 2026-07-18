import {
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { ApiKeyGuard, API_KEY_PROJECT } from '../../shared/guards/api-key.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';

const UPLOAD_DIR = './uploads/screenshots';

// ApiKeyGuard only — this endpoint is called by the extension, which has no
// JWT user, so TenantAuthGuard (which requires one) would 403 every upload.
// The API key already scopes the request to exactly one project.
@ApiTags('upload')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly prisma: PrismaService) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  @Post('screenshot')
  @UseInterceptors(
    FileInterceptor('screenshot', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}${extname(file.originalname)}`;
          cb(null, unique);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    }),
  )
  async uploadScreenshot(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const project = req[API_KEY_PROJECT] as { id: string };
    const sessionId = req.body.sessionId as string | undefined;

    if (!file) {
      return { error: 'No file uploaded' };
    }

    const url = `/uploads/screenshots/${file.filename}`;

    if (sessionId) {
      // The upload usually arrives BEFORE the error batch is ingested (the
      // extension uploads immediately; events flush on a 5s timer), so the
      // screenshot is stored on the session — the AI worker copies it onto
      // the bug at creation time. The session may not exist yet either.
      await this.prisma.session.upsert({
        where: { id: sessionId },
        create: { id: sessionId, project_id: project.id, screenshot_url: url },
        update: { screenshot_url: url },
      });

      // Also link directly in case the bug already exists (repeat error).
      const latestError = await this.prisma.error.findFirst({
        where: { session_id: sessionId },
        orderBy: { created_at: 'desc' },
      });
      if (latestError) {
        await this.prisma.bug.updateMany({
          where: { error_id: latestError.id, screenshot_url: null },
          data: { screenshot_url: url },
        });
      }
    }

    return { url };
  }
}
