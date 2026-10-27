import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads plain comma-separated rows keyed by header', () => {
    expect(parseCsv('code,name\nA1,Alpha\nB2,Beta\n').rows).toEqual([
      { code: 'A1', name: 'Alpha' }, { code: 'B2', name: 'Beta' },
    ]);
  });

  it('handles quotes, embedded commas, doubled quotes and line breaks in cells', () => {
    const { rows } = parseCsv('code,notes\r\nA1,"Cotton, 60"" wide"\r\nB2,"two\nlines"\r\n');
    expect(rows).toEqual([{ code: 'A1', notes: 'Cotton, 60" wide' }, { code: 'B2', notes: 'two\nlines' }]);
  });

  it("strips Excel's byte-order mark and detects semicolon and tab separators", () => {
    expect(parseCsv('﻿code;name\nA1;Alpha').rows).toEqual([{ code: 'A1', name: 'Alpha' }]);
    expect(parseCsv('code\tname\nA1\tAlpha').rows).toEqual([{ code: 'A1', name: 'Alpha' }]);
  });

  it('skips blank lines and fills missing trailing cells with empty strings', () => {
    expect(parseCsv('a,b,c\n\n1,2\n,,\n').rows).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('removes the formula-protection quote our exports add', () => {
    expect(parseCsv("qty,reason\n'-5,Damaged\n'=SUM(A1),x").rows).toEqual([
      { qty: '-5', reason: 'Damaged' }, { qty: '=SUM(A1)', reason: 'x' },
    ]);
  });
});
