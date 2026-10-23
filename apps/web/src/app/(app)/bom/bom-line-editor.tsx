'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { WASTAGE_BASES } from '@dnd/contracts';
import { api, type Paginated } from '@/lib/api';
import { fmtMoney, humanise, uomShort } from '@/lib/utils';
import { Button, Input, NativeSelect, QtyInput } from '@/components/ui/primitives';

export interface BomLineDraft {
  key: string;
  rawMaterialId: string;
  consumptionQty: string;
  uom: string;
  wastageBasis: string;
  wastageValue: string;
  unitCost: string;
  isCritical: boolean;
  notes: string;
  sizeOverrides: { size: string; consumptionQty: string }[];
}

interface MaterialOption {
  id: string; materialCode: string; name: string; baseUom: string;
  category: string; purchaseRate: string | null; averageCost: string;
}

export const emptyLine = (): BomLineDraft => ({
  key: Math.random().toString(36).slice(2),
  rawMaterialId: '',
  consumptionQty: '',
  uom: '',
  wastageBasis: 'PERCENT_OF_CONSUMPTION',
  wastageValue: '0',
  unitCost: '',
  isCritical: true,
  notes: '',
  sizeOverrides: [],
});

/**
 * Per-garment gross quantity for one line.
 *
 * Mirrors `wastageFor` in @dnd/domain so the planner sees the consequence of a
 * wastage basis as they type it. The server recomputes it with the real domain
 * function — this is feedback, never the authority.
 */
export function grossPerUnit(line: BomLineDraft): number {
  const net = Number(line.consumptionQty);
  const value = Number(line.wastageValue);
  if (!Number.isFinite(net) || net <= 0) return 0;
  if (!Number.isFinite(value) || value < 0) return net;
  switch (line.wastageBasis) {
    case 'PERCENT_OF_CONSUMPTION': return net + (net * value) / 100;
    case 'FIXED_PER_UNIT': return net + value;
    // Charged once for the whole order, so it adds nothing per garment.
    case 'FIXED_PER_ORDER': return net;
    default: return net;
  }
}

export function toApiLines(lines: readonly BomLineDraft[]) {
  return lines.map((l, index) => ({
    lineNo: index + 1,
    rawMaterialId: l.rawMaterialId,
    consumptionQty: l.consumptionQty,
    uom: l.uom,
    wastageBasis: l.wastageBasis,
    wastageValue: l.wastageValue || '0',
    unitCost: l.unitCost ? l.unitCost : null,
    isCritical: l.isCritical,
    notes: l.notes || null,
    alternatives: [],
    sizeOverrides: l.sizeOverrides.filter((s) => s.size && s.consumptionQty),
  }));
}

export function isLineComplete(l: BomLineDraft): boolean {
  return Boolean(l.rawMaterialId) && Number(l.consumptionQty) > 0 && Boolean(l.uom);
}

