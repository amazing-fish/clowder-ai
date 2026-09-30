import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startWindowsScript } from './windows-portable-redis-test-helpers.js';

// The launcher's param block plus whatever runs before $ErrorActionPreference
// (where -LogLevel is normalized). Executed for real so ValidateSet binding and
// normalization are exercised, not just pattern-matched.
function launcherPrologue() {
  const start = startWindowsScript.indexOf('param(');
  const end = startWindowsScript.indexOf('$ErrorActionPreference = "Stop"');
  assert.ok(start >= 0 && end > start, 'launcher prologue not found');
  return startWindowsScript.slice(start, end);
}

function bindLogLevel(value) {
  const dir = mkdtempSync(join(tmpdir(), 'start-windows-loglevel-'));
  try {
    const file = join(dir, 'prologue.ps1');
    writeFileSync(file, `${launcherPrologue()}\nWrite-Output "LL=[$LogLevel]"\n`, 'utf8');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file];
    if (value !== undefined) args.push('-LogLevel', value);
    return execFileSync('powershell.exe', args, { encoding: 'utf8' }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const onWindows = process.platform === 'win32';

test('start-windows -LogLevel is normalized to lowercase before reaching LOG_LEVEL', { skip: !onWindows }, () => {
  // Backend resolveLogTargetLevels matches lowercase only; WARN/SILENT used to fall back to info.
  assert.equal(bindLogLevel('WARN'), 'LL=[warn]');
  assert.equal(bindLogLevel('Warn'), 'LL=[warn]');
  assert.equal(bindLogLevel('SILENT'), 'LL=[silent]');
  assert.equal(bindLogLevel('warn'), 'LL=[warn]');
});

test('start-windows without -LogLevel leaves it empty so .env stays authoritative', { skip: !onWindows }, () => {
  assert.equal(bindLogLevel(undefined), 'LL=[]');
});

test('start-windows -LogLevel still rejects values outside the ValidateSet', { skip: !onWindows }, () => {
  assert.throws(() => bindLogLevel('verbose'));
});

test('start-windows -Debug overrides the -LogLevel runtime override inside the API job', () => {
  const overrideLoop = startWindowsScript.indexOf('foreach ($entry in $runtimeEnvOverrides.GetEnumerator())');
  const debugOverride = startWindowsScript.indexOf('$env:LOG_LEVEL = "debug"');
  assert.ok(overrideLoop > 0, 'runtime override loop not found');
  assert.ok(debugOverride > overrideLoop, '-Debug must be applied after runtime overrides');
  assert.match(startWindowsScript, /if \(\$LogLevel\) \{ \$runtimeEnvOverrides\.LOG_LEVEL = \$LogLevel \}/);
});
