/**
 * Cat Ball: every bubble open starts a fresh cat session ("新一轮").
 *
 * The concierge thread is a per-user singleton (F229 INV-9), so without this the
 * duty cat's CLI session carried over for days and cats that answered earlier
 * (e.g. opus / research) kept their stale sessions. Sealing keeps the visible
 * thread history; only the cat's working session restarts on the next message.
 *
 * Best-effort: a running invocation (409) or liveness gap (503) is left alone.
 */

import { apiFetch } from '@/utils/api-client';

interface SessionSummary {
  id: string;
  status: string;
  messageCount?: number;
}

export async function sealActiveConciergeSessions(threadId: string): Promise<number> {
  let sealed = 0;
  try {
    const res = await apiFetch(`/api/threads/${encodeURIComponent(threadId)}/sessions`);
    if (!res.ok) return 0;
    const data = (await res.json()) as { sessions?: SessionSummary[] };
    const active = (data.sessions ?? []).filter((s) => s.status === 'active' && (s.messageCount ?? 0) > 0);
    for (const session of active) {
      const sealRes = await apiFetch(`/api/sessions/${encodeURIComponent(session.id)}/seal`, { method: 'POST' });
      if (sealRes.ok) sealed += 1;
    }
  } catch {
    // Network error: keep the old session rather than blocking the bubble.
  }
  return sealed;
}
