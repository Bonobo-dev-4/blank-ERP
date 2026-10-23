'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BadgeCheck, Calculator, GitBranch, Plus, Save, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMoney, fmtQty, humanise, uomShort } from '@/lib/utils';
import {
  Badge, Button, Card, CardBody, CardHeader, DescList, ErrorPanel, Field, LoadingBlock,
  NativeSelect, PageHeader, QtyInput, Stat, StatusBadge, Textarea,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useAuth } from '@/components/app/auth-context';
import { BomLineEditor, isLineComplete, toApiLines, type BomLineDraft } from '../bom-line-editor';

interface VersionItem {
  id: string; lineNo: number; rawMaterialId: string; consumptionQty: string; uom: string;
  wastageBasis: string; wastageValue: string; grossQtyPerUnit: string; effectiveUnitCost: string;
  lineCostPerUnit: string; isCritical: boolean; notes: string | null; unitCost: string | null;
  hasSizeOverrides: boolean;
  rawMaterial: { id: string; materialCode: string; name: string; baseUom: string };
  productionStage: { id: string; code: string; name: string } | null;
  sizeOverrides: { id: string; size: string; consumptionQty: string }[];
}

interface Version {
  id: string; bomId: string; version: number; status: string; baseQuantity: string;
  plannedUnitCost: string; materialCostPerUnit: string; approvedAt: string | null;
  changeNote: string | null; createdAt: string; supersededById: string | null;
  itemCount: number; criticalItemCount: number; isEditable: boolean; isProducible: boolean;
  items: VersionItem[];
}

interface BomDetail {
  id: string; bomCode: string; name: string | null; notes: string | null;
  product: { id: string; styleCode: string; name: string; category: string };
  productVariant: { id: string; sku: string } | null;
  versions: Version[];
  approvedVersionId: string | null;
}

interface Explosion {
  plannedQty: string; totalMaterialCost: string; costPerUnit: string;
  requirements: {
    rawMaterialId: string; materialCode: string; materialName: string; uom: string;
    netRequiredQty: string; wastageQty: string; grossRequiredQty: string;
    unitCost: string; estimatedCost: string;
  }[];
}

interface Diff {
  from: { version: number }; to: { version: number }; changedCount: number;
  lines: {
    rawMaterialId: string; materialCode?: string; materialName?: string; change: string;
    fromConsumptionQty: string | null; toConsumptionQty: string | null;
    fromGrossPerUnit: string | null; toGrossPerUnit: string | null;
  }[];
}

