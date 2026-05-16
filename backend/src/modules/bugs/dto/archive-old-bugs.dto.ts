import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ArchiveOldBugsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  daysOld = 90;
}
