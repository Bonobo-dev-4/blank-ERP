/**
 * CSV parsing shared by every import.
 *
 * Pure — no browser or server APIs — so it is tested once here and used by
 * the web dialog as is.
 */
/**
 * CSV as spreadsheets actually write it: quoted cells with commas, quotes
 * and line breaks inside them, a byte-order mark from Excel, and comma,
 * semicolon or tab separators (detected from the header line).
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!;

  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) records.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) records.push(row);

  const [head = [], ...body] = records;
  const headers = head.map((h) => h.trim());
  // Our exports prefix a quote to cells that could run as formulas; take it off.
  const clean = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);
  const rows = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, clean(r[i] ?? '')])));
  return { headers, rows };
}
