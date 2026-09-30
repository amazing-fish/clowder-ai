/**
 * DSH native L0 channel (ACP carrier).
 *
 * DeepSeek Harness (`@deepseek-ai/dsh`, `--profile acp`) assembles its own
 * system prompt from the `system-prompt` plugin (`personaPrefix` /
 * `personaSuffix`). Its ACP surface has no per-turn system-instruction field,
 * but the launcher accepts `--patch <file>` which overrides plugin config at
 * spawn (verified against the installed dsh via `--dump-config`, 2026-09-30).
 *
 * The L0 is owner-scoped (it embeds the owner's profile capsule), and one DSH
 * process serves every multiplexed session, so the L0 is bound per invocation:
 *  1. compile the L0 for the invocation owner (never the process default user);
 *  2. write it into a content-addressed patch file;
 *  3. acquire from a pool key scoped by (owner, L0 fingerprint) whose spawn args
 *     carry that patch inside the proven launcher region.
 * A different owner or a changed L0 therefore lands on a different process;
 * nothing ever reuses another owner's or a stale system prompt. Anything that
 * cannot be proven (no owner, compile failure, unsafe L0) fails closed.
 *
 * Constraints (verified):
 *  - The patch REPLACES the plugin `config` object, so `personaSuffix` must be
 *    carried explicitly or DSH loses its cwd line.
 *  - DSH interpolates `{{name}}` in persona text with no escape syntax. An L0
 *    containing `{{` would be silently rewritten, so it is refused.
 *  - `--patch` after the launcher region reaches the app, not the launcher
 *    (see dsh-launcher-args.ts), so it is inserted only inside that region.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestGenerationSourceRef } from '@cat-cafe/shared';
import { CAT_CAFE_SYSTEM_PROMPT_SOURCE_REF } from '../../../session/request-generation-source-policy.js';
import type { PoolKey } from './AcpProcessPool.js';
import { insertIntoDshLauncherRegion, locateDshLauncherRegion } from './dsh-launcher-args.js';

export const DSH_PATCH_FLAG = '--patch';
/** DSH's default suffix; must be re-supplied because the patch replaces `config`. */
export const DSH_DEFAULT_PERSONA_SUFFIX = 'Your working directory is {{cwd}}.';
/** F299 injection decision recorded for the patch-carried L0. */
export const DSH_NATIVE_L0_INJECTION_DECISION = 'dsh_launcher_patch_persona_prefix';

/** True only when the bootstrap provably boots the DSH launcher with `--profile acp`. */
export function isDshAcpBootstrap(command: string, args: readonly string[]): boolean {
  return locateDshLauncherRegion(command, args) !== null;
}

export function computeDshL0Fingerprint(l0: string): string {
  return createHash('sha256').update(l0.trim(), 'utf8').digest('hex');
}

/** Returns the patch JSON, or null when the L0 cannot travel the native channel safely. */
export function buildDshL0PatchContent(l0: string): string | null {
  const body = l0.trim();
  if (!body || body.includes('{{')) return null;
  return `${JSON.stringify(
    [{ id: 'system-prompt', config: { personaPrefix: body, personaSuffix: DSH_DEFAULT_PERSONA_SUFFIX } }],
    null,
    2,
  )}\n`;
}

/** Content-addressed write: same L0 → same path → same spawn args. Owner-private (0600). */
export function writeDshL0PatchFile(catId: string, content: string, baseDir: string = tmpdir()): string {
  const dir = join(baseDir, 'cat-cafe-dsh-l0');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const safeCat = catId.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'cat';
  const hash = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
  const path = join(dir, `${safeCat}-${hash}.json`);
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
  return path;
}

export interface DshNativeL0Binding {
  /** Full spawn args with `--patch <file>` inside the launcher region. */
  args: string[];
  fingerprint: string;
  patchPath: string;
  /** The exact persona prefix the patch carries (trimmed L0). */
  body: string;
}

/** Compose spawn args for a DSH member, or null when native L0 cannot be proven. */
export function prepareDshNativeL0(
  catId: string,
  command: string,
  args: readonly string[],
  l0: string,
  baseDir?: string,
): DshNativeL0Binding | null {
  const region = locateDshLauncherRegion(command, args);
  if (!region) return null;
  const content = buildDshL0PatchContent(l0);
  if (!content) return null;
  const patchPath = writeDshL0PatchFile(catId, content, baseDir);
  return {
    args: insertIntoDshLauncherRegion(args, region, [DSH_PATCH_FLAG, patchPath]),
    fingerprint: computeDshL0Fingerprint(l0),
    patchPath,
    body: l0.trim(),
  };
}

