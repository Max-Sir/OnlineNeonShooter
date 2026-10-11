export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** Minimal structured logger: one JSON object per line (easy to ship to any log pipeline). */
export function createLogger(
  level: LogLevel,
  sink: (line: string, lvl: LogLevel) => void = write,
): Logger {
  const threshold = order[level];
  const log =
    (lvl: LogLevel) =>
    (msg: string, fields?: Record<string, unknown>): void => {
      if (order[lvl] < threshold) return;
      sink(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields }), lvl);
    };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

function write(line: string, lvl: LogLevel): void {
  if (lvl === 'warn' || lvl === 'error') console.error(line);
  else console.log(line);
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
