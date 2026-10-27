'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

/**
 * CSV export, client-side.
 *
 * The rows being exported are the rows already on screen, fetched under the
 * viewer's own permissions — so exporting here cannot leak anything the
 * screen itself would not show, which a separate export endpoint would have
 * to re-prove.
 */
function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined): string => {
    let s = v === null || v === undefined ? '' : String(v);
    // A cell starting with = + - or @ executes as a formula in Excel and
    // Sheets. A tab character disarms it without changing what a human reads.
    if (/^[=+\-@]/.test(s)) s = `\t${s}`;
    if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
}

export function ExportCsvButton({
  filename, headers, rows, disabled,
}: {
  filename: string;
  headers: string[];
  /** Row data in header order. Computed lazily so an unopened export costs nothing. */
  rows: () => (string | number | null | undefined)[][];
  disabled?: boolean;
}) {
  const download = () => {
    const data = rows();
    // BOM prefix so Excel opens ₹ and other non-ASCII correctly.
    const blob = new Blob([`﻿${toCsv(headers, data)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button size="sm" variant="default" onClick={download} disabled={disabled}>
      <Download /> Export CSV
    </Button>
  );
}
