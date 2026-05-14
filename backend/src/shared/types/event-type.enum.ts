export enum EventType {
  CLICK = 'click',
  INPUT = 'input',
  NAVIGATION = 'navigation',
  API_REQUEST = 'api_request',
  API_RESPONSE = 'api_response',
  ERROR = 'error',
  CONSOLE = 'console',
  REPLAY_SNAPSHOT = 'replay_snapshot',
}

export const SAMPLABLE_EVENT_TYPES: EventType[] = [
  EventType.CLICK,
  EventType.INPUT,
  EventType.NAVIGATION,
  EventType.CONSOLE,
  EventType.API_REQUEST,
  EventType.API_RESPONSE,
];

export const ALWAYS_TRACKED_TYPES: EventType[] = [
  EventType.ERROR,
  EventType.REPLAY_SNAPSHOT,
];
