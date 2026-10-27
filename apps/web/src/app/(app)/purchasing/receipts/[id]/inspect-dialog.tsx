'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtQty, newIdempotencyKey, uomShort } from '@/lib/utils';
import {
  Badge, Button, ErrorPanel, Field, Input, QtyInput, Textarea,
} from '@/components/ui/primitives';
import { CodeCell } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import type { ReceiptDetail } from './page';

interface RollDecision {
  fabricRollId: string;
  rollNo: string;
  rollLength: string;
  rejectedLength: string;
}

interface LineDecision {
  receiptLineId: string;
  materialCode: string;
  materialName: string;
  baseUom: string;
  receivedBaseQty: string;
  acceptedQty: string;
  rejectedQty: string;
  rejectionReason: string;
  rolls: RollDecision[];
}

/**
 * Incoming inspection.
 *
 * Two rules the form enforces live, so a storekeeper is never told "rejected"
 * by the server after filling in twenty fields:
 *
 *  1. Accepted + rejected must equal exactly the received quantity. Material
 *     cannot be left in QC hold with nothing recorded about it.
 *  2. If the line arrived as individual fabric rolls and anything is rejected,
 *     the rejected length must be attributed to specific rolls. "10 m rejected"
 *     is not actionable unless the system knows which roll it came off, and a
 *     guess would make roll lengths disagree with the stock ledger.
 */
