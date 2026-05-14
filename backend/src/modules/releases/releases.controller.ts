import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { ApiKeyOrJwtGuard } from '../../shared/guards/api-key-or-jwt.guard';
import { API_KEY_PROJECT } from '../../shared/guards/api-key.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CurrentTenant } from '../../shared/tenant/current-tenant.decorator';
import type { TenantContext } from '../../shared/tenant/tenant-context';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthorizationService } from '../auth/authorization.service';
import { SourcemapUploadService, normalizeMinifiedFilename } from './sourcemap-upload.service';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { validateSourcemap } from '../errors/stack-unminifier';
import type { Request } from 'express';

const UPLOAD_DIR = './uploads/sourcemaps';
const MAX_SOURCEMAP_SIZE = 50 * 1024 * 1024; // 50MB

@ApiTags('releases')
@ApiBearerAuth()
@Controller('projects/:projectId/releases')
export class ReleasesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly sourcemapUpload: SourcemapUploadService,
  ) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  @Get()
  @UseGuards(JwtAuthGuard, TenantAuthGuard)
  async list(@Param('projectId') projectId: string) {
    return this.prisma.release.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Create a new release.
   *
   * Preferred: JSON body with version and metadata.
   * Backward compat (migration-only): multipart with sourcemap file.
   */
  @Post()
  @UseGuards(ApiKeyOrJwtGuard)
  @ApiSecurity('api-key')
  @UseInterceptors(
    FileInterceptor('sourcemap', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}${extname(file.originalname)}`;
          cb(null, unique);
        },
      }),
      limits: { fileSize: MAX_SOURCEMAP_SIZE },
    }),
  )
  async create(
    @Param('projectId') projectId: string,
    @Body() body: { version: string; metadata?: string },
    @CurrentUser('sub') userId?: string,
    @CurrentTenant() tenant?: TenantContext,
    @Req() request?: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    // Auth check
    const apiKeyProject = (request as any)?.[API_KEY_PROJECT];
    if (apiKeyProject) {
      if (apiKeyProject.id !== projectId) {
        throw new ForbiddenException('API key does not match this project');
      }
    } else if (userId) {
      if (!(await this.authz.canManageProject(userId, projectId))) {
        throw new ForbiddenException('You do not have permission to create releases in this project');
      }
    } else {
      throw new ForbiddenException('Authentication required');
    }

    if (!body.version) {
      return { error: 'version is required' };
    }

    const sourcemapPath = file ? `${UPLOAD_DIR}/${file.filename}` : undefined;
    const sourcemapSize = file?.size;

    // Pre-validate sourcemap if uploaded (backward compat path)
    let sourcemapParsed = false;
    let sourcemapError: string | undefined;
    if (sourcemapPath) {
      try {
        const valid = await validateSourcemap(sourcemapPath);
        sourcemapParsed = valid;
        if (!valid) {
          sourcemapError = 'Sourcemap validation returned false';
        }
      } catch (err) {
        sourcemapParsed = false;
        sourcemapError = err instanceof Error ? err.message : 'Sourcemap parse failed';
      }
    }

    const release = await this.prisma.release.create({
      data: {
        project_id: projectId,
        version: body.version,
        sourcemap: sourcemapPath,
        sourcemap_size: sourcemapSize,
        sourcemap_parsed: sourcemapParsed,
        sourcemap_error: sourcemapError,
        metadata: body.metadata ? JSON.parse(body.metadata) : undefined,
      },
    });

    // If backward-compat sourcemap was uploaded, also create a ReleaseSourcemap record
    if (file && sourcemapPath) {
      try {
        const buffer = Buffer.from(require('fs').readFileSync(sourcemapPath));
        await this.sourcemapUpload.processSingleUpload(
          release.id,
          buffer,
          file.originalname,
        );
      } catch (err) {
        this.logger.warn(`Failed to migrate uploaded sourcemap to ReleaseSourcemap: ${(err as Error).message}`);
      }
    }

    return release;
  }

  /**
   * Upload a single sourcemap to an existing release.
   */
  @Post(':releaseId/sourcemaps')
  @UseGuards(ApiKeyOrJwtGuard)
  @ApiSecurity('api-key')
  @UseInterceptors(
    FileInterceptor('sourcemap', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}${extname(file.originalname)}`;
          cb(null, unique);
        },
      }),
      limits: { fileSize: MAX_SOURCEMAP_SIZE },
    }),
  )
  async uploadSourcemap(
    @Param('projectId') projectId: string,
    @Param('releaseId') releaseId: string,
    @Body() body: { minified_filename?: string; metadata?: string },
    @CurrentUser('sub') userId?: string,
    @Req() request?: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.verifyAuth(projectId, userId, request);
    await this.verifyReleaseOwnership(projectId, releaseId);

    if (!file) {
      throw new BadRequestException('sourcemap file is required');
    }

    const buffer = require('fs').readFileSync(`${UPLOAD_DIR}/${file.filename}`);
    const result = await this.sourcemapUpload.processSingleUpload(
      releaseId,
      buffer,
      file.originalname,
      body.minified_filename,
    );

    // Clean up the temp multer file
    try {
      require('fs').unlinkSync(`${UPLOAD_DIR}/${file.filename}`);
    } catch {
      // ignore
    }

    return result;
  }

  /**
   * Batch upload sourcemaps as a ZIP archive.
   */
  @Post(':releaseId/sourcemaps/batch')
  @UseGuards(ApiKeyOrJwtGuard)
  @ApiSecurity('api-key')
  @UseInterceptors(
    FileInterceptor('sourcemaps', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}${extname(file.originalname)}`;
          cb(null, unique);
        },
      }),
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB ZIP
    }),
  )
  async uploadSourcemapBatch(
    @Param('projectId') projectId: string,
    @Param('releaseId') releaseId: string,
    @CurrentUser('sub') userId?: string,
    @Req() request?: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.verifyAuth(projectId, userId, request);
    await this.verifyReleaseOwnership(projectId, releaseId);

    if (!file) {
      throw new BadRequestException('sourcemaps ZIP file is required');
    }

    const zipBuffer = require('fs').readFileSync(`${UPLOAD_DIR}/${file.filename}`);
    const results = await this.sourcemapUpload.processZipBatchUpload(releaseId, zipBuffer);

    // Clean up temp multer file
    try {
      require('fs').unlinkSync(`${UPLOAD_DIR}/${file.filename}`);
    } catch {
      // ignore
    }

    return { uploaded: results.length, items: results };
  }

  /**
   * List sourcemaps for a release (paginated).
   */
  @Get(':releaseId/sourcemaps')
  @UseGuards(JwtAuthGuard, TenantAuthGuard)
  async listSourcemaps(
    @Param('projectId') projectId: string,
    @Param('releaseId') releaseId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.verifyReleaseOwnership(projectId, releaseId);
    return this.sourcemapUpload.listSourcemaps(
      releaseId,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private readonly logger = new Logger(ReleasesController.name);

  private async verifyAuth(
    projectId: string,
    userId: string | undefined,
    request: Request | undefined,
  ) {
    const apiKeyProject = (request as any)?.[API_KEY_PROJECT];
    if (apiKeyProject) {
      if (apiKeyProject.id !== projectId) {
        throw new ForbiddenException('API key does not match this project');
      }
    } else if (userId) {
      if (!(await this.authz.canManageProject(userId, projectId))) {
        throw new ForbiddenException('You do not have permission to manage this project');
      }
    } else {
      throw new ForbiddenException('Authentication required');
    }
  }

  private async verifyReleaseOwnership(projectId: string, releaseId: string) {
    const release = await this.prisma.release.findUnique({ where: { id: releaseId } });
    if (!release || release.project_id !== projectId) {
      throw new ForbiddenException('Release not found in this project');
    }
  }
}
