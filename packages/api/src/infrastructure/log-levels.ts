/**
 * Log level split: terminal stays at LOG_LEVEL, the rolling file also keeps
 * continuous measurement traces (F295/F297/F246 stage timings).
 *
 * Measurements fire on every poll, so at `info` they drowned the terminal
 * (~80% of lines). They sit on a custom `measure` level (25) between debug and
 * info: the stdout target filters at LOG_LEVEL, the file target at `measure`.
 *
 * Side-effect free on purpose — tests import this without creating log files.
 */

import type { LogFn } from 'pino';

export const MEASURE_LEVEL_NAME = 'measure';
export const MEASURE_LEVEL = 25;

export const customLevels = { [MEASURE_LEVEL_NAME]: MEASURE_LEVEL } as const;

const STANDARD_LEVELS: Readonly<Record<string, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** Full label → value map; pass to `pino.transport({ levels })` so workers resolve `measure`. */
export const TRANSPORT_LEVELS: Readonly<Record<string, number>> = { ...STANDARD_LEVELS, ...customLevels };

export interface LogTargetLevels {
  /** Logger threshold: the lowest level any target accepts. */
  readonly logger: string;
  readonly stdout: string;
  readonly file: string;
}

export function resolveLogTargetLevels(level: string): LogTargetLevels {
  if (level === 'silent') return { logger: 'silent', stdout: 'fatal', file: 'fatal' };
  const name = STANDARD_LEVELS[level] === undefined ? 'info' : level;
  if (STANDARD_LEVELS[name] < MEASURE_LEVEL) return { logger: name, stdout: name, file: name };
  return { logger: MEASURE_LEVEL_NAME, stdout: name, file: MEASURE_LEVEL_NAME };
}

export interface MeasurementLogger {
  debug: LogFn;
  measure?: LogFn;
}

/**
 * Emit a measurement trace. Loggers without the custom level (plain Fastify
 * test loggers) fall back to debug, never info, so the terminal stays quiet.
 */
export function logMeasurement(log: MeasurementLogger, fields: Record<string, unknown>, msg: string): void {
  if (typeof log.measure === 'function') {
    log.measure(fields, msg);
    return;
  }
  log.debug(fields, msg);
}