export default function BomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draftLines, setDraftLines] = React.useState<BomLineDraft[]>([]);
  const [changeNote, setChangeNote] = React.useState('');
  const [approving, setApproving] = React.useState(false);
  const [explodeQty, setExplodeQty] = React.useState('100');
  const [diffAgainst, setDiffAgainst] = React.useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['bom', id],
    queryFn: () => api.get<BomDetail>(`/bom/${id}`),
  });

  // Default to the approved version — the one that actually drives production.
  const version = React.useMemo(() => {
    if (!data) return null;
    if (selectedId) return data.versions.find((v) => v.id === selectedId) ?? data.versions[0] ?? null;
    return data.versions.find((v) => v.id === data.approvedVersionId) ?? data.versions[0] ?? null;
  }, [data, selectedId]);

  const explosion = useQuery({
    queryKey: ['bom-explode', version?.id, explodeQty],
    queryFn: () =>
      api.post<Explosion>(`/bom/versions/${version!.id}/explode`, {
        demand: [{ quantity: explodeQty }],
        // A draft cannot drive production, but a planner still needs to see
        // what it would require before approving it.
        allowUnapproved: true,
      }),
    enabled: Boolean(version) && Number(explodeQty) > 0,
  });

  const diff = useQuery({
    queryKey: ['bom-diff', version?.id, diffAgainst],
    queryFn: () => api.get<Diff>(`/bom/versions/${version!.id}/diff`, { against: diffAgainst }),
    enabled: Boolean(version && diffAgainst),
  });

  const invalidate = () => queryClient.invalidateQueries();

  const newVersion = useMutation({
    mutationFn: () => api.post<Version>(`/bom/${id}/versions`, { changeNote: changeNote || null }),
    onSuccess: (v) => {
      toast.success(`Draft version ${v.version} created`);
      setChangeNote('');
      setSelectedId(v.id);
      void invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch<Version>(`/bom/versions/${version!.id}`, {
        items: toApiLines(draftLines),
        changeNote: changeNote || null,
      }),
    onSuccess: () => {
      toast.success('Draft saved');
      setEditing(false);
      void invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const submit = useMutation({
    mutationFn: () => api.post(`/bom/versions/${version!.id}/submit`),
    onSuccess: () => {
      toast.success('Sent for approval');
      void invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') =>
      api.post(`/bom/versions/${version!.id}/decision`, { decision, setActive: true }),
    onSuccess: (_r, decision) => {
      toast.success(decision === 'APPROVE' ? 'Version approved' : 'Sent back to draft');
      setApproving(false);
      void invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const startEditing = () => {
    if (!version) return;
    setDraftLines(
      version.items.map((i) => ({
        key: i.id,
        rawMaterialId: i.rawMaterialId,
        consumptionQty: i.consumptionQty,
        uom: i.uom,
        wastageBasis: i.wastageBasis,
        wastageValue: i.wastageValue,
        unitCost: i.unitCost ?? '',
        isCritical: i.isCritical,
        notes: i.notes ?? '',
        sizeOverrides: i.sizeOverrides.map((s) => ({ size: s.size, consumptionQty: s.consumptionQty })),
      })),
    );
    setEditing(true);
  };

  if (isLoading) return <LoadingBlock label="Loading BOM" />;
  if (error) return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  if (!data || !version) return <ErrorPanel error={new Error('BOM not found')} />;

  const hasOpenDraft = data.versions.some((v) => v.status === 'DRAFT' || v.status === 'PENDING_APPROVAL');

  return (
    <div>
      <Button onClick={() => router.push('/bom')} className="mb-3">
        <ArrowLeft />
        All BOMs
      </Button>

      <PageHeader
        title={data.bomCode}
        description={`${data.product.styleCode} — ${data.product.name}${
          data.productVariant ? ` · ${data.productVariant.sku} only` : ' · every SKU'
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              value={version.id}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setEditing(false);
                setDiffAgainst('');
              }}
              className="w-auto"
              aria-label="Version"
            >
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} — {humanise(v.status)}
                </option>
              ))}
            </NativeSelect>

            {can('bom.write') && !hasOpenDraft ? (
              <Button onClick={() => newVersion.mutate()} loading={newVersion.isPending}>
                <Plus />
                New version
              </Button>
            ) : null}

            {can('bom.write') && version.isEditable && !editing ? (
              <Button onClick={startEditing}>Edit lines</Button>
            ) : null}

            {can('bom.write') && version.status === 'DRAFT' && !editing ? (
              <Button onClick={() => submit.mutate()} loading={submit.isPending}>
                <Send />
                Send for approval
              </Button>
            ) : null}

            {can('bom.approve') && version.status === 'PENDING_APPROVAL' ? (
              <Button variant="primary" onClick={() => setApproving(true)}>
                <BadgeCheck />
                Approve
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Version" value={`v${version.version}`} hint={humanise(version.status)} />
        <Stat label="Lines" value={String(version.itemCount)} hint={`${version.criticalItemCount} critical`} />
        <Stat label="Material cost / garment" value={fmtMoney(version.materialCostPerUnit)} />
        <Stat
          label="Drives production"
          value={version.isProducible ? 'Yes' : 'No'}
          hint={version.isProducible ? 'Approved' : 'Only an approved version can'}
        />
      </div>

      {version.status === 'SUPERSEDED' ? (
        <div className="mb-3 rounded border border-line bg-surface-muted px-3 py-2 text-[12.5px] text-ink-muted">
          This version was superseded. It is kept because orders released against it are still costed to
          these figures — their frozen snapshot, not this record, is what they actually read.
        </div>
      ) : null}

      {/* ---- lines ---- */}
      <Card className="mb-3">
        <CardHeader
          title={editing ? 'Editing draft lines' : 'Material lines'}
          description={
            editing
              ? 'Lines are replaced wholesale when saved.'
              : version.isEditable
                ? 'This draft can still be changed.'
                : 'An approved version is immutable — make a new version to change it.'
          }
          actions={
            editing ? (
              <div className="flex gap-2">
                <Button onClick={() => setEditing(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  loading={save.isPending}
                  disabled={draftLines.length === 0 || !draftLines.every(isLineComplete)}
                  onClick={() => save.mutate()}
                >
                  <Save />
                  Save draft
                </Button>
              </div>
            ) : null
          }
        />
        <CardBody>
          {editing ? (
            <div className="space-y-3">
              <BomLineEditor lines={draftLines} onChange={setDraftLines} />
              <Field label="Change note">
                <Textarea
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  rows={2}
                  placeholder="What changed, and why"
                />
              </Field>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12.5px]">
                <thead className="border-b border-line text-[11px] uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">#</th>
                    <th className="px-2 py-1.5 text-left font-medium">Material</th>
                    <th className="px-2 py-1.5 text-right font-medium">Consumption</th>
                    <th className="px-2 py-1.5 text-left font-medium">Wastage</th>
                    <th className="px-2 py-1.5 text-right font-medium">Gross / unit</th>
                    <th className="px-2 py-1.5 text-right font-medium">Rate</th>
                    <th className="px-2 py-1.5 text-right font-medium">Cost / unit</th>
                    <th className="px-2 py-1.5 text-left font-medium">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {version.items.map((i) => (
                    <tr key={i.id} className="border-b border-line last:border-0">
                      <td className="px-2 py-1.5 text-ink-subtle">{i.lineNo}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <CodeCell>{i.rawMaterial.materialCode}</CodeCell>
                          {!i.isCritical ? (
                            <span title="A shortage of this line does not block a release">
                              <Badge tone="neutral">non-critical</Badge>
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11.5px] text-ink-muted">{i.rawMaterial.name}</div>
                        {i.sizeOverrides.length > 0 ? (
                          <div className="mt-0.5 text-[11px] text-ink-muted">
                            {i.sizeOverrides.map((s) => `${s.size} ${fmtQty(s.consumptionQty, 4)}`).join('  ·  ')}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right num">
                        {fmtQty(i.consumptionQty, 4)} {uomShort(i.uom)}
                      </td>
                      <td className="px-2 py-1.5 text-ink-muted">
                        {i.wastageBasis === 'NONE'
                          ? '—'
                          : i.wastageBasis === 'PERCENT_OF_CONSUMPTION'
                            ? `${fmtQty(i.wastageValue)}%`
                            : `${fmtQty(i.wastageValue, 4)} ${humanise(i.wastageBasis).toLowerCase()}`}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium num">{fmtQty(i.grossQtyPerUnit, 4)}</td>
                      <td className="px-2 py-1.5 text-right num">{fmtMoney(i.effectiveUnitCost)}</td>
                      <td className="px-2 py-1.5 text-right num">{fmtMoney(i.lineCostPerUnit)}</td>
                      <td className="px-2 py-1.5 text-ink-muted">{i.productionStage?.name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ---- explosion preview ---- */}
        <Card>
          <CardHeader
            title="What it takes to make"
            description="A preview. A released order is costed against its own frozen snapshot, not this."
            actions={
              <div className="flex items-center gap-1.5">
                <Calculator className="size-3.5 text-ink-subtle" />
                <QtyInput
                  value={explodeQty}
                  onChange={(e) => setExplodeQty(e.target.value)}
                  className="w-24"
                  aria-label="Garment quantity"
                />
              </div>
            }
          />
          <CardBody>
            {explosion.error ? (
              <ErrorPanel error={explosion.error} />
            ) : explosion.data ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="border-b border-line text-[11px] uppercase tracking-wide text-ink-subtle">
                    <tr>
                      <th className="px-1 py-1.5 text-left font-medium">Material</th>
                      <th className="px-1 py-1.5 text-right font-medium">Net</th>
                      <th className="px-1 py-1.5 text-right font-medium">Wastage</th>
                      <th className="px-1 py-1.5 text-right font-medium">Gross</th>
                      <th className="px-1 py-1.5 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {explosion.data.requirements.map((r) => (
                      <tr key={r.rawMaterialId} className="border-b border-line last:border-0">
                        <td className="px-1 py-1.5">
                          <CodeCell>{r.materialCode}</CodeCell>
                        </td>
                        <td className="px-1 py-1.5 text-right num text-ink-muted">{fmtQty(r.netRequiredQty, 4)}</td>
                        <td className="px-1 py-1.5 text-right num text-ink-muted">{fmtQty(r.wastageQty, 4)}</td>
                        <td className="px-1 py-1.5 text-right num font-medium">
                          {fmtQty(r.grossRequiredQty, 4)} {uomShort(r.uom)}
                        </td>
                        <td className="px-1 py-1.5 text-right num">{fmtMoney(r.estimatedCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-line">
                    <tr>
                      <td colSpan={4} className="px-1 py-2 text-right text-ink-muted">
                        Total for {fmtQty(explosion.data.plannedQty, 0)} garments
                      </td>
                      <td className="px-1 py-2 text-right font-semibold num">
                        {fmtMoney(explosion.data.totalMaterialCost)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <LoadingBlock label="Calculating" />
            )}
          </CardBody>
        </Card>

        {/* ---- diff ---- */}
        <Card>
          <CardHeader
            title="Compare versions"
            description="What an approver actually needs to know before approving a revision."
            actions={
              <div className="flex items-center gap-1.5">
                <GitBranch className="size-3.5 text-ink-subtle" />
                <NativeSelect
                  value={diffAgainst}
                  onChange={(e) => setDiffAgainst(e.target.value)}
                  className="w-auto"
                  aria-label="Compare against"
                >
                  <option value="">Compare against…</option>
                  {data.versions
                    .filter((v) => v.id !== version.id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>v{v.version}</option>
                    ))}
                </NativeSelect>
              </div>
            }
          />
          <CardBody>
            {!diffAgainst ? (
              <p className="py-6 text-center text-[12.5px] text-ink-muted">
                Pick a version to compare with v{version.version}.
              </p>
            ) : diff.error ? (
              <ErrorPanel error={diff.error} />
            ) : diff.data ? (
              <div className="space-y-1.5">
                <p className="text-[12px] text-ink-muted">
                  {diff.data.changedCount === 0
                    ? 'No material line differs.'
                    : `${diff.data.changedCount} line(s) differ between v${diff.data.from.version} and v${diff.data.to.version}.`}
                </p>
                {diff.data.lines
                  .filter((l) => l.change !== 'UNCHANGED')
                  .map((l) => (
                    <div
                      key={l.rawMaterialId}
                      className="flex items-center justify-between gap-2 rounded border border-line px-2 py-1.5 text-[12.5px]"
                    >
                      <div className="min-w-0">
                        <CodeCell>{l.materialCode ?? l.rawMaterialId.slice(0, 8)}</CodeCell>
                        <div className="truncate text-[11.5px] text-ink-muted">{l.materialName}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="num text-ink-muted">
                          {l.fromGrossPerUnit ?? '—'} → {l.toGrossPerUnit ?? '—'}
                        </span>
                        <Badge
                          tone={l.change === 'ADDED' ? 'ok' : l.change === 'REMOVED' ? 'danger' : 'warn'}
                        >
                          {humanise(l.change)}
                        </Badge>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <LoadingBlock label="Comparing" />
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader title="Version record" />
        <CardBody>
          <DescList
            items={[
              { label: 'Status', value: <StatusBadge status={version.status} /> },
              { label: 'Created', value: fmtDateTime(version.createdAt) },
              { label: 'Approved', value: version.approvedAt ? fmtDateTime(version.approvedAt) : '—' },
              { label: 'Change note', value: version.changeNote ?? '—' },
              { label: 'Base quantity', value: `${fmtQty(version.baseQuantity, 0)} garment(s)` },
              { label: 'BOM notes', value: data.notes ?? '—' },
            ]}
          />
        </CardBody>
      </Card>

      <ConfirmDialog
        open={approving}
        onOpenChange={setApproving}
        title={`Approve version ${version.version}?`}
        consequence={
          data.approvedVersionId && data.approvedVersionId !== version.id
            ? `Version ${data.versions.find((v) => v.id === data.approvedVersionId)?.version} is superseded and stops driving new orders. Orders already released keep the recipe they were released against — their snapshot is frozen and this does not touch it.`
            : 'This becomes the recipe every new manufacturing order for this style is planned and released against.'
        }
        confirmLabel="Approve"
        tone="elevated"
        loading={decide.isPending}
        onConfirm={() => decide.mutate('APPROVE')}
      >
        <Button onClick={() => decide.mutate('REJECT')} disabled={decide.isPending} className="w-full">
          Send back to draft instead
        </Button>
      </ConfirmDialog>
    </div>
  );
}
