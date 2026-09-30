import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('@/utils/api-client', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { sealActiveConciergeSessions } from '../concierge-session-reset';

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

describe('sealActiveConciergeSessions', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('seals every active session with messages, skips sealed and empty ones', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/threads/thr-1/sessions') {
        return json({
          sessions: [
            { id: 's-opus', status: 'active', messageCount: 1 },
            { id: 's-research', status: 'active', messageCount: 4 },
            { id: 's-old', status: 'sealed', messageCount: 9 },
            { id: 's-empty', status: 'active', messageCount: 0 },
          ],
        });
      }
      return json({ ok: true });
    });

    await expect(sealActiveConciergeSessions('thr-1')).resolves.toBe(2);
    const sealCalls = apiFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(sealCalls.map(([path]) => path)).toEqual(['/api/sessions/s-opus/seal', '/api/sessions/s-research/seal']);
  });

  it('leaves a running session alone (409) and does not throw', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.endsWith('/sessions')) return json({ sessions: [{ id: 's-live', status: 'active', messageCount: 2 }] });
      return json({ code: 'SESSION_ACTIVE_INVOCATION' }, 409);
    });
    await expect(sealActiveConciergeSessions('thr-1')).resolves.toBe(0);
  });

  it('returns 0 on network failure', async () => {
    apiFetch.mockRejectedValue(new Error('offline'));
    await expect(sealActiveConciergeSessions('thr-1')).resolves.toBe(0);
  });
});
