import { PartialType } from '@nestjs/swagger';
import { ConnectRepositoryDto } from './connect-repository.dto';

export class UpdateRepositoryDto extends PartialType(ConnectRepositoryDto) {}
