import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export type EventType =
  | 'click'
  | 'input'
  | 'navigation'
  | 'api_request'
  | 'api_response'
  | 'error'
  | 'console'
  | 'replay_snapshot';

export class RawEventDto {
  @IsUUID()
  id: string;

  @IsUUID()
  sessionId: string;

  @IsNumber()
  timestamp: number;

  @IsIn(['click', 'input', 'navigation', 'api_request', 'api_response', 'error', 'console', 'replay_snapshot'])
  type: EventType;

  @IsString()
  @MaxLength(2048)
  url: string;

  @IsObject()
  payload: Record<string, unknown>;
}

export class BatchEventsDto {
  @IsUUID()
  sessionId: string;

  @IsOptional()
  @IsObject()
  sessionMeta?: {
    userAgent?: string;
    initialUrl?: string;
    release?: string;
  };

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RawEventDto)
  events: RawEventDto[];
}
