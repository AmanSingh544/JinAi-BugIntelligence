import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';

class UpdateStatusDto {
  @IsIn(['open', 'dispatched', 'resolved', 'ignored'])
  status!: string;
}

@ApiTags('bugs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/bugs')
export class BugsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(
    @Param('projectId') projectId: string,
    @Query('severity') severity?: string,
    @Query('status') status?: string,
  ) {
    return this.prisma.bug.findMany({
      where: {
        project_id: projectId,
        ...(severity ? { severity } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    });
  }

  @Get(':bugId')
  async findOne(@Param('projectId') projectId: string, @Param('bugId') bugId: string) {
    const bug = await this.prisma.bug.findFirstOrThrow({
      where: { id: bugId, project_id: projectId },
      include: {
        error: {
          include: {
            cluster: { select: { id: true, occurrence_count: true } },
          },
        },
      },
    });

    return {
      ...bug,
      cluster: bug.error.cluster
        ? { id: bug.error.cluster.id, occurrenceCount: bug.error.cluster.occurrence_count }
        : undefined,
    };
  }

  @Patch(':bugId/status')
  async updateStatus(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.prisma.bug.update({
      where: { id: bugId, project_id: projectId },
      data: { status: dto.status },
    });
  }
}
