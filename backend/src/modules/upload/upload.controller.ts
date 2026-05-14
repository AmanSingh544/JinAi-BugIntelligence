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
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { CurrentTenant } from '../../shared/tenant/current-tenant.decorator';
import type { TenantContext } from '../../shared/tenant/tenant-context';

const UPLOAD_DIR = './uploads/screenshots';

@ApiTags('upload')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard, TenantAuthGuard)
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

    // Link to latest error in session
    if (sessionId) {
      const latestError = await this.prisma.error.findFirst({
        where: { session_id: sessionId },
        orderBy: { created_at: 'desc' },
      });

      if (latestError) {
        await this.prisma.bug.updateMany({
          where: { error_id: latestError.id },
          data: { screenshot_url: url },
        });
      }
    }

    return { url };
  }
}
