import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertWindowsPrivatePath } from '../../../collective-connector/src/windows-private-path.js';
import { CollectiveServiceStore } from '../store.js';

const directories: string[] = [];
const publicUrl = 'http://127.0.0.1:55231/';
const now = Date.parse('2026-10-01T00:00:00Z');
const faults = vi.hoisted(() => ({ failStateWrite: false }));
vi.mock('@cat-cafe/shared/node-private-fs', async (load) => {
  const actual = await load<typeof import('@cat-cafe/shared/node-private-fs')>();
  return {
    ...actual,
    writeAtomicPrivate: async (path: string, contents: string) => {
      if (faults.failStateWrite && path.endsWith('collective-service.json'))
        throw new Error('fixture digest commit failure');
      return actual.writeAtomicPrivate(path, contents);
    },
  };
});
afterEach(async () => {
  faults.failStateWrite = false;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'collective-bootstrap-startup-'));
  directories.push(parent);
  const dataDirectory = join(parent, 'private');
  if (process.platform === 'win32') await assertWindowsPrivatePath(dataDirectory, 'directory', true);
  return { dataDirectory, now: () => now, bootstrapUrl: publicUrl };
}
async function linkSecret(directory: string) {
  const url = new URL((await readFile(join(directory, 'owner-bootstrap.url'), 'utf8')).trim());
  const secret = new URLSearchParams(url.hash.slice(1)).get('bootstrap');
  if (!secret) throw new Error('fixture link has no bootstrap');
  return secret;
}
function requiredSecret(secret: string | undefined): string {
  if (!secret) throw new Error('fixture bootstrap missing');
  return secret;
}
describe('offline bootstrap startup', () => {
  it('writes the private initialization link on first open and preserves it on a normal restart', async () => {
    const options = await fixture();
    const first = await CollectiveServiceStore.open(options);
    if (!first.bootstrapSecret) throw new Error('fixture bootstrap missing');
    const secret = await linkSecret(options.dataDirectory);
    expect(secret).toBe(first.bootstrapSecret);
    const before = await readFile(join(options.dataDirectory, 'collective-service.json'), 'utf8');
    const reopened = await CollectiveServiceStore.open(options);
    expect(reopened.bootstrapSecret).toBeUndefined();
    expect(await linkSecret(options.dataDirectory)).toBe(secret);
    expect(await readFile(join(options.dataDirectory, 'collective-service.json'), 'utf8')).toBe(before);
  });
  it.each([
    'missing',
    'malformed',
    'mismatched',
    'expired',
  ])('recovers a pristine %s link without changing Service identity', async (failure) => {
    const options = await fixture();
    const first = await CollectiveServiceStore.open(options);
    const original = JSON.parse(await readFile(join(options.dataDirectory, 'collective-service.json'), 'utf8'));
    const path = join(options.dataDirectory, 'owner-bootstrap.url');
    if (failure === 'missing') await rm(path, { force: true });
    if (failure === 'malformed') await writeFile(path, 'invalid\n');
    if (failure === 'mismatched') await writeFile(path, `${publicUrl}#bootstrap=wrong\n`);
    const second = await CollectiveServiceStore.open({
      ...options,
      now: () => (failure === 'expired' ? now + 86_400_001 : now),
    });
    expect(second.store.serviceInstanceId).toBe(first.store.serviceInstanceId);
    expect(second.bootstrapReissued).toBe(true);
    const updated = JSON.parse(await readFile(join(options.dataDirectory, 'collective-service.json'), 'utf8'));
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.bootstrap.tokenDigest).not.toBe(original.bootstrap.tokenDigest);
    await expect(
      second.store.consumeBootstrap({ secret: requiredSecret(first.bootstrapSecret), displayName: 'old' }),
    ).rejects.toMatchObject({ code: 'INVALID_BOOTSTRAP' });
    await expect(
      second.store.consumeBootstrap({ secret: await linkSecret(options.dataDirectory), displayName: 'owner' }),
    ).resolves.toBeTruthy();
  });
  it('refuses a non-pristine orphan without rewriting either persisted state or link', async () => {
    const options = await fixture();
    await CollectiveServiceStore.open(options);
    const statePath = join(options.dataDirectory, 'collective-service.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.humans.orphan = { humanId: 'orphan', displayName: 'existing', createdAt: new Date(now).toISOString() };
    const contents = `${JSON.stringify(state)}\n`;
    await writeFile(statePath, contents);
    await rm(join(options.dataDirectory, 'owner-bootstrap.url'));
    await expect(CollectiveServiceStore.open(options)).rejects.toMatchObject({ code: 'BOOTSTRAP_UNRECOVERABLE' });
    expect(await readFile(statePath, 'utf8')).toBe(contents);
    await expect(readFile(join(options.dataDirectory, 'owner-bootstrap.url'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('leaves an initialized owner unchanged when its consumed link has been removed', async () => {
    const options = await fixture();
    const first = await CollectiveServiceStore.open(options);
    const owner = await first.store.consumeBootstrap({
      secret: await linkSecret(options.dataDirectory),
      displayName: 'owner',
    });
    await rm(join(options.dataDirectory, 'owner-bootstrap.url'));
    const before = await readFile(join(options.dataDirectory, 'collective-service.json'), 'utf8');
    const reopened = await CollectiveServiceStore.open(options);
    expect(reopened.bootstrapSecret).toBeUndefined();
    expect((await reopened.store.requireSession(owner.sessionToken)).human.displayName).toBe('owner');
    expect(await readFile(join(options.dataDirectory, 'collective-service.json'), 'utf8')).toBe(before);
  });
  it('recovers when the link commit succeeds but the digest commit fails', async () => {
    const options = await fixture();
    const first = await CollectiveServiceStore.open(options);
    await rm(join(options.dataDirectory, 'owner-bootstrap.url'));
    const statePath = join(options.dataDirectory, 'collective-service.json');
    const original = await readFile(statePath, 'utf8');
    faults.failStateWrite = true;
    await expect(CollectiveServiceStore.open(options)).rejects.toThrow('fixture digest commit failure');
    expect(await readFile(statePath, 'utf8')).toBe(original);
    const orphanedSecret = await linkSecret(options.dataDirectory);
    faults.failStateWrite = false;
    const recovered = await CollectiveServiceStore.open(options);
    expect(recovered.store.serviceInstanceId).toBe(first.store.serviceInstanceId);
    expect(recovered.bootstrapReissued).toBe(true);
    await expect(
      recovered.store.consumeBootstrap({ secret: orphanedSecret, displayName: 'orphan' }),
    ).rejects.toMatchObject({ code: 'INVALID_BOOTSTRAP' });
    await expect(
      recovered.store.consumeBootstrap({ secret: await linkSecret(options.dataDirectory), displayName: 'owner' }),
    ).resolves.toBeTruthy();
  });
});
