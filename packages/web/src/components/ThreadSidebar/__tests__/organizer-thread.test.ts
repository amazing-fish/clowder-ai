import { describe, expect, it } from 'vitest';
import { buildOrganizerThreadTitle, isOrganizerThreadTitle, ORGANIZER_TITLE_PREFIX } from '../organizer-thread';

describe('organizer-thread', () => {
  it('builds a per-round title with local MM-DD HH:mm', () => {
    expect(buildOrganizerThreadTitle(new Date(2026, 8, 30, 4, 7))).toBe(`${ORGANIZER_TITLE_PREFIX} · 09-30 04:07`);
  });

  it('recognises both legacy fixed and per-round organizer titles', () => {
    expect(isOrganizerThreadTitle('Thread 整理助手')).toBe(true);
    expect(isOrganizerThreadTitle('Thread 整理助手 · 09-30 12:29')).toBe(true);
    expect(isOrganizerThreadTitle('@opus55 如下任务')).toBe(false);
    expect(isOrganizerThreadTitle(undefined)).toBe(false);
    expect(isOrganizerThreadTitle(null)).toBe(false);
  });
});
