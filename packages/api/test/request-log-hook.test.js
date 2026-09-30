// @ts-check

import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import pino from 'pino';
import {
  registerRequestLogHook,
  resolveRequestLogLevel,
  SLOW_REQUEST_MS,
} from '../dist/infrastructure/request-log-hook.js';

describe('request-log-hook: resolveRequestLogLevel', () => {
  it('routine GET polling → debug', () => {
    assert.equal(resolveRequestLogLevel('GET', 200, 3), 'debug');
    assert.equal(resolveRequestLogLevel('get', 304, 3), 'debug');
    assert.equal(resolveRequestLogLevel('HEAD', 200, 1), 'debug');
  });

  it('errors → info', () => {
    assert.equal(resolveRequestLogLevel('GET', 404, 2), 'info');
    assert.equal(resolveRequestLogLevel('GET', 500, 2), 'info');
  });

  it('slow requests → info', () => {
    assert.equal(resolveRequestLogLevel('GET', 200, SLOW_REQUEST_MS), 'info');
  });

  it('state-changing methods → info', () => {
    assert.equal(resolveRequestLogLevel('POST', 200, 5), 'info');
    assert.equal(resolveRequestLogLevel('DELETE', 204, 5), 'info');
  });
});

describe('request-log-hook: registerRequestLogHook', () => {
  async function captureLogs(level) {
    const lines = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(
          ...chunk
            .toString()
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l)),
        );
        cb();
      },
    });
    const app = Fastify({ logger: pino({ level }, sink), disableRequestLogging: true });
    registerRequestLogHook(app);
    app.get('/poll', async () => ({ ok: true }));
    app.post('/write', async () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/poll' });
    await app.inject({ method: 'POST', url: '/write' });
    await app.inject({ method: 'GET', url: '/missing' });
    await app.close();
    return lines;
  }

  it('at info: polling GET is silent; write and 404 each log exactly one line', async () => {
    const lines = await captureLogs('info');
    const urls = lines.filter((l) => l.url).map((l) => `${l.method} ${l.url} ${l.statusCode}`);
    assert.deepEqual(urls.sort(), ['GET /missing 404', 'POST /write 200']);
    assert.ok(!lines.some((l) => l.msg === 'incoming request' || l.msg === 'request completed'));
  });

  it('at debug: polling GET is logged too', async () => {
    const lines = await captureLogs('debug');
    assert.ok(lines.some((l) => l.url === '/poll' && l.level === 20));
  });
});
