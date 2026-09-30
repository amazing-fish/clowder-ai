import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startWindowsScript } from './windows-portable-redis-test-helpers.js';

// Param block through the pre-$ErrorActionPreference prologue, executed for real.
function launcherPrologue() {
  const start = startWindowsScript.indexOf('param(');
  const end = startWindowsScript.indexOf('$ErrorActionPreference = "Stop"');
  assert.ok(start >= 0 && end > start, 'launcher prologue not found');
  return startWindowsScript.slice(start, end);
}

function autostartAfterPrologue(args, inherited) {
  const dir = mkdtempSync(join(tmpdir(), 'start-windows-connectors-'));
  try {
    const file = join(dir, 'prologue.ps1');
    writeFileSync(file, `${launcherPrologue()}\nWrite-Output "AS=[$env:CONNECTOR_GATEWAY_AUTOSTART]"\n`, 'utf8');
    const env = { ...process.env };
    delete env.CONNECTOR_GATEWAY_AUTOSTART;
    if (inherited !== undefined) env.CONNECTOR_GATEWAY_AUTOSTART = inherited;
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { encoding: 'utf8', windowsHide: true, env },
    ).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const onWindows = process.platform === 'win32';

test('start-windows -Dev -Connectors grants connector autostart as launcher authority', { skip: !onWindows }, () => {
  assert.equal(autostartAfterPrologue(['-Dev', '-Connectors']), 'AS=[1]');
});

test('start-windows -Dev without -Connectors leaves the inherited decision untouched', { skip: !onWindows }, () => {
  assert.equal(autostartAfterPrologue(['-Dev']), 'AS=[]');
  assert.equal(autostartAfterPrologue(['-Dev'], '0'), 'AS=[0]');
});

test('-Connectors is applied before the launcher captures its env override', () => {
  const grant = startWindowsScript.indexOf('if ($Connectors) { $env:CONNECTOR_GATEWAY_AUTOSTART = "1" }');
  const capture = startWindowsScript.indexOf(
    '$connectorGatewayAutostartOverride = [System.Environment]::GetEnvironmentVariable("CONNECTOR_GATEWAY_AUTOSTART", "Process")',
  );
  assert.ok(grant > 0, '-Connectors grant not found');
  assert.ok(capture > grant, 'grant must precede the pre-dotenv override capture so the dotenv scrub keeps it');
});
