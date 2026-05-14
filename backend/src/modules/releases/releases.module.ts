import { Module } from '@nestjs/common';
import { ReleasesController } from './releases.controller';
import { SourcemapUploadService } from './sourcemap-upload.service';

@Module({
  controllers: [ReleasesController],
  providers: [SourcemapUploadService],
})
export class ReleasesModule {}
