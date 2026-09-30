import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import pino from 'pino';

const { customLevels, logMeasurement, MEASURE_LEVEL, resolveLogTargetLevels, TRANSPORT_LEVELS } = await import(
  '../dist/infrastructure/log-levels.js'
);

describe('log-levels: resolveLogTargetLevels', () => {
  it('info/warn keep the terminal at LOG_LEVEL and the file at measure', () => {
    assert.deepEqual(resolveLogTargetLevels('info'), { logger: 'measure', stdout: 'info', file: 'measure' });
    assert.deepEqual(resolveLogTargetLevels('warn'), { logger: 'measure', stdout: 'warn', file: 'measure' });
  });

  it('debug/trace already include measure on both targets', () => {
    assert.deepEqual(resolveLogTargetLevels('debug'), { logger: 'debug', stdout: 'debug', file: 'debug' });
    assert.deepEqual(resolveLogTargetLevels('trace'), { logger: 'trace', stdout: 'trace', file: 'trace' });
  });

  it('unknown levels fall back to info; silent stays silent', () => {
    assert.deepEqual(resolveLogTargetLevels('verbose'), { logger: 'measure', stdout: 'info', file: 'measure' });
    assert.equal(resolveLogTargetLevels('silent').logger, 'silent');
  });
});

describe('log-levels: logMeasurement', () => {
  it('uses the measure level when the logger defines it', () => {
    const calls = [];
    logMeasurement(
      { measure: (...args) => calls.push(['measure', ...args]), debug: (...args) => calls.push(['debug', ...args]) },
      { a: 1 },
      'm',
    );
    assert.deepEqual(calls, [['measure', { a: 1 }, 'm']]);
  });

  it('falls back to debug (never info) on plain loggers', () => {
    const calls = [];
    logMeasurement({ debug: (...args) => calls.push(['debug', ...args]) }, { a: 1 }, 'm');
    assert.deepEqual(calls, [['debug', { a: 1 }, 'm']]);
  });
});

describe('log-levels: worker transport split', () => {
  it('writes measure records to the file target only; info reaches both', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-levels-'));
    try {
      const terminal = join(dir, 'terminal.log');
      const file = join(dir, 'file.log');
      const levels = resolveLogTargetLevels('info');
      const transport = pino.transport({
        levels: TRANSPORT_LEVELS,
        targets: [
          { target: 'pino/file', options: { destination: terminal }, level: levels.stdout },
          { target: 'pino/file', options: { destination: file }, level: levels.file },
        ],
      });
      const log = pino({ level: levels.logger, customLevels }, transport);
      log.debug('dropped everywhere');
      log.measure({ measurement: 'probe' }, 'measured');
      log.info('visible');
      await new Promise((resolve) => {
        transport.on('close', resolve);
        log.flush();
        transport.end();
      });

      const read = (path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      assert.deepEqual(
        read(terminal).map((r) => r.msg),
        ['visible'],
      );
      const fileRecords = read(file);
      assert.deepEqual(
        fileRecords.map((r) => r.msg),
        ['measured', 'visible'],
      );
      assert.equal(fileRecords[0].level, MEASURE_LEVEL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
