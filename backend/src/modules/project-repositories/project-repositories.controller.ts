import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { ProjectRepositoriesService } from './project-repositories.service';
import { ConnectRepositoryDto } from './dto/connect-repository.dto';
import { UpdateRepositoryDto } from './dto/update-repository.dto';

@ApiTags('project-repositories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/repository')
export class ProjectRepositoriesController {
  constructor(private readonly service: ProjectRepositoriesService) {}

  @Post()
  @ApiOperation({ summary: 'Connect a GitHub repository to this project' })
  connect(@Param('projectId') projectId: string, @Body() dto: ConnectRepositoryDto) {
    return this.service.connect(projectId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get connected repository config' })
  findOne(@Param('projectId') projectId: string) {
    return this.service.findOne(projectId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update repository settings' })
  update(@Param('projectId') projectId: string, @Body() dto: UpdateRepositoryDto) {
    return this.service.update(projectId, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Disconnect repository from project' })
  disconnect(@Param('projectId') projectId: string) {
    return this.service.disconnect(projectId);
  }

  @Get('validate')
  @ApiOperation({ summary: 'Validate GitHub connection is working' })
  validate(@Param('projectId') projectId: string) {
    return this.service.validateConnection(projectId);
  }
}
