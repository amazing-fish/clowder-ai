import { afterEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  lstat: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  assertWindowsPrivatePath: vi.fn(),
}));
vi.mock('node:fs/promises', () => io);
vi.mock('../src/windows-private-path.js', () => ({ assertWindowsPrivatePath: io.assertWindowsPrivatePath }));

import { writeAtomicPrivate } from '../src/node-private-fs.js';

const platform = Object.getOwnPropertyDescriptor(process, 'platform');
if (!platform) throw new Error('Missing process platform descriptor');
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.resetAllMocks();
});
function setup(platformName: string) {
  Object.defineProperty(process, 'platform', { ...platform, value: platformName });
  io.lstat.mockResolvedValue({ isDirectory: () => true, mode: 0o700 });
  io.unlink.mockResolvedValue(undefined);
  const file = { writeFile: vi.fn(), sync: vi.fn(), close: vi.fn() };
  const directory = { sync: vi.fn(), close: vi.fn() };
  io.open.mockImplementation(async (_path, flags) => (flags === 'wx' ? file : directory));
  return { file, directory };
}
describe('atomic private durability', () => {
  it('keeps Windows file flush and rename while avoiding unsupported directory handles', async () => {
    const { file } = setup('win32');
    await writeAtomicPrivate('/private/state', 'fixture');
    expect(io.assertWindowsPrivatePath).toHaveBeenCalledWith('/private', 'directory', true);
    expect(file.sync).toHaveBeenCalledOnce();
    expect(io.rename).toHaveBeenCalledOnce();
    expect(io.open).toHaveBeenCalledTimes(1);
  });
  it('retains Unix directory durability and propagates directory flush failures', async () => {
    const { file, directory } = setup('linux');
    directory.sync.mockRejectedValue(new Error('directory flush failed'));
    await expect(writeAtomicPrivate('/private/state', 'fixture')).rejects.toThrow('directory flush failed');
    expect(file.sync).toHaveBeenCalledOnce();
    expect(io.rename).toHaveBeenCalledOnce();
    expect(directory.close).toHaveBeenCalledOnce();
  });
  it('does not replace committed state when file flush fails and removes its own temporary file', async () => {
    const { file } = setup('win32');
    file.sync.mockRejectedValue(new Error('file flush failed'));
    await expect(writeAtomicPrivate('/private/state', 'fixture')).rejects.toThrow('file flush failed');
    expect(io.rename).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
    expect(io.unlink).toHaveBeenCalledOnce();
  });
});
