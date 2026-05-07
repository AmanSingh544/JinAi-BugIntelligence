import type { ConsoleEvent } from '../shared/types';
import { generateId, getSessionId, sendEvent } from './shared';

(['log', 'warn', 'error'] as const).forEach((level) => {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    const message = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    sendEvent<ConsoleEvent>({
      id: generateId(),
      sessionId: getSessionId(),
      timestamp: Date.now(),
      type: 'console',
      url: location.href,
      payload: { level, message: message.slice(0, 1000) },
    });
  };
});
