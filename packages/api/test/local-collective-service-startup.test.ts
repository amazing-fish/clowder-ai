import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensurePrivateDirectory } from '@cat-cafe/shared/node-private-fs';
import { LocalCollectiveServiceManager } from '../src/domains/plugin/builtin-runtime/local-collective-service-manager.js';

test('residual damaged diagnostics do not block healthy children across repeated starts', async () => {
  const dataDirectory = join(tmpdir(), `collective-startup-damaged-${randomUUID()}`);
  await ensurePrivateDirectory(dataDirectory);
  const state = '{"serviceInstanceId":"svc_preserved"}\n';
  await writeFile(join(dataDirectory, 'collective-service.json'), state, { mode: 0o600 });
  const damaged = '{"secret":"fixture-secret';
  const diagnosticPath = join(dataDirectory, 'collective-service-startup.json');
  await writeFile(diagnosticPath, damaged, { mode: 0o600 });
  try {
    for (let restart = 0; restart < 2; restart += 1) {
      let online = false;
      let waits = 0;
      const manager = new LocalCollectiveServiceManager({
        dataDirectory,
        env: {},
        frontendBaseUrl: 'http://localhost:5102',
        serviceUrl: 'http://127.0.0.1:55231',
        cliPath: 'fixture-cli',
        fetchImpl: async (input) => {
          if (!online) throw new Error('offline fixture');
          return String(input).endsWith('/api/health')
            ? Response.json({
                ok: true,
                serviceInstanceId: 'svc_preserved',
                bootstrapNeeded: false,
                onboardingComplete: true,
              })
            : Response.json({ providers: [{ id: 'github', ready: true }] });
        },
        spawnProcess: async () => ({ pid: 90003 + restart }),
        wait: async () => {
          waits += 1;
          online = true;
        },
      });
      const launch = await manager.provision();
      assert.equal(launch.service.state, 'ready');
      assert.equal(launch.launchUrl, 'http://127.0.0.1:55231');
      assert.equal(waits, 1);
      assert.equal(await readFile(diagnosticPath, 'utf8'), damaged);
      assert.equal(await readFile(join(dataDirectory, 'collective-service.json'), 'utf8'), state);
    }
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

for (const initialDiagnostic of ['stale', 'damaged']) {
  test(`managed startup ignores ${initialDiagnostic} diagnostics and reports the matching child failure`, async () => {
    const dataDirectory = join(tmpdir(), `collective-startup-failure-${randomUUID()}`);
    await ensurePrivateDirectory(dataDirectory);
    let waits = 0;
    let launchId: string | undefined;
    const state = '{"serviceInstanceId":"svc_preserved"}\n';
    await writeFile(join(dataDirectory, 'collective-service.json'), state, { mode: 0o600 });
    const manager = new LocalCollectiveServiceManager({
      dataDirectory,
      env: {},
      frontendBaseUrl: 'http://localhost:5102',
      serviceUrl: 'http://127.0.0.1:55231',
      cliPath: 'fixture-cli',
      fetchImpl: async () => {
        throw new Error('offline fixture');
      },
      spawnProcess: async (spec) => {
        launchId = spec.env.COLLECTIVE_SERVICE_LAUNCH_ID;
        await writeFile(
          join(dataDirectory, 'collective-service-startup.json'),
          initialDiagnostic === 'damaged'
            ? '{'
            : JSON.stringify({
                pid: 90002,
                launchId: 'stale-launch',
                status: 'failed',
                code: 'BOOTSTRAP_UNRECOVERABLE',
              }),
          { mode: 0o600 },
        );
        return { pid: 90002 };
      },
      wait: async () => {
        waits += 1;
        await writeFile(
          join(dataDirectory, 'collective-service-startup.json'),
          JSON.stringify({ pid: 90002, launchId, status: 'failed', code: 'BOOTSTRAP_UNRECOVERABLE' }),
        );
      },
    });
    try {
      await assert.rejects(manager.provision(), /bootstrap_unrecoverable/);
      assert.equal(waits, 1, 'unattributable record is ignored; matching failure stops the next poll');
      assert.equal(await readFile(join(dataDirectory, 'collective-service.json'), 'utf8'), state);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
}
