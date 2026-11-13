import { describe, expect, it } from 'vitest';
import { blockerText, parseRetention, validateChannel } from './crm-form';

describe('validateChannel', () => {
  const ok = {
    wabaId: '102030405060',
    phoneNumberId: '112233445566',
    accessToken: 'EAAG'.padEnd(40, 'x'),
    appSecret: 'a'.repeat(32),
  };
  it('accepts a complete draft', () => {
    expect(validateChannel(ok)).toEqual({});
  });
  it('flags a phone number typed where the phone number ID belongs', () => {
    expect(validateChannel({ ...ok, phoneNumberId: '+91 98765 43210' }).phoneNumberId).toMatch(
      /phone number ID/,
    );
  });
  it('flags short secrets', () => {
    const e = validateChannel({ ...ok, accessToken: 'short', appSecret: 'short' });
    expect(Object.keys(e).sort()).toEqual(['accessToken', 'appSecret']);
  });
});

describe('parseRetention', () => {
  it('requires a choice and whole days within bounds', () => {
    expect(parseRetention('', 'photo')).toMatch(/Choose/);
    expect(parseRetention('1.5', 'photo')).toMatch(/Whole/);
    expect(parseRetention('0', 'photo')).toMatch(/Between 1 and 365/);
    expect(parseRetention('29', 'profile')).toMatch(/Between 30 and 1095/);
    expect(parseRetention(' 90 ', 'photo')).toBe(90);
    expect(parseRetention('730', 'profile')).toBe(730);
  });
});

describe('blockerText', () => {
  it('explains every blocker the API sends, and passes unknown ones through', () => {
    for (const b of ['feature_off', 'no_channel', 'no_retention']) {
      expect(blockerText(b)).not.toBe(b);
    }
    expect(blockerText('something_new')).toBe('something_new');
  });
});
