import { IsString, MinLength, IsArray, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsArray()
  @IsOptional()
  allowed_origins?: string[];

  @IsBoolean()
  @IsOptional()
  block_unknown_origins?: boolean;

  @IsNumber()
  @IsOptional()
  clustering_threshold?: number;
}
