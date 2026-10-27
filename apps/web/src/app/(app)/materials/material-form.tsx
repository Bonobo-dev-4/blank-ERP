'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MATERIAL_CATEGORIES, UOM_CODES, createRawMaterialRequest } from '@dnd/contracts';
import { api, ApiError } from '@/lib/api';
import { humanise } from '@/lib/utils';
import { Button, ErrorPanel, Field, Input, NativeSelect, QtyInput, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';

interface Option { id: string; name: string; code?: string }

/**
 * Create or edit a raw material.
 *
 * Validated with the SAME Zod schema the API uses, imported from
 * @dnd/contracts. Client-side validation here is purely for speed of feedback:
 * the server validates independently, so the two cannot drift and the client
 * cannot be the only thing standing between bad data and the database.
 */
export function MaterialFormDialog({
  open,
  onOpenChange,
  material,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material?: { id: string } & Record<string, unknown>;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(material?.id);

  const [form, setForm] = React.useState(() => ({
    materialCode: str(material?.materialCode),
    name: str(material?.name),
    category: str(material?.category) || 'FABRIC',
    description: str(material?.description),
    color: str(material?.color),
    fabricComposition: str(material?.fabricComposition),
    width: str(material?.width),
    gsm: str(material?.gsm),
    baseUom: str(material?.baseUom) || 'METER',
    purchaseUom: str(material?.purchaseUom) || '',
    purchaseRate: str(material?.purchaseRate),
    minimumStock: str(material?.minimumStock) || '0',
    reorderLevel: str(material?.reorderLevel) || '0',
    reorderQty: str(material?.reorderQty) || '0',
    leadTimeDays: str(material?.leadTimeDays) || '0',
    defaultSupplierId: str(material?.defaultSupplierId),
    defaultLocationId: str(material?.defaultLocationId),
    lotTracked: material?.lotTracked === undefined ? true : Boolean(material.lotTracked),
    shadeTracked: Boolean(material?.shadeTracked),
  }));
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [error, setError] = React.useState<unknown>(null);

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: () => api.get<{ data: Option[] }>('/suppliers', { pageSize: 200, status: 'ACTIVE' }),
  });
  const { data: locations } = useQuery({
    queryKey: ['locations', 'options'],
    queryFn: () => api.get<{ id: string; code: string; name: string; kind: string }[]>('/locations'),
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        gsm: form.gsm === '' ? null : Number(form.gsm),
        leadTimeDays: Number(form.leadTimeDays || 0),
        width: form.width === '' ? null : form.width,
        purchaseRate: form.purchaseRate === '' ? null : form.purchaseRate,
        purchaseUom: form.purchaseUom === '' ? null : form.purchaseUom,
        defaultSupplierId: form.defaultSupplierId || null,
        defaultLocationId: form.defaultLocationId || null,
        description: form.description || null,
        color: form.color || null,
        fabricComposition: form.fabricComposition || null,
      };

      // Parse with the shared contract first so obvious mistakes never leave
      // the browser.
      const parsed = createRawMaterialRequest.partial().safeParse(payload);
      if (!parsed.success) {
        const errs: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) {
          const k = issue.path.join('.') || '_root';
          (errs[k] ??= []).push(issue.message);
        }
        setFieldErrors(errs);
        throw new Error('Please correct the highlighted fields');
      }
      setFieldErrors({});

      return isEdit
        ? api.patch(`/materials/${material!.id}`, parsed.data)
        : api.post('/materials', parsed.data);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Material updated' : `Material ${form.materialCode} created`);
      void queryClient.invalidateQueries({ queryKey: ['materials'] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors) setFieldErrors(e.fieldErrors);
      setError(e);
    },
  });

  const isFabric = form.category === 'FABRIC' || form.category === 'LINING';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        wide
        title={isEdit ? `Edit ${form.materialCode}` : 'New raw material'}
        description="The base unit is the stocking unit: every ledger entry for this material is recorded in it."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="default">Cancel</Button>
            </DialogClose>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
              {isEdit ? 'Save changes' : 'Create material'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <ErrorPanel error={error} /> : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Material code" required error={fieldErrors.materialCode}>
              <Input
                value={form.materialCode}
                onChange={(e) => set('materialCode', e.target.value.toUpperCase())}
                placeholder="FAB-001"
                className="font-mono uppercase"
                disabled={isEdit}
              />
            </Field>
            <Field label="Name" required className="sm:col-span-2" error={fieldErrors.name}>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder='Cotton Poplin 58"' />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Category" required error={fieldErrors.category}>
              <NativeSelect value={form.category} onChange={(e) => set('category', e.target.value)}>
                {MATERIAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{humanise(c)}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Base unit"
              required
              hint="stocking unit"
              error={fieldErrors.baseUom}
            >
              <NativeSelect value={form.baseUom} onChange={(e) => set('baseUom', e.target.value)} disabled={isEdit}>
                {UOM_CODES.map((u) => (
                  <option key={u} value={u}>{humanise(u)}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Purchase unit" hint="converted on receipt" error={fieldErrors.purchaseUom}>
              <NativeSelect value={form.purchaseUom} onChange={(e) => set('purchaseUom', e.target.value)}>
                <option value="">Same as base</option>
                {UOM_CODES.map((u) => (
                  <option key={u} value={u}>{humanise(u)}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Colour">
              <Input value={form.color} onChange={(e) => set('color', e.target.value)} placeholder="Indigo Blue" />
            </Field>
            {isFabric ? (
              <>
                <Field label="Composition">
                  <Input
                    value={form.fabricComposition}
                    onChange={(e) => set('fabricComposition', e.target.value)}
                    placeholder="100% Cotton"
                  />
                </Field>
                <Field label="Width" hint="inches">
                  <QtyInput value={form.width} onChange={(e) => set('width', e.target.value)} placeholder="58" />
                </Field>
                <Field label="GSM">
                  <QtyInput value={form.gsm} onChange={(e) => set('gsm', e.target.value.replace(/\D/g, ''))} placeholder="120" />
                </Field>
              </>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Minimum stock" error={fieldErrors.minimumStock}>
              <QtyInput value={form.minimumStock} onChange={(e) => set('minimumStock', e.target.value)} />
            </Field>
            <Field label="Reorder level" error={fieldErrors.reorderLevel}>
              <QtyInput value={form.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} />
            </Field>
            <Field label="Reorder quantity" error={fieldErrors.reorderQty}>
              <QtyInput value={form.reorderQty} onChange={(e) => set('reorderQty', e.target.value)} />
            </Field>
            <Field label="Lead time" hint="days" error={fieldErrors.leadTimeDays}>
              <QtyInput
                value={form.leadTimeDays}
                onChange={(e) => set('leadTimeDays', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Default supplier">
              <NativeSelect
                value={form.defaultSupplierId}
                onChange={(e) => set('defaultSupplierId', e.target.value)}
              >
                <option value="">None</option>
                {(suppliers?.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Default location">
              <NativeSelect
                value={form.defaultLocationId}
                onChange={(e) => set('defaultLocationId', e.target.value)}
              >
                <option value="">None</option>
                {(locations ?? [])
                  .filter((l) => l.kind === 'PHYSICAL')
                  .map((l) => (
                    <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Purchase rate" hint="per purchase unit">
              <QtyInput value={form.purchaseRate} onChange={(e) => set('purchaseRate', e.target.value)} placeholder="245.50" />
            </Field>
          </div>

          <div className="flex flex-wrap gap-5 rounded border border-line bg-surface-muted px-3 py-2">
            <label className="flex items-start gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={form.lotTracked}
                onChange={(e) => set('lotTracked', e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-ink">Track by lot</span>
                <span className="block text-[12px] text-ink-muted">
                  Each delivery gets its own lot. Leave off for trims nobody tracks by batch.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={form.shadeTracked}
                onChange={(e) => set('shadeTracked', e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-ink">Track shade</span>
                <span className="block text-[12px] text-ink-muted">
                  Mixing shades in one batch then needs an approved exception.
                </span>
              </span>
            </label>
          </div>

          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
