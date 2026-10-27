'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSpreadsheet, FileUp, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  IMPORT_SPECS, MAX_IMPORT_ROWS, parseCsv,
  type ImportAction, type ImportResult, type ImportRowResult, type ImportType,
} from '@dnd/contracts';
import { api, tokenStore } from '@/lib/api';
import { cn, newIdempotencyKey } from '@/lib/utils';
import { Badge, Button, ErrorPanel } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from './auth-context';

async function downloadAuthed(path: string, fallbackName: string) {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function errorReport(type: ImportType, rows: readonly ImportRowResult[]) {
  const bad = rows.filter((r) => r.action === 'error' || r.outcome === 'failed');
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['row,record,problem', ...bad.map((r) => [String(r.row), r.key, [...r.errors, r.message ?? ''].filter(Boolean).join('; ')].map(esc).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-import-problems.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------- dialog */

const ACTION_TONE: Record<ImportAction, 'ok' | 'info' | 'neutral' | 'violet' | 'danger'> = {
  create: 'ok', update: 'info', unchanged: 'neutral', adjust: 'violet', error: 'danger',
};
const ACTION_LABEL: Record<ImportAction, string> = {
  create: 'New', update: 'Update', unchanged: 'No change', adjust: 'Adjust', error: 'Error',
};

/**
 * Import from CSV — one dialog for every importable record type.
 *
 * Nothing is written until the person has seen, row by row, what the file
 * will do; and nothing at all is written if any row has a problem. Shown
 * only to people who hold the permission the matching screen requires.
 */
export function CsvImportButton({
  type, invalidate = [], label = 'Import CSV',
}: {
  type: ImportType;
  /** Query keys to refresh after a successful import. */
  invalidate?: string[];
  label?: string;
}) {
  const { can } = useAuth();
  const spec = IMPORT_SPECS[type];
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const keyRef = React.useRef(newIdempotencyKey());
  const inputRef = React.useRef<HTMLInputElement>(null);

  const preview = useMutation({
    mutationFn: (rows: Record<string, string>[]) => api.post<ImportResult>(`/imports/${type}/preview`, { rows }),
  });
  const commit = useMutation({
    mutationFn: (rows: Record<string, string>[]) =>
      api.post<ImportResult>(`/imports/${type}/commit`, { rows, idempotencyKey: keyRef.current }),
    onSuccess: (r) => {
      if (!r.committed) return;
      for (const k of invalidate) void qc.invalidateQueries({ queryKey: [k] });
      const done = r.rows.filter((x) => x.outcome && x.outcome !== 'failed' && x.outcome !== 'unchanged').length;
      toast.success(`${spec.label}: ${done} row${done === 1 ? '' : 's'} imported`);
    },
  });

  if (!can(spec.permission)) return null;

  const reset = () => {
    setFile(null); setParseError(null); setOnlyProblems(false);
    preview.reset(); commit.reset();
    keyRef.current = newIdempotencyKey();
  };

  const load = async (f: File) => {
    reset();
    if (!/\.(csv|txt)$/i.test(f.name) && f.type && !/csv|text\/plain/.test(f.type)) {
      setParseError('Choose a .csv file. In Excel or Google Sheets, use File → Download / Save as → CSV.');
      return;
    }
    const { rows } = parseCsv(await f.text());
    if (rows.length === 0) { setParseError('That file has a header row but no data rows.'); return; }
    if (rows.length > MAX_IMPORT_ROWS) {
      setParseError(`That file has ${rows.length.toLocaleString('en-IN')} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} per import. Split it into smaller files.`);
      return;
    }
    setFile({ name: f.name, rows });
    preview.mutate(rows);
  };

  const result: ImportResult | undefined = commit.data ?? preview.data;
  const committed = commit.data?.committed ?? false;
  const actionable = result ? result.counts.create + result.counts.update + result.counts.adjust : 0;
  const blocked = !!result && (result.counts.error > 0 || result.missingColumns.length > 0);
  const shown = (result?.rows ?? []).filter((r) => !onlyProblems || r.action === 'error' || r.outcome === 'failed');

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button size="sm" variant="default" onClick={() => setOpen(true)}>
        <FileUp /> {label}
      </Button>
      <DialogContent
        wide
        title={`Import ${spec.label.toLowerCase()} from CSV`}
        description={spec.description}
        footer={
          <>
            {result && (result.counts.error > 0 || result.rows.some((r) => r.outcome === 'failed')) ? (
              <Button variant="ghost" onClick={() => errorReport(type, result.rows)}>
                <Download /> Problem report
              </Button>
            ) : null}
            {file ? (
              <Button variant="ghost" onClick={() => { reset(); inputRef.current?.click(); }}>
                <RotateCcw /> Another file
              </Button>
            ) : null}
            {committed ? (
              <Button variant="primary" onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <Button
                variant="primary"
                disabled={!result || blocked || actionable === 0 || commit.isPending || preview.isPending}
                loading={commit.isPending}
                onClick={() => file && commit.mutate(file.rows)}
              >
                {actionable > 0 ? `Import ${actionable} row${actionable === 1 ? '' : 's'}` : 'Import'}
              </Button>
            )}
          </>
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Choose a CSV file"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void load(f); }}
        />

        {!file ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void load(f); }}
              className={cn(
                'flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:bg-surface-muted',
              )}
            >
              <Upload className="size-7 text-ink-subtle" />
              <span className="text-[14px] font-semibold text-ink">Drop a CSV file here, or choose one</span>
              <span className="text-[13px] text-ink-muted">Up to {MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows. Nothing is saved until you confirm.</span>
            </button>

            {parseError ? (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/35 bg-danger-soft px-3.5 py-2.5 text-[13px] text-ink">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" /> {parseError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => void downloadAuthed(`/imports/${type}/template`, `${type}-template.csv`).catch((e) => toast.error(String(e.message ?? e)))}>
                <FileSpreadsheet /> Download template
              </Button>
              {spec.mode === 'upsert' ? (
                <Button size="sm" variant="ghost" onClick={() => void downloadAuthed(`/imports/${type}/export`, `${type}.csv`).catch((e) => toast.error(String(e.message ?? e)))}>
                  <Download /> Download current data
                </Button>
              ) : null}
            </div>
            <p className="text-[12.5px] text-ink-subtle">{spec.exportNote} Edit it in Excel or Google Sheets, save as CSV, and import it here.</p>

            <details className="rounded-xl border border-line">
              <summary className="cursor-pointer px-3.5 py-2.5 text-[13px] font-medium text-ink">Columns ({spec.columns.length})</summary>
              <div className="table-scroll max-h-[260px] border-t border-line">
                <table className="w-full text-[12.5px]">
                  <thead className="text-ink-muted"><tr>
                    <th className="px-3 py-2 text-left font-semibold">Column</th>
                    <th className="px-3 py-2 text-left font-semibold">Needed</th>
                    <th className="px-3 py-2 text-left font-semibold">What to put</th>
                  </tr></thead>
                  <tbody>
                    {spec.columns.map((c) => (
                      <tr key={c.key} className="border-t border-line align-top">
                        <td className="px-3 py-1.5"><span className="font-mono text-[12px]">{c.key}</span><div className="text-ink-subtle">{c.label}</div></td>
                        <td className="px-3 py-1.5 text-ink-muted">{c.required === 'always' ? 'Always' : c.required === 'create' ? 'For new records' : 'Optional'}</td>
                        <td className="px-3 py-1.5 text-ink-muted">
                          {c.hint}
                          {c.values ? <div className="mt-0.5 font-mono text-[11.5px] text-ink-subtle">{c.values.join(' · ')}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <FileSpreadsheet className="size-4 text-ink-subtle" />
              <span className="font-medium text-ink">{file.name}</span>
              <span className="text-ink-subtle">· {file.rows.length.toLocaleString('en-IN')} rows</span>
            </div>

            {preview.isPending ? <p className="text-[13px] text-ink-muted">Checking every row…</p> : null}
            {preview.error ? <ErrorPanel error={preview.error} onRetry={() => preview.mutate(file.rows)} /> : null}
            {commit.error ? <ErrorPanel error={commit.error} /> : null}

            {result ? (
              <>
                {committed ? (
                  <p className="flex items-start gap-2 rounded-xl border border-ok/35 bg-ok-soft px-3.5 py-2.5 text-[13px] text-ink">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
                    Imported. {result.rows.filter((r) => r.outcome === 'failed').length > 0
                      ? `${result.rows.filter((r) => r.outcome === 'failed').length} rows failed while saving — see the problem report.`
                      : 'Every row was saved.'}
                  </p>
                ) : blocked ? (
                  <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/35 bg-danger-soft px-3.5 py-2.5 text-[13px] text-ink">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
                    {result.missingColumns.length
                      ? `The file is missing ${result.missingColumns.join(', ')}. Download the template to see the expected columns.`
                      : `${result.counts.error} row${result.counts.error === 1 ? ' has' : 's have'} a problem. Fix them in the file and choose it again — nothing is imported until every row is valid.`}
                  </p>
                ) : null}
                {result.unknownColumns.length ? (
                  <p className="text-[12.5px] text-ink-muted">Ignored columns: {result.unknownColumns.join(', ')}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-1.5">
                  {(Object.keys(ACTION_LABEL) as ImportAction[]).filter((a) => result.counts[a] > 0).map((a) => (
                    <Badge key={a} tone={ACTION_TONE[a]}>{ACTION_LABEL[a]}: {result.counts[a]}</Badge>
                  ))}
                  <label className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted">
                    <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                    Only problems
                  </label>
                </div>

                <div className="table-scroll max-h-[46vh] rounded-xl border border-line">
                  <table className="w-full text-[12.5px]">
                    <thead className="text-ink-muted"><tr>
                      <th className="px-3 py-2 text-right font-semibold">Row</th>
                      <th className="px-3 py-2 text-left font-semibold">Record</th>
                      <th className="px-3 py-2 text-left font-semibold">{committed ? 'Result' : 'Will'}</th>
                      <th className="px-3 py-2 text-left font-semibold">Details</th>
                    </tr></thead>
                    <tbody>
                      {shown.slice(0, 500).map((r) => (
                        <tr key={r.row} className={cn('border-t border-line align-top', (r.action === 'error' || r.outcome === 'failed') && 'row-flag')}>
                          <td className="num px-3 py-1.5 text-right text-ink-subtle">{r.row}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-ink">{r.key || '—'}</td>
                          <td className="px-3 py-1.5">
                            {r.outcome
                              ? <Badge tone={r.outcome === 'failed' ? 'danger' : r.outcome === 'unchanged' ? 'neutral' : 'ok'}>{r.outcome}</Badge>
                              : <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>}
                          </td>
                          <td className="px-3 py-1.5 text-ink-muted">
                            {r.errors.length ? <span className="text-danger">{r.errors.join(' · ')}</span>
                              : r.message ? r.message
                              : r.changes.length ? r.changes.join(', ') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {shown.length > 500 ? <p className="text-[12px] text-ink-subtle">Showing the first 500 rows. The problem report lists every one.</p> : null}
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
