import { Module } from '@nestjs/common';
import { ProjectRepositoriesController } from './project-repositories.controller';
import { ProjectRepositoriesService } from './project-repositories.service';
import { AutofixModule } from '../autofix/autofix.module';

@Module({
  imports: [AutofixModule],
  controllers: [ProjectRepositoriesController],
  providers: [ProjectRepositoriesService],
  exports: [ProjectRepositoriesService],
})
export class ProjectRepositoriesModule {}
