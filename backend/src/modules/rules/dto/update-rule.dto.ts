import {
  IsString,
  MinLength,
  IsIn,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RuleConditionDto {
  @IsIn(['error.severity', 'error.status_code', 'cluster.occurrences', 'session.unique_users'])
  field: 'error.severity' | 'error.status_code' | 'cluster.occurrences' | 'session.unique_users';

  @IsIn(['=', '>=', '<=', '>'])
  op: '=' | '>=' | '<=' | '>';

  value: string | number;
}

export class RuleConditionGroupDto {
  @IsIn(['all', 'any'])
  operator: 'all' | 'any';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  conditions: (RuleConditionDto | RuleConditionGroupDto)[];
}

export class UpdateRuleDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => Object)
  @IsOptional()
  conditions?: RuleConditionGroupDto | { all: RuleConditionDto[] };

  @IsIn(['auto_dispatch', 'ignore'])
  @IsOptional()
  action?: 'auto_dispatch' | 'ignore';

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
