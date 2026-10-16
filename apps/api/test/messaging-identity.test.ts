import { describe, expect, it } from 'vitest';
import {
  chatConnectUrl,
  maskPhone,
  matchesProfilePhone,
  parseConnectCommand,
  toE164FromWaId,
  waConnectLink,
} from '../src/modules/messaging/identity';

describe('toE164FromWaId', () => {
  it('prefixes the digits WhatsApp sends with +', () => {
    expect(toE164FromWaId('919109516207')).toBe('+919109516207');
  });
  it('strips anything that is not a digit', () => {
    expect(toE164FromWaId('+91 91095-16207')).toBe('+919109516207');
  });
  it('rejects ids that cannot be a phone number', () => {
    expect(() => toE164FromWaId('1234')).toThrow();
    expect(() => toE164FromWaId('1234567890123456')).toThrow();
  });
});

describe('maskPhone', () => {
  it('keeps the country code, two digits and the last three', () => {
    expect(maskPhone('+919109516207')).toBe('+9191•••••207');
  });
});

describe('matchesProfilePhone', () => {
  it('matches when the last 10 digits equal the 10-digit profile number', () => {
    expect(matchesProfilePhone('+919109516207', '9109516207')).toBe(true);
  });
  it('does not match a different number', () => {
    expect(matchesProfilePhone('+919109516207', '9000000000')).toBe(false);
  });
  it('does not match when there is no profile number', () => {
    expect(matchesProfilePhone('+919109516207', null)).toBe(false);
  });
  it('does not match a profile value that is not 10 digits', () => {
    expect(matchesProfilePhone('+919109516207', '16207')).toBe(false);
  });
});

describe('parseConnectCommand', () => {
  it('returns the code, uppercased', () => {
    expect(parseConnectCommand('CONNECT ab2cd3ef')).toBe('AB2CD3EF');
  });
  it('tolerates surrounding whitespace and lower-case keyword', () => {
    expect(parseConnectCommand('  connect   AB2CD3EF \n')).toBe('AB2CD3EF');
  });
  it('returns null for anything else', () => {
    expect(parseConnectCommand('hello')).toBeNull();
    expect(parseConnectCommand('CONNECT')).toBeNull();
    expect(parseConnectCommand('CONNECT AB2CD3EF extra')).toBeNull();
  });
});

describe('links', () => {
  it('builds a wa.me link with the prefilled CONNECT message', () => {
    expect(waConnectLink('15556585373', 'AB2CD3EF')).toBe(
      'https://wa.me/15556585373?text=CONNECT%20AB2CD3EF',
    );
  });
  it('builds the connect page URL without a double slash', () => {
    expect(chatConnectUrl('https://app.aivastra.com/', 'tok')).toBe(
      'https://app.aivastra.com/connect/whatsapp?t=tok',
    );
  });
});
