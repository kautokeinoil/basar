import { describe, it, expect } from 'vitest';
import { normalizePhone } from './phone';

describe('telefonnummer', () => {
  it('norsk', () => {
    expect(normalizePhone('412 34 567')).toBe('+4741234567');
    expect(normalizePhone('+47 412 34 567')).toBe('+4741234567');
    expect(normalizePhone('4741234567', 'NO')).toBe('+4741234567');
    expect(normalizePhone('1234')).toBeNull();
  });
  it('svensk med eller uten 0', () => {
    expect(normalizePhone('070-123 45 67', 'SE')).toBe('+46701234567');
    expect(normalizePhone('+46 70 123 45 67')).toBe('+46701234567');
  });
  it('finsk', () => {
    expect(normalizePhone('040 123 4567', 'FI')).toBe('+358401234567');
    expect(normalizePhone('00358 40 123 4567')).toBe('+358401234567');
  });
  it('annet land krever landskode', () => {
    expect(normalizePhone('12345678', 'ANNET')).toBeNull();
    expect(normalizePhone('+49 151 23456789', 'ANNET')).toBe('+4915123456789');
  });
});
