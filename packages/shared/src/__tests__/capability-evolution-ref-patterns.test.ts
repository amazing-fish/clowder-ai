import { describe, expect, it } from 'vitest';
import {
  EVOLUTION_JOIN_KEY_PATTERN,
  NON_PAYLOAD_REF_ID_PATTERN,
  OWNER_STATE_REF_PATTERN,
  OWNER_STATE_REF_PREFIX_PATTERN,
  ownerTruthRefV1Schema,
} from '../types/capability-evolution-refs.js';

describe('non-payload reference boundaries', () => {
  it('keeps exact refs, prefixes, and observation coordinates distinct', () => {
    expect(OWNER_STATE_REF_PATTERN.test('owner:')).toBe(false);
    expect(OWNER_STATE_REF_PREFIX_PATTERN.test('owner:')).toBe(true);
    expect(NON_PAYLOAD_REF_ID_PATTERN.test('')).toBe(false);
    expect(EVOLUTION_JOIN_KEY_PATTERN.test('owner:id')).toBe(false);
    for (const kind of ['thread', 'message', 'subject']) {
      expect(EVOLUTION_JOIN_KEY_PATTERN.test(`${kind}:id`)).toBe(true);
    }
    for (const id of ['abc', '路径/证据', '🐾', 'revision@hash#part', 'nested:coordinate']) {
      expect(OWNER_STATE_REF_PATTERN.test(`owner:${id}`)).toBe(true);
      expect(NON_PAYLOAD_REF_ID_PATTERN.test(id)).toBe(true);
      expect(
        ownerTruthRefV1Schema.parse({ ownerFeatureId: 'F311', ownerStateRef: ` owner:${id} ` }).ownerStateRef,
      ).toBe(`owner:${id}`);
    }
  });

  it('still rejects embedded payload delimiters and whitespace at every ref boundary', () => {
    for (const forbidden of ['[', ']', '{', '}', '"', "'", ' ', '\t', '\r', '\n', '\u00a0', '\u2028']) {
      const id = `before${forbidden}after`;
      expect(NON_PAYLOAD_REF_ID_PATTERN.test(id)).toBe(false);
      expect(OWNER_STATE_REF_PATTERN.test(`owner:${id}`)).toBe(false);
      expect(OWNER_STATE_REF_PREFIX_PATTERN.test(`owner:${id}`)).toBe(false);
      expect(EVOLUTION_JOIN_KEY_PATTERN.test(`thread:${id}`)).toBe(false);
      expect(ownerTruthRefV1Schema.safeParse({ ownerFeatureId: 'F311', ownerStateRef: `owner:${id}` }).success).toBe(
        false,
      );
    }
  });
});
