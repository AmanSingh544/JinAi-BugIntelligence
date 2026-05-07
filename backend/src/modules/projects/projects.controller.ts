import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateProjectDto) {
    return this.projects.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUser('sub') userId: string) {
    return this.projects.findAll(userId);
  }

  @Get(':id')
  findOne(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.projects.findOne(userId, id);
  }

  @Post(':id/rotate-key')
  rotateKey(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.projects.rotateApiKey(userId, id);
  }
}
