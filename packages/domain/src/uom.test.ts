import { describe, expect, it } from 'vitest';
import { ConfigurationError, ValidationError } from './errors';
import { UomConverter } from './uom';

describe('UomConverter', () => {
  it('converts a material-specific roll length', () => {
    const c = new UomConverter([
      { rawMaterialId: 'fab-1', fromUom: 'ROLL', toUom: 'METER', factor: '42.5' },
    ]);
    expect(c.convert(2, 'ROLL', 'METER', 'fab-1').toFixed()).toBe('85');
  });

  it('refuses to guess a conversion that was never configured', () => {
    const c = new UomConverter();
    // There is no universal roll length, so this must fail loudly rather than
    // inventing stock.
    expect(() => c.convert(1, 'ROLL', 'METER', 'fab-1')).toThrow(ConfigurationError);
    expect(() => c.convert(1, 'ROLL', 'METER', 'fab-1')).toThrow(/No configured conversion/);
    expect(c.canConvert('ROLL', 'METER', 'fab-1')).toBe(false);
  });

  it('will not convert METER to KILOGRAM without GSM and width', () => {
    const c = new UomConverter();
    expect(c.canConvert('METER', 'KILOGRAM')).toBe(false);
  });

  it('has the SI mass prefix built in, in both directions', () => {
    const c = new UomConverter();
    expect(c.convert('1.5', 'KILOGRAM', 'GRAM').toFixed()).toBe('1500');
    expect(c.convert('250', 'GRAM', 'KILOGRAM').toFixed()).toBe('0.25');
  });

  it('prefers a material-specific rule over an organisation-wide one', () => {
    const c = new UomConverter([
      { rawMaterialId: null, fromUom: 'ROLL', toUom: 'METER', factor: '50' },
      { rawMaterialId: 'fab-1', fromUom: 'ROLL', toUom: 'METER', factor: '42.5' },
    ]);
    expect(c.convert(1, 'ROLL', 'METER', 'fab-1').toFixed()).toBe('42.5');
    expect(c.convert(1, 'ROLL', 'METER', 'fab-9').toFixed()).toBe('50');
  });

  it('derives the inverse of a configured rule', () => {
    const c = new UomConverter([
      { rawMaterialId: 'fab-1', fromUom: 'ROLL', toUom: 'METER', factor: '40' },
    ]);
    expect(c.convert('80', 'METER', 'ROLL', 'fab-1').toFixed()).toBe('2');
  });

  it('is an identity for the same unit', () => {
    expect(new UomConverter().convert('7.25', 'METER', 'METER').toFixed()).toBe('7.25');
  });

  it('rejects a non-positive factor at construction time', () => {
    expect(() => new UomConverter([{ fromUom: 'ROLL', toUom: 'METER', factor: '0' }])).toThrow(ValidationError);
    expect(() => new UomConverter([{ fromUom: 'ROLL', toUom: 'METER', factor: '-5' }])).toThrow(ValidationError);
  });

  it('converts into a material base unit', () => {
    const c = new UomConverter([
      { rawMaterialId: 'fab-1', fromUom: 'ROLL', toUom: 'METER', factor: '42.5' },
    ]);
    expect(c.toBase('3', 'ROLL', { id: 'fab-1', baseUom: 'METER' }).toFixed()).toBe('127.5');
  });
});