export function InspectDialog({
  open,
  onOpenChange,
  receipt,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  receipt: ReceiptDetail;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const idempotencyKey = React.useMemo(() => newIdempotencyKey(), []);
  const [error, setError] = React.useState<unknown>(null);
  const [remarks, setRemarks] = React.useState('');

  const [lines, setLines] = React.useState<LineDecision[]>(() =>
    receipt.lines.map((l) => ({
      receiptLineId: l.id,
      materialCode: l.rawMaterial.materialCode,
      materialName: l.rawMaterial.name,
      baseUom: l.rawMaterial.baseUom,
      receivedBaseQty: l.receivedBaseQty,
      // Default to accepting everything: that is the common case, and it means
      // the inspector only types where something is wrong.
      acceptedQty: l.receivedBaseQty,
      rejectedQty: '0',
      rejectionReason: '',
      rolls: l.lots.flatMap((lot) =>
        lot.fabricRolls.map((r) => ({
          fabricRollId: r.id,
          rollNo: r.rollNo,
          rollLength: r.currentLength,
          rejectedLength: '0',
        })),
      ),
    })),
  );

  const setLine = (idx: number, patch: Partial<LineDecision>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  /** Typing a rejected quantity auto-fills the accepted remainder. */
  const setRejected = (idx: number, rejected: string) => {
    setLines((ls) =>
      ls.map((l, i) => {
        if (i !== idx) return l;
        const received = Number(l.receivedBaseQty);
        const rej = Number(rejected || 0);
        const accepted = Number.isFinite(rej) ? Math.max(received - rej, 0) : received;
        return { ...l, rejectedQty: rejected, acceptedQty: String(accepted) };
      }),
    );
  };

  const setRollRejection = (idx: number, rollId: string, length: string) =>
    setLines((ls) =>
      ls.map((l, i) =>
        i === idx
          ? { ...l, rolls: l.rolls.map((r) => (r.fabricRollId === rollId ? { ...r, rejectedLength: length } : r)) }
          : l,
      ),
    );

  const problems = React.useMemo(() => {
    const out: string[] = [];
    for (const l of lines) {
      const received = Number(l.receivedBaseQty);
      const accepted = Number(l.acceptedQty || 0);
      const rejected = Number(l.rejectedQty || 0);

      if (Math.abs(accepted + rejected - received) > 0.0001) {
        out.push(
          `${l.materialCode}: accepted ${fmtQty(l.acceptedQty)} plus rejected ${fmtQty(l.rejectedQty)} must equal the ${fmtQty(l.receivedBaseQty)} received`,
        );
      }
      if (rejected > 0 && l.rolls.length > 0) {
        const allocated = l.rolls.reduce((a, r) => a + Number(r.rejectedLength || 0), 0);
        if (Math.abs(allocated - rejected) > 0.0001) {
          out.push(
            `${l.materialCode}: allocate the ${fmtQty(l.rejectedQty)} rejected across specific rolls (currently ${fmtQty(String(allocated))})`,
          );
        }
        for (const r of l.rolls) {
          if (Number(r.rejectedLength || 0) > Number(r.rollLength)) {
            out.push(`${l.materialCode}: roll ${r.rollNo} only holds ${fmtQty(r.rollLength)}`);
          }
        }
      }
      if (rejected > 0 && l.rejectionReason.trim().length < 3) {
        out.push(`${l.materialCode}: give a reason for the rejection`);
      }
    }
    return out;
  }, [lines]);

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/purchasing/receipts/${receipt.id}/inspect`, {
        idempotencyKey,
        remarks: remarks || null,
        lines: lines.map((l) => ({
          receiptLineId: l.receiptLineId,
          acceptedQty: l.acceptedQty,
          rejectedQty: l.rejectedQty || '0',
          rejectionReason: l.rejectionReason || null,
          ...(Number(l.rejectedQty || 0) > 0 && l.rolls.length > 0
            ? {
                rollDecisions: l.rolls
                  .filter((r) => Number(r.rejectedLength || 0) > 0)
                  .map((r) => ({ fabricRollId: r.fabricRollId, rejectedLength: r.rejectedLength })),
              }
            : {}),
        })),
      }),
    onSuccess: () => {
      toast.success('Inspection posted. Accepted stock is now available to production.');
      void queryClient.invalidateQueries();
      onSaved?.();
      onOpenChange(false);
    },
    onError: setError,
  });

  const totalAccepted = lines.reduce((a, l) => a + Number(l.acceptedQty || 0), 0);
  const totalRejected = lines.reduce((a, l) => a + Number(l.rejectedQty || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        wide
        title={`Inspect ${receipt.grnNo}`}
        description={`Accepted stock is released to ${receipt.targetLocation.code}; rejected stock is quarantined.`}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="default">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={() => submit.mutate()}
              loading={submit.isPending}
              disabled={problems.length > 0}
            >
              Post inspection
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <ErrorPanel error={error} /> : null}

          <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-surface-muted px-3 py-2">
            <Badge tone="ok">Accepting {fmtQty(String(totalAccepted))}</Badge>
            <Badge tone={totalRejected > 0 ? 'danger' : 'neutral'}>
              Rejecting {fmtQty(String(totalRejected))}
            </Badge>
            <span className="text-[12px] text-ink-muted">
              Accepted stock becomes issuable immediately. Rejected stock moves to the rejected area
              pending a supplier return decision.
            </span>
          </div>

          <div className="space-y-2.5">
            {lines.map((line, idx) => {
              const rejected = Number(line.rejectedQty || 0);
              const allocated = line.rolls.reduce((a, r) => a + Number(r.rejectedLength || 0), 0);
              const needsAllocation = rejected > 0 && line.rolls.length > 0;

              return (
                <div key={line.receiptLineId} className="rounded border border-line px-3 py-2.5">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <CodeCell>{line.materialCode}</CodeCell>
                      <div className="text-[12px] text-ink-muted">{line.materialName}</div>
                      <div className="num mt-0.5 text-[12px] text-ink-subtle">
                        received {fmtQty(line.receivedBaseQty)} {uomShort(line.baseUom)}
                      </div>
                    </div>

                    <Field label="Accepted" className="w-28">
                      <QtyInput
                        value={line.acceptedQty}
                        onChange={(e) => {
                          const accepted = e.target.value;
                          const received = Number(line.receivedBaseQty);
                          const rej = Math.max(received - Number(accepted || 0), 0);
                          setLine(idx, { acceptedQty: accepted, rejectedQty: String(rej) });
                        }}
                      />
                    </Field>
                    <Field label="Rejected" className="w-28">
                      <QtyInput value={line.rejectedQty} onChange={(e) => setRejected(idx, e.target.value)} />
                    </Field>
                    <Field label="Rejection reason" className="min-w-[200px] flex-1">
                      <Input
                        value={line.rejectionReason}
                        onChange={(e) => setLine(idx, { rejectionReason: e.target.value })}
                        disabled={rejected <= 0}
                        placeholder={rejected > 0 ? 'Shade variation at the start of one roll' : 'Not required'}
                      />
                    </Field>
                  </div>

                  {needsAllocation ? (
                    <div className="mt-2 rounded border border-dashed border-warn/50 bg-warn-soft px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-medium text-ink">
                          Which rolls is the rejected length coming off?
                        </span>
                        <Badge
                          tone={Math.abs(allocated - rejected) < 0.0001 ? 'ok' : 'danger'}
                          className="ml-auto"
                        >
                          {fmtQty(String(allocated))} of {fmtQty(line.rejectedQty)} allocated
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2.5">
                        {line.rolls.map((r) => (
                          <div key={r.fabricRollId} className="flex items-end gap-1.5">
                            <Field
                              label={r.rollNo.split('-').slice(-2).join('-')}
                              hint={`${fmtQty(r.rollLength, 0)} ${uomShort(line.baseUom)}`}
                              className="w-28"
                            >
                              <QtyInput
                                value={r.rejectedLength}
                                onChange={(e) => setRollRejection(idx, r.fabricRollId, e.target.value)}
                              />
                            </Field>
                          </div>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[12px] text-ink-muted">
                        A roll rejected in full moves to the rejected area. A roll rejected in part is
                        split: the bad length becomes its own barcoded roll.
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {problems.length > 0 ? (
            <ul className="space-y-1 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-ink">
              {problems.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          ) : null}

          <Field label="Inspection remarks">
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
