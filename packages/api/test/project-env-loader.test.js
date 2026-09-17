/**
 * Project env loader tests.
 *
 * The loader reapplies Hub-persisted app settings from the config-root .env
 * into process.env at boot, only-if-unset, scoped to app-setting keys.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadProjectEnvIntoProcess,
  parseEnvFileContents,
  projectEnvAppSettingKeys,
} from '../dist/config/project-env-loader.js';

const SCRATCH = [];

function makeConfigRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-project-env-'));
  SCRATCH.push(dir);
  return dir;
}

describe('parseEnvFileContents', () => {
  it('parses plain KEY=VALUE lines', () => {
    const entries = parseEnvFileContents('DEFAULT_CAT_ID=research\nCLI_TIMEOUT_MS=1000');
    assert.deepEqual(entries, [
      { name: 'DEFAULT_CAT_ID', value: 'research' },
      { name: 'CLI_TIMEOUT_MS', value: '1000' },
    ]);
  });

  it('ignores comments, blank lines, and lines without =', () => {
    const entries = parseEnvFileContents('# comment\n\nDEFAULT_CAT_ID=research\nBROKEN_LINE\n');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'DEFAULT_CAT_ID');
  });

  it('strips surrounding quotes and CRLF', () => {
    const entries = parseEnvFileContents('GREETING="hello, world"\r\nOTHER=\'single\'\r\n');
    assert.deepEqual(entries, [
      { name: 'GREETING', value: 'hello, world' },
      { name: 'OTHER', value: 'single' },
    ]);
  });
});

describe('projectEnvAppSettingKeys', () => {
  it('includes DEFAULT_CAT_ID and the ConfigStore env keys', () => {
    const keys = projectEnvAppSettingKeys();
    assert.ok(keys.has('DEFAULT_CAT_ID'), 'DEFAULT_CAT_ID must be eligible');
    assert.ok(keys.has('UI_BUBBLE_CLI_OUTPUT_DEFAULT'), 'bubble cliOutput env key must be eligible');
    assert.ok(keys.has('UI_BUBBLE_THINKING_DEFAULT'), 'bubble thinking env key must be eligible');
  });

  it('includes runtimeEditable app settings persisted via PATCH /api/config/env', () => {
    const keys = projectEnvAppSettingKeys();
    // Read back from process.env by routes/prompt-captures.ts — without
    // reapplication these revert to their default after a restart.
    assert.ok(keys.has('PROMPT_CAPTURE'), 'PROMPT_CAPTURE must be eligible');
    assert.ok(keys.has('PROMPT_CAPTURE_CATS'), 'PROMPT_CAPTURE_CATS must be eligible');
  });

  it('excludes capability keys such as CONNECTOR_GATEWAY_AUTOSTART', () => {
    const keys = projectEnvAppSettingKeys();
    assert.equal(keys.has('CONNECTOR_GATEWAY_AUTOSTART'), false);
  });
});

describe('loadProjectEnvIntoProcess', () => {
  const saved = {};

  beforeEach(() => {
    saved.configRoot = process.env.CAT_CAFE_CONFIG_ROOT;
    saved.templatePath = process.env.CAT_TEMPLATE_PATH;
    saved.defaultCatId = process.env.DEFAULT_CAT_ID;
    saved.bubbleCli = process.env.UI_BUBBLE_CLI_OUTPUT_DEFAULT;
    delete process.env.DEFAULT_CAT_ID;
    delete process.env.UI_BUBBLE_CLI_OUTPUT_DEFAULT;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('applies app settings from the config-root .env when unset', () => {
    const root = makeConfigRoot();
    process.env.CAT_CAFE_CONFIG_ROOT = root;
    writeFileSync(join(root, '.env'), 'DEFAULT_CAT_ID=research\nUI_BUBBLE_CLI_OUTPUT_DEFAULT=expanded\n');

    const result = loadProjectEnvIntoProcess();

    assert.equal(process.env.DEFAULT_CAT_ID, 'research');
    assert.equal(process.env.UI_BUBBLE_CLI_OUTPUT_DEFAULT, 'expanded');
    assert.ok(result.applied.includes('DEFAULT_CAT_ID'));
    assert.ok(result.applied.includes('UI_BUBBLE_CLI_OUTPUT_DEFAULT'));
    assert.equal(result.envFile, join(root, '.env'));
  });

  it('skips keys already set in the process (launcher wins)', () => {
    const root = makeConfigRoot();
    process.env.CAT_CAFE_CONFIG_ROOT = root;
    process.env.DEFAULT_CAT_ID = 'codex';
    writeFileSync(join(root, '.env'), 'DEFAULT_CAT_ID=research\n');

    const result = loadProjectEnvIntoProcess();

    assert.equal(process.env.DEFAULT_CAT_ID, 'codex', 'existing process value must not be clobbered');
    assert.ok(result.skipped.includes('DEFAULT_CAT_ID'));
    assert.equal(result.applied.includes('DEFAULT_CAT_ID'), false);
  });

  it('does not apply capability keys from the config-root .env', () => {
    const root = makeConfigRoot();
    process.env.CAT_CAFE_CONFIG_ROOT = root;
    delete process.env.CONNECTOR_GATEWAY_AUTOSTART;
    writeFileSync(join(root, '.env'), 'CONNECTOR_GATEWAY_AUTOSTART=1\n');

    const result = loadProjectEnvIntoProcess();

    assert.equal(process.env.CONNECTOR_GATEWAY_AUTOSTART, undefined, 'capability key must not be loaded');
    assert.equal(result.applied.includes('CONNECTOR_GATEWAY_AUTOSTART'), false);
  });

  it('returns an empty result when the config-root .env is absent', () => {
    const root = makeConfigRoot();
    process.env.CAT_CAFE_CONFIG_ROOT = root;

    const result = loadProjectEnvIntoProcess();

    assert.equal(result.envFile, null);
    assert.deepEqual(result.applied, []);
  });
});
