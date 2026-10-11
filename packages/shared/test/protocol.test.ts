import { describe, expect, it } from 'vitest';
import { clientMessageSchema, playerNameSchema } from '../src/protocol.js';

describe('clientMessageSchema', () => {
  it('accepts a valid join', () => {
    expect(clientMessageSchema.safeParse({ t: 'join', name: '  Ada  ' })).toMatchObject({
      success: true,
      data: { t: 'join', name: 'Ada' },
    });
  });

  it('accepts a valid input', () => {
    const r = clientMessageSchema.safeParse({
      t: 'input',
      seq: 5,
      mx: 1,
      my: -1,
      angle: 3.14,
      shoot: true,
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ['unknown type', { t: 'teleport' }],
    ['out-of-range axis', { t: 'input', seq: 1, mx: 5, my: 0, angle: 0, shoot: false }],
    ['negative seq', { t: 'input', seq: -1, mx: 0, my: 0, angle: 0, shoot: false }],
    ['fractional seq', { t: 'input', seq: 1.5, mx: 0, my: 0, angle: 0, shoot: false }],
    ['string shoot', { t: 'input', seq: 1, mx: 0, my: 0, angle: 0, shoot: 'yes' }],
    ['huge angle', { t: 'input', seq: 1, mx: 0, my: 0, angle: 1e9, shoot: false }],
    ['empty name', { t: 'join', name: '   ' }],
    ['non-object', 'hello'],
  ])('rejects %s', (_label, payload) => {
    expect(clientMessageSchema.safeParse(payload).success).toBe(false);
  });
});

describe('playerNameSchema', () => {
  it('allows unicode letters', () => {
    expect(playerNameSchema.safeParse('Zażółć_42').success).toBe(true);
  });

  it('rejects markup, control characters and long names', () => {
    expect(playerNameSchema.safeParse('<script>').success).toBe(false);
    expect(playerNameSchema.safeParse('a\u0000b').success).toBe(false);
    expect(playerNameSchema.safeParse('x'.repeat(17)).success).toBe(false);
  });
});
