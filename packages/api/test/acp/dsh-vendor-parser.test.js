// @ts-check
/**
 * Real-parser coverage for the DSH launcher boundary (review P1-1).
 *
 * Evaluates the `lib/types/args.js` region of the INSTALLED `@deepseek-ai/dsh`
 * bin (commander resolved from dsh's own node_modules) and asserts that the
 * args we spawn put our patch in `patches`, never in the app `args`. Skips when
 * DSH is not installed; set DSH_PACKAGE_DIR to point at another install.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

const { prepareDshNativeL0 } = await import('../../dist/domains/cats/services/agents/providers/acp/dsh-native-l0.js');

function findDshPackageDir() {
  if (process.env.DSH_PACKAGE_DIR) return process.env.DSH_PACKAGE_DIR;
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    return join(root, '@deepseek-ai', 'dsh');
  } catch {
    return undefined;
  }
}

const pkgDir = findDshPackageDir();
const binPath = pkgDir ? join(pkgDir, 'lib', 'bin.js') : undefined;
const commanderPath = pkgDir ? join(pkgDir, 'node_modules', 'commander', 'index.js') : undefined;
const available = Boolean(binPath && commanderPath && existsSync(binPath) && existsSync(commanderPath));

const work = mkdtempSync(join(tmpdir(), 'dsh-vendor-parser-'));
after(() => rmSync(work, { recursive: true, force: true }));

/** @returns {Promise<(argv: string[]) => any>} */
async function loadVendorParser() {
  const src = readFileSync(/** @type {string} */ (binPath), 'utf8');
  const start = src.indexOf('//#region lib/types/args.js');
  const end = src.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start, 'vendor args region not found; DSH layout changed');
  const shim = [
    `import { Command, CommanderError, InvalidArgumentError } from ${JSON.stringify(pathToFileURL(/** @type {string} */ (commanderPath)).href)};`,
    src.slice(start, end),
    'export { parseDshArgs };',
  ].join('\n');
  const shimPath = join(work, 'dsh-args.mjs');
  writeFileSync(shimPath, shim, 'utf8');
  const { parseDshArgs } = await import(pathToFileURL(shimPath).href);
  return (argv) => parseDshArgs(argv, '0.0.0-test');
}

describe('DSH vendor launcher parser', { skip: available ? false : 'DSH not installed' }, () => {
  const script = '/opt/node_modules/@deepseek-ai/dsh/bin/dsh.js';
  const cases = [
    { name: 'plain', tail: [], app: [] },
    { name: '`--` separator', tail: ['--', '--patch', 'app.json'], app: ['--patch', 'app.json'] }, // commander consumes `--`
    { name: 'app args', tail: ['--log-level', 'info'], app: ['--log-level', 'info'] },
  ];

  for (const { name, tail, app } of cases) {
    it(`host patch reaches launcher patches, not app args (${name})`, async () => {
      const parse = await loadVendorParser();
      // Sanity: the naive append (old behavior) really leaks to the app when app args exist.
      if (tail.length > 0) {
        const naive = parse(['--profile', 'acp', ...tail, '--patch', 'host.json']);
        assert.ok(!naive.patches.includes('host.json'), 'precondition: append-after-app-args is the P1 bug');
      }
      const binding = prepareDshNativeL0('dsh', 'node', [script, '--profile', 'acp', ...tail], 'L0', work);
      assert.ok(binding);
      const argv = binding.args.slice(1); // node strips the script path
      const boot = parse(argv);
      assert.equal(boot.mode, 'profile');
      assert.equal(boot.profile, 'acp');
      assert.deepEqual(boot.patches, [binding.patchPath]);
      assert.deepEqual(boot.args, app);
    });
  }

  it('positional profile form is parsed as the acp profile with our patch', async () => {
    const parse = await loadVendorParser();
    const binding = prepareDshNativeL0('dsh', 'dsh', ['acp', '--log-level', 'info'], 'L0', work);
    assert.ok(binding);
    const boot = parse(binding.args);
    assert.equal(boot.profile, 'acp');
    assert.deepEqual(boot.patches, [binding.patchPath]);
    assert.deepEqual(boot.args, ['--log-level', 'info']);
  });
});