export type DshL0Compiler = (options: { catId: string; userId?: string }) => Promise<string>;

/** Factory → service contract: how to launch an owner-bound DSH process. */
export interface DshNativeL0Launcher {
  command: string;
  /** Registry bootstrap args (without any host patch). */
  baseArgs: readonly string[];
  compile: DshL0Compiler;
  patchDir?: string;
}

export type DshNativeLaunchResult =
  | { ok: true; binding: DshNativeL0Binding; nativeScope: string }
  | { ok: false; reason: 'owner_missing' | 'compile_failed' | 'patch_unavailable'; error?: unknown };

/**
 * Pool scope = hash(owner, L0 fingerprint). Hashed so pool-key logs never carry
 * the raw owner id; distinct owners or revisions can never share a process.
 */
export function computeDshNativeScope(userId: string, fingerprint: string): string {
  return createHash('sha256').update(`${userId}\0${fingerprint}`, 'utf8').digest('hex').slice(0, 32);
}

/** Invoke-time resolution. Every non-provable case is a typed failure (fail closed). */
export async function resolveDshNativeLaunch(
  launcher: DshNativeL0Launcher,
  catId: string,
  userId: string | undefined,
): Promise<DshNativeLaunchResult> {
  const owner = userId?.trim();
  if (!owner) return { ok: false, reason: 'owner_missing' };
  let l0: string;
  try {
    l0 = await launcher.compile({ catId, userId: owner });
  } catch (error) {
    return { ok: false, reason: 'compile_failed', error };
  }
  let binding: DshNativeL0Binding | null;
  try {
    // Materialization touches disk (mkdir/write); EACCES/ENOSPC/ENOTDIR must stay typed.
    binding = prepareDshNativeL0(catId, launcher.command, launcher.baseArgs, l0, launcher.patchDir);
  } catch (error) {
    return { ok: false, reason: 'patch_unavailable', error };
  }
  if (!binding) return { ok: false, reason: 'patch_unavailable' };
  return { ok: true, binding, nativeScope: computeDshNativeScope(owner, binding.fingerprint) };
}

export interface DshNativeInstruction {
  body: string;
  sourceRefs: readonly RequestGenerationSourceRef[];
  injectionDecision: string;
}

/** F299 native channel for the patch-carried L0: exact body + patch binding evidence. */
export function buildDshNativeInstructions(binding: DshNativeL0Binding): readonly DshNativeInstruction[] {
  return Object.freeze([
    Object.freeze({
      body: binding.body,
      sourceRefs: Object.freeze([
        Object.freeze({ owner: 'system_prompt' as const, ref: CAT_CAFE_SYSTEM_PROMPT_SOURCE_REF }),
        Object.freeze({ owner: 'system_prompt' as const, ref: `dsh-launcher-patch:l0-sha256:${binding.fingerprint}` }),
      ]),
      injectionDecision: DSH_NATIVE_L0_INJECTION_DECISION,
    }),
  ]);
}

export type DshInvocationLaunch =
  | { ok: true; poolKey: PoolKey; nativeInstructions: readonly DshNativeInstruction[]; fingerprint: string }
  | { ok: false; reason: 'owner_missing' | 'compile_failed' | 'patch_unavailable'; error?: unknown };

/** Service seam: owner-bound pool key + the native instructions that key's process carries. */
export async function resolveDshInvocationLaunch(
  launcher: DshNativeL0Launcher,
  basePoolKey: PoolKey,
  catId: string,
  userId: string | undefined,
): Promise<DshInvocationLaunch> {
  const launch = await resolveDshNativeLaunch(launcher, catId, userId);
  if (!launch.ok) return launch;
  return {
    ok: true,
    poolKey: { ...basePoolKey, nativeLaunch: { scope: launch.nativeScope, args: launch.binding.args } },
    nativeInstructions: buildDshNativeInstructions(launch.binding),
    fingerprint: launch.binding.fingerprint,
  };
}
