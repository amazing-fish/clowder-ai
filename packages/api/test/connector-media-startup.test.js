import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Fastify from 'fastify';
import { connectorMediaRoutes } from '../dist/routes/connector-media.js';

test('fresh source install creates media root and serves the first later download', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'clowder-media-startup-'));
  const mediaDir = join(root, 'media');
  const logs = [];
  const app = Fastify({ logger: { stream: { write: (line) => logs.push(JSON.parse(line)) } } });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await app.register(connectorMediaRoutes, { mediaDir });
  await app.ready();
  assert.equal(logs.filter((row) => row.level >= 40).length, 0, 'fresh install must not warn about missing media root');
  assert.ok((await stat(mediaDir)).isDirectory());
  await writeFile(join(mediaDir, 'first.txt'), 'first download');
  const response = await app.inject('/api/connector-media/first.txt');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'first download');
});

test('existing media survives registration', async (t) => {
  const mediaDir = await mkdtemp(join(tmpdir(), 'clowder-media-existing-'));
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(mediaDir, { recursive: true, force: true });
  });
  await writeFile(join(mediaDir, 'existing.txt'), 'keep');
  await app.register(connectorMediaRoutes, { mediaDir });
  const response = await app.inject('/api/connector-media/existing.txt');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'keep');
});

test('an invalid media root fails startup instead of reporting a usable route', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'clowder-media-invalid-'));
  const mediaDir = join(root, 'file.txt');
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(mediaDir, 'not a directory');
  app.register(connectorMediaRoutes, { mediaDir });
  await assert.rejects(app.ready(), { code: 'EEXIST' });
  assert.ok((await stat(mediaDir)).isFile());
});
