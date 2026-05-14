import { IsString, IsObject, IsBoolean, IsOptional } from 'class-validator';

export class CreateIntegrationDto {
  @IsString()
  provider_id!: string;

  @IsObject()
  config!: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
