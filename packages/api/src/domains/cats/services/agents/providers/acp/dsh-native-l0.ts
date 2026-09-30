/**
 * DSH native L0 channel (ACP carrier).
 *
 * DeepSeek Harness (`@deepseek-ai/dsh`, `--profile acp`) assembles its own
 * system prompt from the `system-prompt` plugin (`personaPrefix` /
 * `personaSuffix`). Its ACP surface has no per-turn system-instruction field,
 * but the CLI accepts `--patch <file>` which overrides plugin config at spawn
 * (verified against the installed dsh via `--dump-config`, 2026-09-30).
 *
 * We therefore compile the per-cat L0 once at pool spawn, write it into a
 * content-addressed patch file, and append `--patch <file>` to the startup
 * args. Because the path embeds the L0 hash, any L0 change changes the args,
 * which changes the pool spawn signature and retires the old process on the
 * next registry sync — no hidden mutable prompt state.
 *
 * Constraints (verified):
 *  - The patch REPLACES the plugin `config` object, so `personaSuffix` must be
 *    carried explicitly or DSH loses its cwd line.
 *  - DSH interpolates `{{name}}` in persona text with no escape syntax. An L0
 *    containing `{{` would be silently rewritten, so we refuse the native
 *    channel for it (fail closed to the user-prompt prepend path).
 *  - One process serves every multiplexed session, so the L0 is per pool
 *    (owner-scoped), not per invocation.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export const DSH_PATCH_FLAG = '--patch';
/** DSH's default suffix; must be re-supplied because the patch replaces `config`. */
export const DSH_DEFAULT_PERSONA_SUFFIX = 'Your working directory is {{cwd}}.';

const DSH_PACKAGE_MARKER = /[\\/]@deepseek-ai[\\/]dsh[\\/]/i;

/** True when the ACP bootstrap launches the DSH CLI in its ACP profile. */
export function isDshAcpBootstrap(command: string, args: readonly string[]): boolean {
  const launchesDsh =
    /^dsh(\.cmd|\.exe)?$/i.test(basename(command)) || args.some((arg) => DSH_PACKAGE_MARKER.test(arg));
  if (!launchesDsh) return false;
  const profileIdx = args.indexOf('--profile');
  return profileIdx >= 0 && args[profileIdx + 1] === 'acp';
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

/** Content-addressed write: same L0 → same path → same spawn signature. */
export function writeDshL0PatchFile(catId: string, content: string, baseDir: string = tmpdir()): string {
  const dir = join(baseDir, 'cat-cafe-dsh-l0');
  mkdirSync(dir, { recursive: true });
  const safeCat = catId.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'cat';
  const hash = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
  const path = join(dir, `${safeCat}-${hash}.json`);
  writeFileSync(path, content, 'utf8');
  return path;
}

/**
 * `--patch` is server-owned for DSH members: a user-supplied patch could
 * override `system-prompt` and silently defeat the L0 guarantee.
 */
export function stripReservedDshArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === DSH_PATCH_FLAG) {
      i++;
      continue;
    }
    if (arg.startsWith(`${DSH_PATCH_FLAG}=`)) continue;
    out.push(arg);
  }
  return out;
}

export interface DshNativeL0Binding {
  args: string[];
  fingerprint: string;
  patchPath: string;
}

export type DshL0Compiler = (options: { catId: string; userId?: string }) => Promise<string>;

/**
 * Spawn-time resolution used by the ACP factory. Any compile failure keeps the
 * legacy prepend path (the route layer then sends the full identity in-prompt),
 * so a broken compiler can never produce an identity-less DSH cat.
 */
export async function resolveDshNativeL0(
  catId: string,
  command: string,
  args: readonly string[],
  compile: DshL0Compiler,
  onError?: (error: unknown) => void,
): Promise<DshNativeL0Binding | null> {
  if (!isDshAcpBootstrap(command, args)) return null;
  try {
    return prepareDshNativeL0(catId, args, await compile({ catId }));
  } catch (error) {
    onError?.(error);
    return null;
  }
}

/** What the ACP service needs to keep the spawn-time L0 honest per invocation. */
export interface DshNativeL0Guard {
  fingerprint: string;
  compile: DshL0Compiler;
}

/**
 * Invoke-time drift check. The route layer sends pack-only identity whenever
 * `injectsL0Natively()` is true, so if the L0 compiled NOW (for this owner)
 * differs from the one frozen into the process at spawn, the frozen one is
 * stale and the current L0 must travel in the user prompt instead.
 * Returns the L0 to prepend, or undefined when the spawn-time L0 is current
 * (or unverifiable — a compile error keeps the spawn-time L0, never none).
 */
export async function resolveDshL0DriftPrefix(
  guard: DshNativeL0Guard,
  catId: string,
  userId: string | undefined,
  onDrift?: (reason: 'stale' | 'compile_failed', error?: unknown) => void,
): Promise<string | undefined> {
  let current: string;
  try {
    current = await guard.compile({ catId, ...(userId ? { userId } : {}) });
  } catch (error) {
    onDrift?.('compile_failed', error);
    return undefined;
  }
  if (computeDshL0Fingerprint(current) === guard.fingerprint) return undefined;
  onDrift?.('stale');
  return current.trim() || undefined;
}

/** Compose the final startup args for a DSH member, or null to keep the prepend path. */
export function prepareDshNativeL0(
  catId: string,
  args: readonly string[],
  l0: string,
  baseDir?: string,
): DshNativeL0Binding | null {
  const content = buildDshL0PatchContent(l0);
  if (!content) return null;
  const patchPath = writeDshL0PatchFile(catId, content, baseDir);
  return {
    args: [...stripReservedDshArgs(args), DSH_PATCH_FLAG, patchPath],
    fingerprint: computeDshL0Fingerprint(l0),
    patchPath,
  };
}
