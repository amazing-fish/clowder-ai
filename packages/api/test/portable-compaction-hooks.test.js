import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isClaudeProjectHookCarrierReady } from '../src/domains/cats/services/session/claude-project-hook-readiness.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'clowder compaction 测试-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

function run(script, args = [], input = '', env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: scratch,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('installed workspace becomes ready without Unix mode bits and preserves user settings', async () => {
  const project = join(scratch, 'workspace');
  mkdirSync(join(project, '.claude'), { recursive: true });
  const settingsPath = join(project, '.claude/settings.json');
  const original = {
    permissions: { deny: ['Bash(rm:*)'] },
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo custom' }] }] },
  };
  writeFileSync(settingsPath, JSON.stringify(original));
  assert.equal(isClaudeProjectHookCarrierReady(project), false);
  const installer = join(root, 'scripts/install-claude-compaction-hooks.mjs');
  const args = ['--source-root', root, '--project-root', project];
  const preview = await run(installer, args);
  assert.equal(preview.code, 0, preview.stderr);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath)), original, 'default must be read-only');
  const result = await run(installer, [...args, '--apply']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(isClaudeProjectHookCarrierReady(project), true);
  const installed = readFileSync(settingsPath, 'utf8');
  assert.deepEqual(JSON.parse(installed).permissions, original.permissions);
  assert.deepEqual(JSON.parse(installed).hooks.SessionStart[0], original.hooks.SessionStart[0]);
  assert.equal((await run(installer, [...args, '--apply'])).code, 0);
  assert.equal(readFileSync(settingsPath, 'utf8'), installed, 'repair must be idempotent');
  const oldRuntime = JSON.parse(installed);
  oldRuntime.hooks.PreCompact[0].hooks[0].command = '"C:/old runtime/node.exe" ".claude/hooks/f24-compaction.mjs" pre';
  oldRuntime.hooks.SessionStart[1].hooks[0].command = '"/old/runtime/node" ".claude/hooks/f24-compaction.mjs" post';
  writeFileSync(settingsPath, JSON.stringify(oldRuntime));
  assert.equal((await run(installer, [...args, '--apply'])).code, 0);
  assert.equal(readFileSync(settingsPath, 'utf8'), installed, 'runtime migration must replace managed hooks');
  for (const mutate of [
    (settings) => {
      settings.hooks.PreCompact[0].matcher = 'manual';
    },
    (settings) => {
      settings.hooks.PreCompact[0].hooks[0].async = true;
    },
  ]) {
    const invalid = JSON.parse(installed);
    mutate(invalid);
    writeFileSync(settingsPath, JSON.stringify(invalid));
    assert.equal(isClaudeProjectHookCarrierReady(project), false);
  }
  writeFileSync(settingsPath, installed);
  writeFileSync(join(project, '.claude/settings.local.json'), JSON.stringify({ disableAllHooks: true }));
  assert.equal(isClaudeProjectHookCarrierReady(project), false);
  assert.notEqual((await run(installer, [...args, '--apply'])).code, 0);
  rmSync(join(project, '.claude/settings.local.json'));
  const settings = JSON.parse(installed);
  settings.disableAllHooks = true;
  writeFileSync(settingsPath, JSON.stringify(settings));
  assert.equal(isClaudeProjectHookCarrierReady(project), false);
  assert.notEqual((await run(installer, [...args, '--apply'])).code, 0, 'must respect explicit opt-out');
});

test('desktop packages and offline sync include the project carrier', () => {
  const config = JSON.parse(readFileSync(join(root, 'desktop/package.json')));
  const resources = config.build.extraResources;
  assert.ok(resources.some((entry) => entry.from === '../.claude/hooks' && entry.to === '.claude/hooks'));
  assert.match(
    readFileSync(join(root, 'desktop/installer/cat-cafe.iss'), 'utf8'),
    /Source: "\.\.\\\.\.\\\.claude\\hooks\\\*";\s+DestDir: "\{app\}\\\.claude\\hooks"/,
  );
  assert.match(
    readFileSync(join(root, 'desktop/scripts/build-desktop.ps1'), 'utf8'),
    /Copy-ToStaging \$hooksSource "\.claude\\hooks"/,
  );
  assert.doesNotMatch(
    readFileSync(join(root, 'desktop/scripts/sync-agent-hooks-offline.mjs'), 'utf8'),
    /installClaudeCompactionHooks/,
  );
  const postInstall = readFileSync(join(root, 'desktop/scripts/post-install-offline.ps1'), 'utf8');
  assert.match(
    postInstall,
    /\$compactionNode \$compactionInstaller --source-root \$ProjectRoot --project-root \$ProjectRoot --apply/,
  );
  assert.ok(postInstall.indexOf('$compactionInstaller =') > postInstall.indexOf('if ($AgentHooksOnly)'));
});

test('real hook process authenticates seal and injects only API-selected cold context', async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, headers: req.headers, body });
    if (req.headers['x-invocation-id'] !== 'fixture-id' || req.headers['x-callback-token'] !== 'fixture-token') {
      res.writeHead(401).end('{}');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        req.method === 'POST'
          ? { contextEpoch: { status: 'observed' } }
          : {
              digest: { poison: 'RAW-HISTORY-MUST-NOT-ENTER' },
              postCompact: { status: 'projected', contextPacket: 'TRUSTED-COLD-PACKET' },
            },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = {
      API_SERVER_PORT: String(server.address().port),
      CAT_CAFE_INVOCATION_ID: 'fixture-id',
      CAT_CAFE_CALLBACK_TOKEN: 'fixture-token',
      PATH: '',
    };
    const hook = join(root, '.claude/hooks/f24-compaction.mjs');
    const input = JSON.stringify({ session_id: 'fixture-session', trigger: 'auto' });
    const pre = await run(hook, ['pre'], input, env);
    assert.equal(pre.code, 0, pre.stderr);
    assert.equal(JSON.parse(requests[0].body).cliSessionId, 'fixture-session');
    const post = await run(hook, ['post'], input, env);
    assert.equal(post.code, 0, post.stderr);
    assert.match(JSON.parse(post.stdout).hookSpecificOutput.additionalContext, /TRUSTED-COLD-PACKET/);
    assert.doesNotMatch(post.stdout, /RAW-HISTORY-MUST-NOT-ENTER/);
    const rejected = await run(hook, ['pre'], input, { ...env, CAT_CAFE_CALLBACK_TOKEN: 'wrong' });
    assert.notEqual(rejected.code, 0);
    assert.doesNotMatch(rejected.stderr, /fixture-token|wrong/);
    const before = requests.length;
    assert.equal((await run(hook, ['pre'], input, { ...env, CAT_CAFE_CALLBACK_TOKEN: '' })).code, 0);
    assert.equal(requests.length, before, 'unmanaged CLI must not contact managed session API');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
