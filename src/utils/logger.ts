export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /(token|secret|password|apikey|api_key|authorization)/i;
const MAX_DEPTH = 4;

function sanitize(value: unknown, depth: number): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return depth >= MAX_DEPTH ? '[...]' : value.map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    if (depth >= MAX_DEPTH) return '[...]';
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(inner, depth + 1);
    }
    return out;
  }
  return value;
}

export function createLogger(level: LogLevel, bindings: LogContext = {}): Logger {
  const threshold = LEVELS[level];

  const write = (lvl: LogLevel, message: string, context?: LogContext): void => {
    if (LEVELS[lvl] < threshold) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: lvl,
      message,
      ...(sanitize({ ...bindings, ...context }, 0) as Record<string, unknown>),
    });
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}

/** Logger que descarta todo; util para pruebas. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
