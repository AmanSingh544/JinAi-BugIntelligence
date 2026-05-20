import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class ConnectRepositoryDto {
  @ApiProperty({ example: 'acme-corp' })
  @IsString()
  github_owner: string;

  @ApiProperty({ example: 'frontend' })
  @IsString()
  github_repo: string;

  @ApiPropertyOptional({ example: 'main' })
  @IsOptional()
  @IsString()
  default_branch?: string;

  @ApiPropertyOptional({ example: 'packages/web', description: 'Monorepo path prefix' })
  @IsOptional()
  @IsString()
  source_root_prefix?: string;

  @ApiPropertyOptional({ example: { 'webpack:///./src/': 'src/' } })
  @IsOptional()
  @IsObject()
  path_overrides?: Record<string, string | null>;

  @ApiProperty({ example: 123456789, description: 'GitHub App installation ID' })
  @IsInt()
  installation_id: number;

  @ApiPropertyOptional({ example: 'squash', enum: ['squash', 'merge', 'rebase'] })
  @IsOptional()
  @IsString()
  merge_strategy?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  auto_merge_enabled?: boolean;

  @ApiPropertyOptional({ example: 'high', enum: ['low', 'medium', 'high', 'critical'] })
  @IsOptional()
  @IsString()
  min_severity?: string;

  @ApiPropertyOptional({ example: 0.75, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  fix_confidence_min?: number;
}
