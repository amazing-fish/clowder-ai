import { join } from 'node:path';
import { readPrivateFile, writeAtomicPrivate } from '@cat-cafe/shared/node-private-fs';
import { CollectiveServiceError } from './errors.js';
import { secretMatches } from './persistence.js';
import type { ServiceState } from './state.js';

export const BOOTSTRAP_LINK_FILE = 'owner-bootstrap.url';

export async function validateStartupBootstrap(
  state: ServiceState,
  options: { dataDirectory: string; publicUrl: string; now: number },
): Promise<void> {
  if (state.bootstrap.consumedAt !== undefined) return;
  const path = join(options.dataDirectory, BOOTSTRAP_LINK_FILE);
  let link: string | undefined;
  try {
    link = await readPrivateFile(path);
  } catch (error) {
    // Permission and IO failures are never treated as a lost secret.
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (link && validLink(link, state, options.publicUrl, options.now)) return;
  throw new CollectiveServiceError(
    'BOOTSTRAP_UNRECOVERABLE',
    'Collective Service bootstrap_unrecoverable: initialization link is missing or invalid; this version does not support automatic recovery; data is preserved; see #1563',
    409,
  );
}

export async function writeBootstrapLink(directory: string, publicUrl: string, secret: string): Promise<void> {
  const url = new URL(publicUrl);
  url.hash = `bootstrap=${encodeURIComponent(secret)}`;
  await writeAtomicPrivate(join(directory, BOOTSTRAP_LINK_FILE), `${url.href}\n`);
}

function validLink(link: string, state: ServiceState, publicUrl: string, now: number): boolean {
  if (Date.parse(state.bootstrap.expiresAt) < now) return false;
  try {
    const url = new URL(link.trim());
    const expected = new URL(publicUrl);
    const secret = new URLSearchParams(url.hash.slice(1)).get('bootstrap');
    return (
      url.origin === expected.origin &&
      url.pathname === expected.pathname &&
      !url.search &&
      !url.username &&
      !url.password &&
      Boolean(secret && secretMatches(secret, state.bootstrap.tokenDigest))
    );
  } catch {
    return false;
  }
}
