import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';

@ApiTags('sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/sessions')
export class SessionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(@Param('projectId') projectId: string) {
    return this.prisma.session.findMany({
      where: { project_id: projectId },
      orderBy: { started_at: 'desc' },
      take: 100,
    });
  }
}
