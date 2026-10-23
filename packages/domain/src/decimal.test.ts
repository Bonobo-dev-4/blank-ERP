import { describe, expect, it } from 'vitest';
import { Decimal, amount, dec, qty, rate, sumQty, toStr } from './decimal';

describe('decimal foundation', () => {
  it('does not accumulate binary floating point error', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. In the ledger it must.
    expect(toStr(dec('0.1').plus(dec('0.2')))).toBe('0.3');
    const hundredth = Array.from({ length: 100 }, () => '0.01');
    expect(toStr(sumQty(hundredth))).toBe('1');
  });

  it('routes JS numbers through String to avoid smuggling float error', () => {
    expect(toStr(dec(0.1).plus(dec(0.2)))).toBe('0.3');
  });

  it('rejects non-finite quantities rather than storing NaN', () => {
    expect(() => dec(Number.NaN)).toThrow(TypeError);
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('rounds to the scales the database actually stores', () => {
    expect(qty('262.49999').toFixed()).toBe('262.5');
    expect(rate('1.0000005').toFixed()).toBe('1.000001');
    expect(amount('1234.567').toFixed()).toBe('1234.57');
  });

  it('rounds half away from zero, matching Postgres numeric', () => {
    expect(qty('0.00005').toFixed()).toBe('0.0001');
    expect(amount('2.345').toFixed()).toBe('2.35');
  });

  it('treats null, undefined and empty string as zero', () => {
    for (const v of [null, undefined, '']) expect(dec(v as never).isZero()).toBe(true);
  });

  it('keeps 2.5 x 100 exact for the fabric worked example', () => {
    expect(toStr(qty('2.5').times(100))).toBe('250');
    expect(toStr(qty(dec('250').times('0.05')))).toBe('12.5');
    expect(toStr(qty(dec('250').plus('12.5')))).toBe('262.5');
  });

  it('keeps a long chain of fabric issues exact', () => {
    // 0.35 m of interlining, 1000 garments: a float would drift here.
    let total = new Decimal(0);
    for (let i = 0; i < 1000; i += 1) total = total.plus(dec('0.35'));
    expect(toStr(qty(total))).toBe('350');
  });
});
