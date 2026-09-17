/**
 * Project env loader — reapplies Hub-persisted app settings at API boot.
 *
 * Problem this solves: owner-set defaults (default cat, bubble display
 * defaults, ...) are persisted by Hub routes to the *config-root* .env
 * (resolveActiveProjectRoot()/.env). But the runtime process is launched by
 * shell scripts that source the *install* .env, and nothing ever loads the
 * config-root file into the process. So every Hub setting silently reverts on
 * restart — the default cat falls back to breeds[0], and bubble defaults fall
 * back to the code constant.
 *
 * This loader closes the loop: at boot it applies the app-setting keys found
 * in the config-root .env into process.env, using only-if-unset semantics so
 * the launcher/install env always wins.
 *
 * Security boundary: only app-setting keys are eligible (the hot-updatable
 * ConfigStore keys plus DEFAULT_CAT_ID). Capability/permission keys such as
 * CONNECTOR_GATEWAY_AUTOSTART are deliberately excluded — the startup script
 * owns those, and re-applying a revoked capability from a project file would
 * cross the privilege boundary the launcher restores after dotenv.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { configStore } from './ConfigStore.js';
import { resolveActiveProjectRoot } from '../utils/active-project-root.js';

/**
 * App-setting keys that are not ConfigStore-managed — the Hub persists them
 * through its own routes instead:
 * - `DEFAULT_CAT_ID` — PUT /api/config/default-cat. Read back by
 *   getDefaultCatId(); without reapplication the default cat falls back to
 *   breeds[0] after every restart.
 * - `PROMPT_CAPTURE` / `PROMPT_CAPTURE_CATS` — PATCH /api/config/env
 *   (runtimeEditable, non-sensitive diagnostics). Read back from process.env by
 *   routes/prompt-captures.ts, so without reapplication the switch silently
 *   reverts to 'off' after a restart while the Hub's env-summary still reports
 *   the persisted value.
 *
 * This list is a fail-closed boundary, not a mirror of the env registry: keys
 * are added deliberately, one app setting at a time. Capability/permission keys
 * (CONNECTOR_GATEWAY_AUTOSTART, ...) must stay out, or a project file could
 * re-arm a capability the launcher revoked after dotenv.
 */
const EXTRA_APP_SETTING_ENV_KEYS = new Set(['DEFAULT_CAT_ID', 'PROMPT_CAPTURE', 'PROMPT_CAPTURE_CATS']);

/**
 * Env var names that count as Hub-persisted *app settings* eligible for
 * boot-time reapplication. Capability/permission keys are excluded on purpose.
 */
export function projectEnvAppSettingKeys(): Set<string> {
  const keys = new Set<string>(EXTRA_APP_SETTING_ENV_KEYS);
  for (const configKey of configStore.listUpdatableKeys()) {
    const envKey = configStore.getEnvKey(configKey);
    if (envKey) keys.add(envKey);
  }
  return keys;
}

export interface ProjectEnvLoadResult {
  /** Absolute path of the config-root .env, or null when absent. */
  envFile: string | null;
  /** Keys applied (they were unset in the process). */
  applied: string[];
  /** Keys skipped because the process already carried a value. */
  skipped: string[];
}

/**
 * Parse KEY=VALUE lines from .env content. Mirrors the parsing used by the
 * shell startup scripts and by applyEnvUpdatesToFile on the write side:
 * comments and blank lines are ignored, surrounding quotes are stripped.
 */
export function parseEnvFileContents(contents: string): Array<{ name: string; value: string }> {
  const entries: Array<{ name: string; value: string }> = [];
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf('=');
    if (sep < 0) continue;
    const name = line.slice(0, sep).trim();
    if (!name) continue;
    const value = line.slice(sep + 1).trim().replace(/^["']+|["']+$/g, '');
    entries.push({ name, value });
  }
  return entries;
}

/**
 * Load app-setting keys from the config-root .env into `env`, only if unset.
 * Meant to be called once at boot. Never throws: an unreadable file is
 * reported as an empty result and the caller logs it.
 */
export function loadProjectEnvIntoProcess(env: NodeJS.ProcessEnv = process.env): ProjectEnvLoadResult {
  const envFile = resolve(resolveActiveProjectRoot(), '.env');
  if (!existsSync(envFile)) return { envFile: null, applied: [], skipped: [] };

  const eligible = projectEnvAppSettingKeys();
  const applied: string[] = [];
  const skipped: string[] = [];
  let contents: string;
  try {
    contents = readFileSync(envFile, 'utf8');
  } catch {
    return { envFile, applied, skipped };
  }

  for (const { name, value } of parseEnvFileContents(contents)) {
    if (!eligible.has(name)) continue;
    const existing = env[name];
    if (existing !== undefined && existing !== '') {
      skipped.push(name);
      continue;
    }
    env[name] = value;
    applied.push(name);
  }
  return { envFile, applied, skipped };
}
