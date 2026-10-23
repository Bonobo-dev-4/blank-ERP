import { describe, expect, it } from 'vitest';
import { IllegalStateError, InvariantViolation, ValidationError } from '../errors';
import {
  assertRouteChainConsistent, assertStageTaskConsistent, availableToForward, computeBatchProgress,
  planForward, planRelease, planReturnFromRework, planSendToRework, planStageOutcome,
  reworkOutstanding, wipAtStage, type BatchState, type StageTaskState,
} from './stage-ledger';

const task = (over: Partial<StageTaskState> = {}): StageTaskState => ({
  id: 't1', sequence: 1, stageCode: 'CUTTING',
  receivedQty: '0', completedQty: '0', rejectedQty: '0',
  reworkSentQty: '0', reworkReturnedQty: '0', forwardedQty: '0',
  ...over,
});

const batch = (over: Partial<BatchState> = {}): BatchState => ({
  id: 'b1', batchNo: 'BATCH-000001', plannedQty: '100', releasedQty: '0',
  finishedQty: '0', rejectedQty: '0', qcPassedQty: '0', inwardedQty: '0',
  ...over,
});

describe('release into the route', () => {
  it('releases up to the batch planned quantity', () => {
    const plan = planRelease(batch(), task(), '100');
    expect(plan.qty.toFixed()).toBe('100');
    expect(plan.deltas[0]!.receivedQtyDelta!.toFixed()).toBe('100');
    expect(plan.batchDelta.releasedQtyDelta!.toFixed()).toBe('100');
  });

  it('refuses to release more than planned, including across two releases', () => {
    expect(() => planRelease(batch(), task(), '101')).toThrow(InvariantViolation);
    expect(() => planRelease(batch({ releasedQty: '60' }), task(), '41')).toThrow(/exceed the batch planned quantity/);
    expect(() => planRelease(batch({ releasedQty: '60' }), task(), '40')).not.toThrow();
  });

  it('only releases into the first step of the route', () => {
    expect(() => planRelease(batch(), task({ sequence: 2 }), '10')).toThrow(IllegalStateError);
  });
});

describe('scenario from the specification: 100 released, 95 completed, 5 rejected', () => {
  const cutting = task({ receivedQty: '100' });

  it('records the outcome exactly', () => {
    const plan = planStageOutcome(cutting, { completedQty: '95', rejectedQty: '5' });
    expect(plan.qty.toFixed()).toBe('100');
    expect(plan.deltas[0]!.completedQtyDelta!.toFixed()).toBe('95');
    expect(plan.deltas[0]!.rejectedQtyDelta!.toFixed()).toBe('5');
  });

  it('leaves 95 - not 100 - available to the next stage', () => {
    const after = task({ receivedQty: '100', completedQty: '95', rejectedQty: '5' });
    expect(availableToForward(after).toFixed()).toBe('95');
    expect(wipAtStage(after).toFixed()).toBe('0');
  });

  it('refuses a second identical submission, which would double the numbers', () => {
    const after = task({ receivedQty: '100', completedQty: '95', rejectedQty: '5' });
    expect(() => planStageOutcome(after, { completedQty: '95', rejectedQty: '5' }))
      .toThrow(/exceeds the work in progress/);
  });

  it('refuses an outcome larger than what the stage received', () => {
    expect(() => planStageOutcome(cutting, { completedQty: '101' })).toThrow(InvariantViolation);
    expect(() => planStageOutcome(cutting, { completedQty: '96', rejectedQty: '5' })).toThrow(InvariantViolation);
  });

  it('requires at least one non-zero outcome', () => {
    expect(() => planStageOutcome(cutting, {})).toThrow(ValidationError);
    expect(() => planStageOutcome(cutting, { completedQty: '0', rejectedQty: '0' })).toThrow(ValidationError);
  });

  it('rejects negative outcome quantities', () => {
    expect(() => planStageOutcome(cutting, { completedQty: '-5' })).toThrow(ValidationError);
  });
});

