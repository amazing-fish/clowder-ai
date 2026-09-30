/**
 * Thread 整理助手 (✨ organize) — each round runs in its own fresh thread.
 *
 * Why a new thread per round (not reuse): the trigger message carries no @, so
 * routing falls back to the last user @-mention in the thread (F194 Z5). Reusing
 * one thread let an earlier "@opus55 …" hijack later rounds and kept stale
 * session context; a fresh thread has no mentions/participants, so it routes to
 * the configured default cat (`PUT /api/config/default-cat`).
 */

export const ORGANIZER_TITLE_PREFIX = 'Thread 整理助手';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** e.g. "Thread 整理助手 · 09-30 12:29" (local time) — distinguishes rounds in the sidebar. */
export function buildOrganizerThreadTitle(now: Date = new Date()): string {
  const stamp = `${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return `${ORGANIZER_TITLE_PREFIX} · ${stamp}`;
}

/** Organizer threads (legacy fixed title or per-round titles) are tooling, not content to label. */
export function isOrganizerThreadTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && title.startsWith(ORGANIZER_TITLE_PREFIX);
}
