import { pino } from 'pino';
import { createApp } from '#src/app';

export const TEST_WEB_ORIGIN = 'http://localhost:5173';

export function buildTestApp() {
  return createApp({ config: { WEB_ORIGIN: TEST_WEB_ORIGIN }, logger: pino({ level: 'silent' }) });
}