describe('forwarding between stages', () => {
  const cutting = task({ id: 'cut', sequence: 1, stageCode: 'CUTTING', receivedQty: '100', completedQty: '95', rejectedQty: '5' });
  const stitching = task({ id: 'stitch', sequence: 2, stageCode: 'STITCHING' });

  it('hands accepted quantity to the next stage', () => {
    const plan = planForward(cutting, stitching, '95');
    expect(plan.deltas[0]!.forwardedQtyDelta!.toFixed()).toBe('95');
    expect(plan.deltas[1]!.receivedQtyDelta!.toFixed()).toBe('95');
  });

  it('cannot advance beyond the accepted quantity at the preceding stage', () => {
    expect(() => planForward(cutting, stitching, '96')).toThrow(InvariantViolation);
    expect(() => planForward(cutting, stitching, '96')).toThrow(/exceeds the accepted quantity/);
  });

  it('cannot forward the same quantity twice', () => {
    const forwarded = { ...cutting, forwardedQty: '95' };
    expect(() => planForward(forwarded, stitching, '95')).toThrow(InvariantViolation);
    // A partial second forward is fine if quantity remains.
    const partly = { ...cutting, forwardedQty: '60' };
    expect(planForward(partly, stitching, '35').qty.toFixed()).toBe('35');
    expect(() => planForward(partly, stitching, '36')).toThrow(InvariantViolation);
  });

  it('refuses to skip a stage unless explicitly authorised', () => {
    const finishing = task({ id: 'fin', sequence: 3, stageCode: 'FINISHING' });
    expect(() => planForward(cutting, finishing, '10')).toThrow(/skipping requires authorisation/);
    expect(planForward(cutting, finishing, '10', { allowStageSkip: true }).qty.toFixed()).toBe('10');
  });

  it('refuses to move quantity backwards through the route', () => {
    expect(() => planForward(stitching, cutting, '1')).toThrow(/only move forward/);
  });

  it('models concurrent forward attempts: the second sees the first and fails', () => {
    // Two supervisors both try to forward the full 95 from the same snapshot.
    const first = planForward(cutting, stitching, '95');
    expect(first.qty.toFixed()).toBe('95');
    // The service applies the first under a row lock, then re-reads. The second
    // attempt now works from the updated state and is rejected.
    const afterFirst = { ...cutting, forwardedQty: '95' };
    expect(() => planForward(afterFirst, stitching, '95')).toThrow(InvariantViolation);
  });
});

describe('rework loops', () => {
  it('sends work to rework out of the stage WIP', () => {
    const t = task({ receivedQty: '100', completedQty: '80' });
    const plan = planSendToRework(t, '20');
    expect(plan.deltas[0]!.reworkSentQtyDelta!.toFixed()).toBe('20');
    expect(() => planSendToRework(t, '21')).toThrow(/exceeds the work in progress/);
  });

  it('returns rework to the same stage and keeps the quantity conserved', () => {
    const sent = task({ receivedQty: '100', completedQty: '80', reworkSentQty: '20' });
    expect(reworkOutstanding(sent).toFixed()).toBe('20');
    expect(wipAtStage(sent).toFixed()).toBe('0');

    const back = planReturnFromRework(sent, '20');
    expect(back.deltas[0]!.reworkReturnedQtyDelta!.toFixed()).toBe('20');

    const returned = { ...sent, reworkReturnedQty: '20' };
    expect(reworkOutstanding(returned).toFixed()).toBe('0');
    // The 20 garments are back in WIP and must be completed again.
    expect(wipAtStage(returned).toFixed()).toBe('20');
  });

  it('refuses to return more than is out in rework', () => {
    const sent = task({ receivedQty: '100', completedQty: '80', reworkSentQty: '20' });
    expect(() => planReturnFromRework(sent, '21')).toThrow(InvariantViolation);
  });

  it('counts a garment reworked twice as one garment', () => {
    // 10 sent, 10 returned, 10 sent again: cumulative sent is 20 but
    // outstanding is 10 and the stage still only ever received 100.
    const twice = task({ receivedQty: '100', completedQty: '0', reworkSentQty: '20', reworkReturnedQty: '10' });
    expect(reworkOutstanding(twice).toFixed()).toBe('10');
    expect(wipAtStage(twice).toFixed()).toBe('90');
    expect(() => assertStageTaskConsistent(twice)).not.toThrow();
  });
});