export function BomLineEditor({
  lines,
  onChange,
  disabled,
}: {
  lines: BomLineDraft[];
  onChange: (lines: BomLineDraft[]) => void;
  disabled?: boolean;
}) {
  const { data: materials } = useQuery({
    queryKey: ['materials', 'bom-picker'],
    queryFn: () => api.get<Paginated<MaterialOption>>('/materials', { pageSize: 200, status: 'ACTIVE' }),
  });
  const byId = React.useMemo(
    () => new Map((materials?.data ?? []).map((m) => [m.id, m])),
    [materials],
  );

  const patch = (key: string, next: Partial<BomLineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...next } : l)));

  const pickMaterial = (key: string, rawMaterialId: string) => {
    const m = byId.get(rawMaterialId);
    patch(key, {
      rawMaterialId,
      // Default to the material's own stock unit and best-known rate, so the
      // common case needs no further typing.
      uom: m?.baseUom ?? '',
      unitCost: m ? (m.purchaseRate ?? m.averageCost ?? '') : '',
    });
  };

  const totalPerUnit = lines.reduce((acc, l) => {
    const cost = Number(l.unitCost);
    return acc + (Number.isFinite(cost) ? grossPerUnit(l) * cost : 0);
  }, 0);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[1000px] text-[12.5px]">
          <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="w-8 px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">Material</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Consumption</th>
              <th className="w-20 px-2 py-2 text-left font-medium">Unit</th>
              <th className="w-44 px-2 py-2 text-left font-medium">Wastage basis</th>
              <th className="w-24 px-2 py-2 text-right font-medium">Value</th>
              <th className="w-24 px-2 py-2 text-right font-medium">Gross / unit</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Rate</th>
              <th className="w-20 px-2 py-2 text-center font-medium" title="Critical lines block a release when short">
                Critical
              </th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const material = byId.get(line.rawMaterialId);
              const gross = grossPerUnit(line);
              return (
                <tr key={line.key} className="border-t border-line align-top">
                  <td className="px-2 py-1.5 text-ink-subtle">{index + 1}</td>
                  <td className="px-2 py-1.5">
                    <NativeSelect
                      value={line.rawMaterialId}
                      onChange={(e) => pickMaterial(line.key, e.target.value)}
                      disabled={disabled}
                      aria-label={`Material for line ${index + 1}`}
                    >
                      <option value="">Select a material</option>
                      {(materials?.data ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.materialCode} — {m.name}
                        </option>
                      ))}
                    </NativeSelect>
                    {line.sizeOverrides.length > 0 ? (
                      <div className="mt-1 text-[11px] text-ink-muted">
                        {line.sizeOverrides.map((s) => `${s.size}: ${s.consumptionQty}`).join('  ·  ')}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <QtyInput
                      value={line.consumptionQty}
                      onChange={(e) => patch(line.key, { consumptionQty: e.target.value })}
                      placeholder="2.5"
                      disabled={disabled}
                      aria-label={`Consumption for line ${index + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <NativeSelect
                      value={line.uom}
                      onChange={(e) => patch(line.key, { uom: e.target.value })}
                      disabled={disabled}
                      aria-label={`Unit for line ${index + 1}`}
                    >
                      <option value="">—</option>
                      {material ? <option value={material.baseUom}>{uomShort(material.baseUom)}</option> : null}
                    </NativeSelect>
                  </td>
                  <td className="px-2 py-1.5">
                    <NativeSelect
                      value={line.wastageBasis}
                      onChange={(e) => patch(line.key, { wastageBasis: e.target.value })}
                      disabled={disabled}
                      aria-label={`Wastage basis for line ${index + 1}`}
                    >
                      {WASTAGE_BASES.map((b) => (
                        <option key={b} value={b}>{humanise(b)}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-2 py-1.5">
                    <QtyInput
                      value={line.wastageValue}
                      onChange={(e) => patch(line.key, { wastageValue: e.target.value })}
                      disabled={disabled || line.wastageBasis === 'NONE'}
                      aria-label={`Wastage value for line ${index + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium num">
                    {gross > 0 ? gross.toFixed(4) : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <QtyInput
                      value={line.unitCost}
                      onChange={(e) => patch(line.key, { unitCost: e.target.value })}
                      placeholder="0.00"
                      disabled={disabled}
                      aria-label={`Rate for line ${index + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={line.isCritical}
                      onChange={(e) => patch(line.key, { isCritical: e.target.checked })}
                      disabled={disabled}
                      aria-label={`Line ${index + 1} is critical`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                      disabled={disabled || lines.length === 1}
                      className="text-ink-subtle transition-colors hover:text-danger disabled:opacity-30"
                      aria-label={`Remove line ${index + 1}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-line bg-surface-muted">
            <tr>
              <td colSpan={7} className="px-2 py-2 text-right text-[12px] text-ink-muted">
                Material cost per garment
              </td>
              <td className="px-2 py-2 text-right font-semibold num">{fmtMoney(String(totalPerUnit))}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={() => onChange([...lines, emptyLine()])} disabled={disabled}>
          <Plus />
          Add line
        </Button>
        <SizeOverrideEditor lines={lines} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}

/**
 * Size-wise consumption overrides.
 *
 * Kept out of the main grid deliberately: most lines have none, and a column
 * per size would make a ten-size range unreadable. 50 M at 2.5 m and 50 XXL at
 * 2.85 m needs 267.5 m, not 250 m, so getting this wrong is a real shortage.
 */
function SizeOverrideEditor({
  lines,
  onChange,
  disabled,
}: {
  lines: BomLineDraft[];
  onChange: (lines: BomLineDraft[]) => void;
  disabled?: boolean;
}) {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const line = lines.find((l) => l.key === openKey) ?? null;

  const setOverrides = (overrides: BomLineDraft['sizeOverrides']) => {
    if (!line) return;
    onChange(lines.map((l) => (l.key === line.key ? { ...l, sizeOverrides: overrides } : l)));
  };

  return (
    <>
      <NativeSelect
        value={openKey ?? ''}
        onChange={(e) => setOpenKey(e.target.value || null)}
        disabled={disabled}
        className="w-auto"
        aria-label="Edit size overrides for a line"
      >
        <option value="">Size overrides…</option>
        {lines.map((l, i) => (
          <option key={l.key} value={l.key} disabled={!l.rawMaterialId}>
            Line {i + 1}
            {l.sizeOverrides.length > 0 ? ` (${l.sizeOverrides.length})` : ''}
          </option>
        ))}
      </NativeSelect>

      {line ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded border border-line bg-surface-muted px-2 py-1.5">
          {line.sizeOverrides.map((o, i) => (
            <span key={i} className="flex items-center gap-1">
              <Input
                value={o.size}
                onChange={(e) =>
                  setOverrides(line.sizeOverrides.map((x, j) => (j === i ? { ...x, size: e.target.value.toUpperCase() } : x)))
                }
                placeholder="XXL"
                className="w-16 uppercase"
                aria-label="Size"
              />
              <QtyInput
                value={o.consumptionQty}
                onChange={(e) =>
                  setOverrides(line.sizeOverrides.map((x, j) => (j === i ? { ...x, consumptionQty: e.target.value } : x)))
                }
                placeholder="2.85"
                className="w-20"
                aria-label="Consumption for this size"
              />
              <button
                type="button"
                onClick={() => setOverrides(line.sizeOverrides.filter((_, j) => j !== i))}
                className="text-ink-subtle hover:text-danger"
                aria-label="Remove size override"
              >
                <Trash2 className="size-3.5" />
              </button>
            </span>
          ))}
          <Button
            type="button"
            onClick={() => setOverrides([...line.sizeOverrides, { size: '', consumptionQty: '' }])}
          >
            <Plus />
            Size
          </Button>
          <Button type="button" onClick={() => setOpenKey(null)}>Done</Button>
        </div>
      ) : null}
    </>
  );
}
