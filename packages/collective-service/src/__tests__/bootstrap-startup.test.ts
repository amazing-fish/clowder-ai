import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertWindowsPrivatePath } from '../../../collective-connector/src/windows-private-path.js';
import { CollectiveServiceStore } from '../store.js';

const directories: string[] = [];
const publicUrl = 'http://127.0.0.1:55231/';
const now = Date.parse('2026-10-01T00:00:00Z');
const faults = vi.hoisted(() => ({ stateFailure: '', failLink: false, writes: [] as string[] }));
vi.mock('@cat-cafe/shared/node-private-fs', async (load) => {
  const actual = await load<typeof import('@cat-cafe/shared/node-private-fs')>();
  return {
    ...actual,
    writeAtomicPrivate: async (path: string, contents: string) => {
      faults.writes.push(path);
      if (faults.failLink && path.endsWith('owner-bootstrap.url')) throw new Error('fixture link commit failure');
      const stateFile = path.endsWith('collective-service.json');
      if (stateFile && faults.stateFailure === 'before') throw new Error('fixture state commit failure');
      await actual.writeAtomicPrivate(path, contents);
      if (stateFile && faults.stateFailure === 'after') throw new Error('fixture post-rename failure');
    },
  };
});
afterEach(async () => {
  faults.stateFailure = '';
  faults.failLink = false;
  faults.writes.length = 0;
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

describe('bootstrap startup persistence and diagnosis without reissue', () => {
  it('writes the first link before the digest and preserves both on a normal restart', async () => {
    const options = await fixture();
    const first = await CollectiveServiceStore.open(options);
    const secret = await linkSecret(options.dataDirectory);
    expect(secret).toBe(first.bootstrapSecret);
    expect(faults.writes.map((path) => path.split(/[\\/]/).at(-1))).toEqual([
      'owner-bootstrap.url',
      'collective-service.json',
    ]);
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
  ])('diagnoses an unconsumed %s link without changing any records or provider files', async (failure) => {
    const options = await fixture();
    await CollectiveServiceStore.open(options);
    const statePath = join(options.dataDirectory, 'collective-service.json');
    const before = await readFile(statePath, 'utf8');
    const providerPaths = ['github-app-setup.json', 'github-app-oauth.json'].map((name) =>
      join(options.dataDirectory, name),
    );
    const providerHistory = '{"fixture":"existing provider history"}\n';
    for (const path of providerPaths) await writeFile(path, providerHistory, { mode: 0o600 });
    const path = join(options.dataDirectory, 'owner-bootstrap.url');
    if (failure === 'missing') await rm(path);
    if (failure === 'malformed') await writeFile(path, 'invalid\n');
    if (failure === 'mismatched') await writeFile(path, `${publicUrl}#bootstrap=wrong\n`);
    const linkBefore = failure === 'missing' ? undefined : await readFile(path, 'utf8');
    faults.writes.length = 0;
    await expect(
      CollectiveServiceStore.open({ ...options, now: () => (failure === 'expired' ? now + 86_400_001 : now) }),
    ).rejects.toMatchObject({
      code: 'BOOTSTRAP_UNRECOVERABLE',
      message: expect.stringMatching(/does not support automatic recovery; data is preserved; see #1563/),
    });
    expect(faults.writes).toEqual([]);
    expect(await readFile(statePath, 'utf8')).toBe(before);
    if (failure === 'missing') await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(await readFile(path, 'utf8')).toBe(linkBefore);
    for (const path of providerPaths) expect(await readFile(path, 'utf8')).toBe(providerHistory);
  });
  it('refuses an orphan with existing domain state through the same unchanged-state path', async () => {
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
  it('does not create state when the first link cannot be persisted', async () => {
    const options = await fixture();
    faults.failLink = true;
    await expect(CollectiveServiceStore.open(options)).rejects.toThrow('fixture link commit failure');
    await expect(readFile(join(options.dataDirectory, 'collective-service.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('delivers the first link before a failing state commit without claiming success', async () => {
    const options = await fixture();
    faults.stateFailure = 'before';
    await expect(CollectiveServiceStore.open(options)).rejects.toThrow('fixture state commit failure');
    expect(await linkSecret(options.dataDirectory)).toBeTruthy();
    await expect(readFile(join(options.dataDirectory, 'collective-service.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('reopens after a post-rename state failure using the existing link without rotating credentials', async () => {
    const options = await fixture();
    faults.stateFailure = 'after';
    await expect(CollectiveServiceStore.open(options)).rejects.toThrow('fixture post-rename failure');
    const secret = await linkSecret(options.dataDirectory);
    const before = await readFile(join(options.dataDirectory, 'collective-service.json'), 'utf8');
    faults.stateFailure = '';
    faults.writes.length = 0;
    const reopened = await CollectiveServiceStore.open(options);
    expect(reopened.bootstrapSecret).toBeUndefined();
    expect(reopened.store.serviceInstanceId).toBe(JSON.parse(before).serviceInstanceId);
    expect(await linkSecret(options.dataDirectory)).toBe(secret);
    expect(await readFile(join(options.dataDirectory, 'collective-service.json'), 'utf8')).toBe(before);
    expect(faults.writes).toEqual([]);
  });
});