describe('batch progress - quantities are not summed across stages', () => {
  // The specification's example: cutting 100, stitching 85, finishing 60,
  // QC 50. The batch has produced 50, not 295.
  const tasks: StageTaskState[] = [
    task({ id: 'c', sequence: 1, stageCode: 'CUTTING', receivedQty: '100', completedQty: '100', forwardedQty: '85' }),
    task({ id: 's', sequence: 2, stageCode: 'STITCHING', receivedQty: '85', completedQty: '85', forwardedQty: '60' }),
    task({ id: 'f', sequence: 3, stageCode: 'FINISHING', receivedQty: '60', completedQty: '60', forwardedQty: '50' }),
    task({ id: 'q', sequence: 4, stageCode: 'QC', receivedQty: '50', completedQty: '50' }),
  ];
  const b = batch({ releasedQty: '100' });

  it('reports finished quantity from the final route step only', () => {
    const p = computeBatchProgress(b, tasks);
    expect(p.finishedQty.toFixed()).toBe('50');
    expect(p.releasedQty.toFixed()).toBe('100');
  });

  it('reports per-stage WIP and what each stage can still hand on', () => {
    const p = computeBatchProgress(b, tasks);
    const byCode = Object.fromEntries(p.stages.map((s) => [s.stageCode, s]));
    expect(byCode.CUTTING!.availableToForwardQty.toFixed()).toBe('15');
    expect(byCode.STITCHING!.availableToForwardQty.toFixed()).toBe('25');
    expect(byCode.FINISHING!.availableToForwardQty.toFixed()).toBe('10');
    expect(byCode.QC!.availableToForwardQty.toFixed()).toBe('50');
  });

  it('accounts for the 50 garments still in progress', () => {
    const p = computeBatchProgress(b, tasks);
    // 100 released - 50 finished - 0 rejected - 0 in rework = 50 in progress.
    expect(p.totalWipQty.toFixed()).toBe('50');
    expect(p.totalRejectedQty.toFixed()).toBe('0');
  });

  it('validates the whole chain', () => {
    expect(() => assertRouteChainConsistent(tasks, b)).not.toThrow();
  });

  it('catches a stage that received more than the one before it forwarded', () => {
    const broken = [...tasks];
    broken[1] = task({ id: 's', sequence: 2, stageCode: 'STITCHING', receivedQty: '90', completedQty: '85', forwardedQty: '60' });
    expect(() => assertRouteChainConsistent(broken, b)).toThrow(/received more than sequence 1 forwarded/);
  });

  it('catches a first stage that received more than the batch released', () => {
    const broken = [task({ id: 'c', sequence: 1, receivedQty: '120', completedQty: '0' })];
    expect(() => assertRouteChainConsistent(broken, b)).toThrow(/received more quantity than the batch released/);
  });
});

describe('assertStageTaskConsistent', () => {
  it('catches outcomes exceeding receipts', () => {
    expect(() => assertStageTaskConsistent(task({ receivedQty: '100', completedQty: '96', rejectedQty: '5' })))
      .toThrow(/exceed the quantity the stage received/);
  });

  it('catches forwarding more than was completed', () => {
    expect(() => assertStageTaskConsistent(task({ receivedQty: '100', completedQty: '50', forwardedQty: '60' })))
      .toThrow(/forwarded more quantity than it completed/);
  });

  it('catches more returning from rework than was ever sent', () => {
    expect(() => assertStageTaskConsistent(task({ receivedQty: '100', reworkSentQty: '5', reworkReturnedQty: '6' })))
      .toThrow(/returned from rework than was ever sent/);
  });
});
