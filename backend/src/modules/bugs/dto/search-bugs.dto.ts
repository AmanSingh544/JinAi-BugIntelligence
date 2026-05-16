import { Transform, Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
} from 'class-validator';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

export class SearchBugsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : undefined,
  )
  @IsString({ each: true })
  severities?: string[];

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : undefined,
  )
  @IsString({ each: true })
  statuses?: string[];

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string; // 'me' | 'unassigned' | userId

  @IsOptional()
  @IsBooleanString()
  hasRegression?: string;

  @IsOptional()
  @IsIn(['created_at', 'severity', 'status'])
  sortBy?: string = 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string = 'desc';

  @IsOptional()
  @IsBooleanString()
  includeArchived?: string = 'false';
}
