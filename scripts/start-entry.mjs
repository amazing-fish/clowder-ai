#!/usr/bin/env node
/**
 * Cross-platform start entry point.
 *
 * Dispatches to the platform-native startup script:
 *   Windows → powershell start-windows.ps1
 *   Unix    → bash runtime-worktree.sh / start-dev.sh
 *
 * Usage (via package.json):
 *   pnpm start              → start-entry.mjs start [--debug] [--quick] [--memory]
 *   pnpm start:direct       → start-entry.mjs start:direct [--debug] [--quick] [--memory]
 *   pnpm dev:direct          → start-entry.mjs dev:direct [--debug] [--quick] [--memory]
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const IS_WINDOWS = process.platform === 'win32';

// First positional arg is the mode (start | start:direct | dev:direct | status)
const [mode, ...rest] = process.argv.slice(2);

function pidIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    return false;
  }
}

function readDotEnvValues(dotEnvPath) {
  if (!existsSync(dotEnvPath)) return {};

  const values = {};
  for (const rawLine of readFileSync(dotEnvPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    values[key] = value;
  }
  return values;
}

function getConfigValue(dotEnv, key) {
  return dotEnv[key] || process.env[key];
}

function runWindowsStatus() {
  const runDir = resolve(projectRoot, '.cat-cafe', 'run', 'windows');
  if (!existsSync(runDir)) {
    console.log(`Cat Cafe Windows services not running (no run directory: ${runDir})`);
    process.exit(1);
  }

  const dotEnv = readDotEnvValues(resolve(projectRoot, '.env'));
  const apiPort = getConfigValue(dotEnv, 'API_SERVER_PORT') ?? '3004';
  const webPort = getConfigValue(dotEnv, 'FRONTEND_PORT') ?? '3003';
  const requiredServices = [
    { label: 'api', pidFile: `api-${apiPort}.pid`, running: false },
    { label: 'web', pidFile: `web-${webPort}.pid`, running: false },
  ];

  console.log('Cat Cafe Windows status');
  for (const service of requiredServices) {
    const pidPath = resolve(runDir, service.pidFile);
    const label = basename(service.pidFile, '.pid');
    if (!existsSync(pidPath)) {
      console.log(`  ${label}: not running (missing PID file)`);
      continue;
    }

    const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    if (Number.isNaN(pid)) {
      console.log(`  ${label}: invalid PID file`);
      continue;
    }
    service.running = pidIsRunning(pid);
    console.log(`  ${label}: ${service.running ? 'running' : 'not running'} (PID: ${pid})`);
  }

  process.exit(requiredServices.every((service) => service.running) ? 0 : 1);
}

if (mode === 'status') {
  if (IS_WINDOWS) {
    runWindowsStatus();
  } else {
    const child = spawn('bash', [resolve(__dirname, 'start-dev.sh'), '--status'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    child.on('exit', (code) => process.exit(code ?? 1));
  }
} else if (IS_WINDOWS) {
  // Map Unix-style flags to PowerShell switch params
  const flagMap = { '--debug': '-Debug', '--quick': '-Quick', '--memory': '-Memory', '--dev': '-Dev' };
  const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(__dirname, 'start-windows.ps1')];
  // dev:direct → pass -Dev to PowerShell
  if (mode === 'dev:direct') psArgs.push('-Dev');
  // Extract --profile=* (not a PS1 param) and pass via env instead
  const profileArg = rest.find((a) => a.startsWith('--profile='));
  const profileName = profileArg?.split('=')[1];
  const childEnv = { ...process.env };
  if (profileName) {
    childEnv.CAT_CAFE_PROFILE = profileName;
    childEnv.CAT_CAFE_STRICT_PROFILE_DEFAULTS = '1';
  }
  for (const arg of rest) {
    if (arg.startsWith('--profile=')) continue;
    const mapped = flagMap[arg];
    psArgs.push(mapped ?? arg);
  }
  const child = spawn('powershell', psArgs, { cwd: projectRoot, stdio: 'inherit', env: childEnv });
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  // Unix: dispatch based on mode
  const hasProfile = rest.some((a) => a.startsWith('--profile'));
  let cmd, args, env;
  if (mode === 'start') {
    cmd = resolve(__dirname, 'runtime-worktree.sh');
    args = ['start', ...rest];
    env = { ...process.env };
  } else if (mode === 'start:direct') {
    cmd = resolve(__dirname, 'start-dev.sh');
    args = ['--prod-web', ...rest];
    env = {
      ...process.env,
      ...(hasProfile ? { CAT_CAFE_STRICT_PROFILE_DEFAULTS: '1' } : {}),
      CAT_CAFE_RESPECT_DOTENV_PORTS: '1',
      CAT_CAFE_DIRECT_NO_WATCH: '1',
    };
  } else if (mode === 'dev:direct') {
    cmd = resolve(__dirname, 'start-dev.sh');
    args = [...rest];
    env = {
      ...process.env,
      ...(hasProfile ? { CAT_CAFE_STRICT_PROFILE_DEFAULTS: '1' } : {}),
      CAT_CAFE_RESPECT_DOTENV_PORTS: '1',
    };
  } else {
    console.error(`Unknown mode: ${mode}. Use: start, start:direct, dev:direct`);
    process.exit(1);
  }
  const child = spawn('bash', [cmd, ...args], { cwd: projectRoot, stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code ?? 1));
}
