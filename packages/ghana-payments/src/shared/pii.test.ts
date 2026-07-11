import { hashPhone } from './pii.js';

// Regression: wallet endpoints get the phone percent-encoded from the URL path while
// payment initiation gets it decoded from the JSON body. If they hash different
// strings, top-up funds a different wallet than the payment debits (always 402).
describe('hashPhone canonicalization', () => {
  it('URL-encoded and decoded forms of the same phone hash identically', () => {
    expect(hashPhone('%2B233201234567')).toBe(hashPhone('+233201234567'));
  });

  it('whitespace differences do not matter', () => {
    expect(hashPhone('024 123 4567')).toBe(hashPhone('0241234567'));
  });

  it('different phones still hash differently', () => {
    expect(hashPhone('0241234567')).not.toBe(hashPhone('0247654321'));
  });

  it('a malformed percent-sequence does not throw', () => {
    expect(() => hashPhone('024%')).not.toThrow();
  });
});
