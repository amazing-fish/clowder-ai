/**
 * DSH launcher-region model (mirrors `@deepseek-ai/dsh` lib/types/args.js).
 *
 * The DSH CLI parses with commander `allowUnknownOption().passThroughOptions()`:
 * it consumes only its own launcher flags, and the FIRST token it does not
 * recognize starts the app arguments, which are handed to the booted profile
 * verbatim. A `--patch` placed after that boundary (e.g. after `--` or after an
 * app flag such as `--log-level info`) reaches the app, not the launcher, so a
 * host patch must be inserted inside the launcher region or not at all.
 *
 * This module proves where that region is. Anything it cannot prove (unknown
 * launcher shape, `plugin` mode, config dumps, version, non-acp profile) returns
 * null so the caller keeps the full-identity path instead of claiming native L0.
 */

import { basename } from 'node:path';

const DSH_PACKAGE_MARKER = /[\\/]@deepseek-ai[\\/]dsh[\\/]/i;
const DSH_BINARY = /^dsh(\.cmd|\.exe|\.ps1)?$/i;

/** Launcher options that take exactly one value (commander required option). */
const VALUE_OPTIONS = new Set(['--profile', '--from-default-profile', '--patch']);
/** Launcher flags that switch DSH out of boot mode: never native. */
const NON_BOOT_FLAGS = new Set(['--dump-config', '--dump-config-schema', '--dump-default-config', '-V', '--version']);

export interface DshLauncherRegion {
  /** Index in `args` of the first launcher token (after the dsh script, if any). */
  start: number;
  /** Index in `args` of the first app token (or args.length); insertion point. */
  end: number;
  profile: string;
}

/** Index of the first launcher token, or -1 when the bootstrap is not the DSH CLI. */
function launcherStart(command: string, args: readonly string[]): number {
  if (DSH_BINARY.test(basename(command))) return 0;
  const scriptIdx = args.findIndex((arg) => DSH_PACKAGE_MARKER.test(arg));
  return scriptIdx >= 0 ? scriptIdx + 1 : -1;
}

function splitInline(token: string): { name: string; inline?: string } {
  const eq = token.indexOf('=');
  if (!token.startsWith('--') || eq < 0) return { name: token };
  return { name: token.slice(0, eq), inline: token.slice(eq + 1) };
}

/**
 * Walk the launcher tokens exactly as commander would, stopping at the first
 * app token. Returns null for any shape we cannot prove boots `--profile acp`.
 */
export function locateDshLauncherRegion(command: string, args: readonly string[]): DshLauncherRegion | null {
  const start = launcherStart(command, args);
  if (start < 0) return null;
  let i = start;
  let profile: string | undefined;
  const first = args[i];
  // `dsh <name> …` abbreviates `dsh --profile <name> …`; `plugin` is pnpm forwarding.
  if (first === 'plugin') return null;
  if (first !== undefined && !first.startsWith('-')) {
    profile = first;
    i++;
  }
  while (i < args.length) {
    const token = args[i] as string;
    if (token === '--') break;
    if (NON_BOOT_FLAGS.has(token)) return null;
    const { name, inline } = splitInline(token);
    if (!VALUE_OPTIONS.has(name)) break; // first unknown token starts the app args
    let value = inline;
    if (value === undefined) {
      value = args[i + 1];
      if (value === undefined) return null; // commander would error: missing argument
      i += 2;
    } else {
      i += 1;
    }
    if (name === '--profile') {
      if (profile !== undefined) return null; // "select a profile only once"
      profile = value;
    }
  }
  if (profile !== 'acp') return null;
  return { start, end: i, profile };
}

/**
 * Rebuild args with `extra` inserted at the end of the launcher region and any
 * caller-supplied launcher `--patch` removed (the patch channel is host-owned).
 * App-region tokens are left byte-identical, including an app's own `--patch`.
 */
export function insertIntoDshLauncherRegion(
  args: readonly string[],
  region: DshLauncherRegion,
  extra: readonly string[],
): string[] {
  const launcher: string[] = [];
  for (let i = region.start; i < region.end; i++) {
    const token = args[i] as string;
    const { name, inline } = splitInline(token);
    if (name === '--patch') {
      if (inline === undefined) i++;
      continue;
    }
    launcher.push(token);
  }
  return [...args.slice(0, region.start), ...launcher, ...extra, ...args.slice(region.end)];
}
