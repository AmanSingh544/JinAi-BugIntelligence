export type EventType =
  | 'click'
  | 'input'
  | 'navigation'
  | 'api_request'
  | 'api_response'
  | 'error'
  | 'console';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface BaseEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  type: EventType;
  url: string;
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  payload: {
    message: string;
    stack?: string;
    file?: string;
    line?: number;
    column?: number;
  };
}

export interface ApiRequestEvent extends BaseEvent {
  type: 'api_request';
  payload: {
    url: string;
    method: string;
    requestBody?: JsonValue;
  };
}

export interface ApiResponseEvent extends BaseEvent {
  type: 'api_response';
  payload: {
    url: string;
    method: string;
    status: number;
    duration: number;
    responseBody?: JsonValue;
  };
}

export interface ClickEvent extends BaseEvent {
  type: 'click';
  payload: {
    tag: string;
    text?: string;
    selector: string;
  };
}

export interface ConsoleEvent extends BaseEvent {
  type: 'console';
  payload: {
    level: 'log' | 'warn' | 'error';
    message: string;
  };
}

export interface NavigationEvent extends BaseEvent {
  type: 'navigation';
  payload: {
    from: string;
    to: string;
  };
}

export type RawEvent =
  | ErrorEvent
  | ApiRequestEvent
  | ApiResponseEvent
  | ClickEvent
  | ConsoleEvent
  | NavigationEvent;

export interface ExtensionConfig {
  apiKey: string;
  ingestUrl: string;
  enabled: boolean;
}
