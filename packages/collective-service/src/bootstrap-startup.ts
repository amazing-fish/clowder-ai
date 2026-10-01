import { join } from 'node:path';
import { readPrivateFile, writeAtomicPrivate } from '@cat-cafe/shared/node-private-fs';
import { CollectiveServiceError } from './errors.js';
import { createSecret, digestSecret, secretMatches } from './persistence.js';
import type { ServiceState } from './state.js';

export const BOOTSTRAP_LINK_FILE = 'owner-bootstrap.url';

export async function prepareStartupBootstrap(
  state: ServiceState,
  options: { dataDirectory: string; publicUrl: string; now: number; ttlMs: number },
): Promise<ServiceState> {
  if (state.bootstrap.consumedAt !== undefined) return state;
  const path = join(options.dataDirectory, BOOTSTRAP_LINK_FILE);
  let link: string | undefined;
  try {
    link = await readPrivateFile(path);
  } catch (error) {
    // Permission and IO failures are never treated as a lost secret.
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (link && validLink(link, state, options.publicUrl, options.now)) return state;
  if (!isPristine(state)) {
    throw new CollectiveServiceError(
      'BOOTSTRAP_UNRECOVERABLE',
      'Collective Service bootstrap_unrecoverable: initialization link is missing or invalid and state is not pristine; preserve data and use owner recovery',
      409,
    );
  }
  const secret = createSecret();
  await writeBootstrapLink(options.dataDirectory, options.publicUrl, secret);
  return {
    ...state,
    bootstrap: { tokenDigest: digestSecret(secret), expiresAt: new Date(options.now + options.ttlMs).toISOString() },
  };
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

function isPristine(state: ServiceState): boolean {
  if (state.bootstrap.consumedAt !== undefined || state.bootstrap.ownerHumanId !== undefined) return false;
  // The strict schema includes every record collection, even legacy history and
  // indexes, so new record collections cannot silently bypass this boundary.
  return Object.entries(state).every(
    ([key, value]) =>
      ['schemaVersion', 'serviceInstanceId', 'createdAt', 'bootstrap'].includes(key) ||
      (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0),
  );
}
