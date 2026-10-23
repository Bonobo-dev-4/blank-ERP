import { Decimal, clampNonNegative, qty, type DecimalLike } from '../decimal';
import { ERR, IllegalStateError, InvariantViolation, ValidationError } from '../errors';

export const STAGE_MOVEMENT_TYPES = [
  'RELEASE_TO_FIRST_STAGE',
  'FORWARD',
  'COMPLETE',
  'REJECT',
  'SEND_TO_REWORK',
  'RETURN_FROM_REWORK',
  'CANCEL_RELEASE',
] as const;

export type StageMovementType = (typeof STAGE_MOVEMENT_TYPES)[number];

/**
 * The per-(batch, route step) counters. All are CUMULATIVE totals, never
 * running balances, so an event can always be replayed to the same state.
 *
 *   receivedQty       accepted into this stage (released, or forwarded in)
 *   completedQty      finished here and eligible to go downstream
 *   rejectedQty       scrapped here
 *   reworkSentQty     cumulative quantity ever sent out to rework from here
 *   reworkReturnedQty cumulative quantity ever returned from rework to here
 *   forwardedQty      cumulative quantity handed to the next stage
 */
export interface StageTaskState {
  readonly id: string;
  readonly sequence: number;
  readonly productionStageId?: string;
  readonly stageCode?: string;
  readonly receivedQty: DecimalLike;
  readonly completedQty: DecimalLike;
  readonly rejectedQty: DecimalLike;
  readonly reworkSentQty: DecimalLike;
  readonly reworkReturnedQty: DecimalLike;
  readonly forwardedQty: DecimalLike;
}

/** Quantity currently away being reworked: sent minus returned. */
export function reworkOutstanding(t: StageTaskState): Decimal {
  return clampNonNegative(qty(t.reworkSentQty).minus(qty(t.reworkReturnedQty)));
}

/**
 * Work in progress at this stage: received, but not yet completed, rejected, or
 * currently away in rework. This - not a sum of completed quantities across
 * stages - is the number the WIP dashboard shows.
 */
export function wipAtStage(t: StageTaskState): Decimal {
  return clampNonNegative(
    qty(t.receivedQty)
      .minus(qty(t.completedQty))
      .minus(qty(t.rejectedQty))
      .minus(reworkOutstanding(t)),
  );
}

/** Completed here but not yet handed downstream: what the next stage may pull. */
export function availableToForward(t: StageTaskState): Decimal {
  return clampNonNegative(qty(t.completedQty).minus(qty(t.forwardedQty)));
}

/**
 * Validate a stage task's counters against each other. Called after every
 * mutation as a cheap belt-and-braces check alongside the DB constraints.
 */
export function assertStageTaskConsistent(t: StageTaskState): void {
  const received = qty(t.receivedQty);
  const disposed = qty(t.completedQty).plus(qty(t.rejectedQty)).plus(reworkOutstanding(t));
  if (disposed.greaterThan(received)) {
    throw new InvariantViolation(
      ERR.STAGE_OUTCOME_EXCEEDS_RECEIVED,
      'Stage outcomes exceed the quantity the stage received',
      {
        stageTaskId: t.id,
        receivedQty: received.toFixed(),
        completedQty: qty(t.completedQty).toFixed(),
        rejectedQty: qty(t.rejectedQty).toFixed(),
        reworkOutstandingQty: reworkOutstanding(t).toFixed(),
      },
    );
  }
  if (qty(t.forwardedQty).greaterThan(qty(t.completedQty))) {
    throw new InvariantViolation(
      ERR.STAGE_FORWARD_EXCEEDS_COMPLETED,
      'Stage has forwarded more quantity than it completed',
      {
        stageTaskId: t.id,
        forwardedQty: qty(t.forwardedQty).toFixed(),
        completedQty: qty(t.completedQty).toFixed(),
      },
    );
  }
  if (qty(t.reworkReturnedQty).greaterThan(qty(t.reworkSentQty))) {
    throw new InvariantViolation(
      ERR.REWORK_RETURN_EXCEEDS_SENT,
      'More quantity has returned from rework than was ever sent',
      {
        stageTaskId: t.id,
        reworkSentQty: qty(t.reworkSentQty).toFixed(),
        reworkReturnedQty: qty(t.reworkReturnedQty).toFixed(),
      },
    );
  }
}

/** A single field delta to apply to one stage task. */
export interface StageTaskDelta {
  readonly stageTaskId: string;
  readonly receivedQtyDelta?: Decimal;
  readonly completedQtyDelta?: Decimal;
  readonly rejectedQtyDelta?: Decimal;
  readonly reworkSentQtyDelta?: Decimal;
  readonly reworkReturnedQtyDelta?: Decimal;
  readonly forwardedQtyDelta?: Decimal;
}

export interface StageTransitionPlan {
  readonly movementType: StageMovementType;
  readonly qty: Decimal;
  readonly deltas: readonly StageTaskDelta[];
  /** Batch-level counters this transition also moves. */
  readonly batchDelta: {
    readonly releasedQtyDelta?: Decimal;
    readonly finishedQtyDelta?: Decimal;
    readonly rejectedQtyDelta?: Decimal;
  };
}

export interface BatchState {
  readonly id: string;
  readonly batchNo?: string;
  readonly plannedQty: DecimalLike;
  readonly releasedQty: DecimalLike;
  readonly finishedQty: DecimalLike;
  readonly rejectedQty: DecimalLike;
  readonly qcPassedQty: DecimalLike;
  readonly inwardedQty: DecimalLike;
}

function requirePositive(value: DecimalLike, field: string, context: Record<string, unknown>): Decimal {
  const q = qty(value);
  if (!q.isFinite() || q.lessThanOrEqualTo(0)) {
    throw new ValidationError(ERR.NON_POSITIVE_QTY, `${field} must be greater than zero`, {
      ...context, [field]: q.toFixed(),
    });
  }
  return q;
}

/**
 * Release quantity into the first stage of the route.
 * Bounded by the batch's planned quantity.
 */
export function planRelease(
  batch: BatchState,
  firstTask: StageTaskState,
  releaseQty: DecimalLike,
): StageTransitionPlan {
  const q = requirePositive(releaseQty, 'releaseQty', { batchId: batch.id });
  const alreadyReleased = qty(batch.releasedQty);
  const planned = qty(batch.plannedQty);
  if (alreadyReleased.plus(q).greaterThan(planned)) {
    throw new InvariantViolation(
      ERR.RELEASE_EXCEEDS_BATCH_QTY,
      'Release would exceed the batch planned quantity',
      {
        batchId: batch.id,
        requestedQty: q.toFixed(),
        releasedQty: alreadyReleased.toFixed(),
        plannedQty: planned.toFixed(),
      },
    );
  }
  if (firstTask.sequence !== 1) {
    throw new IllegalStateError(
      ERR.STAGE_SEQUENCE_VIOLATION,
      'Quantity may only be released into the first step of the route',
      { stageTaskId: firstTask.id, sequence: firstTask.sequence },
    );
  }
  return {
    movementType: 'RELEASE_TO_FIRST_STAGE',
    qty: q,
    deltas: [{ stageTaskId: firstTask.id, receivedQtyDelta: q }],
    batchDelta: { releasedQtyDelta: q },
  };
}

export interface StageOutcome {
  readonly completedQty?: DecimalLike;
  readonly rejectedQty?: DecimalLike;
  readonly reworkQty?: DecimalLike;
}

/**
 * Record what a stage did with the garments it holds.
 *
 * This is the operation behind the specification's cutting example - received
 * 100, completed 95, rejected 5 - and it is bounded by the stage's own WIP.
 * A second identical submission therefore fails rather than silently doubling
 * the numbers; genuine re-submission is handled upstream by the scan
 * idempotency key.
 */
export function planStageOutcome(task: StageTaskState, outcome: StageOutcome): StageTransitionPlan {
  const completed = qty(outcome.completedQty ?? 0);
  const rejected = qty(outcome.rejectedQty ?? 0);
  const rework = qty(outcome.reworkQty ?? 0);

  for (const [name, v] of [['completedQty', completed], ['rejectedQty', rejected], ['reworkQty', rework]] as const) {
    if (v.lessThan(0)) {
      throw new ValidationError(ERR.NON_POSITIVE_QTY, `${name} cannot be negative`, {
        stageTaskId: task.id, [name]: v.toFixed(),
      });
    }
  }

  const total = completed.plus(rejected).plus(rework);
  if (total.lessThanOrEqualTo(0)) {
    throw new ValidationError(
      ERR.NON_POSITIVE_QTY,
      'At least one of completed, rejected or rework quantity must be greater than zero',
      { stageTaskId: task.id },
    );
  }

  const wip = wipAtStage(task);
  if (total.greaterThan(wip)) {
    throw new InvariantViolation(
      ERR.STAGE_OUTCOME_EXCEEDS_RECEIVED,
      'Recorded quantity exceeds the work in progress at this stage',
      {
        stageTaskId: task.id,
        stageCode: task.stageCode,
        submittedQty: total.toFixed(),
        wipQty: wip.toFixed(),
        receivedQty: qty(task.receivedQty).toFixed(),
        completedQty: qty(task.completedQty).toFixed(),
        rejectedQty: qty(task.rejectedQty).toFixed(),
        reworkOutstandingQty: reworkOutstanding(task).toFixed(),
      },
    );
  }

  return {
    movementType: 'COMPLETE',
    qty: total,
    deltas: [
      {
        stageTaskId: task.id,
        completedQtyDelta: completed,
        rejectedQtyDelta: rejected,
        reworkSentQtyDelta: rework,
      },
    ],
    batchDelta: { rejectedQtyDelta: rejected.greaterThan(0) ? rejected : undefined },
  };
}

/**
 * Hand accepted quantity from one stage to the next.
 *
 * Two guards, both of which the specification calls out explicitly:
 *  - the destination must be the immediately following route step, so work
 *    cannot skip embroidery just because nobody scanned it;
 *  - the quantity is capped at (completed - already forwarded) at the source,
 *    which is what "quantity cannot advance beyond the accepted quantity at
 *    the preceding stage" means in arithmetic.
 */
export function planForward(
  fromTask: StageTaskState,
  toTask: StageTaskState,
  forwardQty: DecimalLike,
  options: { readonly allowStageSkip?: boolean } = {},
): StageTransitionPlan {
  const q = requirePositive(forwardQty, 'forwardQty', { fromStageTaskId: fromTask.id });

  if (toTask.sequence <= fromTask.sequence) {
    throw new IllegalStateError(
      ERR.STAGE_SEQUENCE_VIOLATION,
      'Quantity can only move forward through the route',
      { fromSequence: fromTask.sequence, toSequence: toTask.sequence },
    );
  }
  if (!options.allowStageSkip && toTask.sequence !== fromTask.sequence + 1) {
    throw new IllegalStateError(
      ERR.STAGE_SEQUENCE_VIOLATION,
      'Quantity must move to the next step of the route; skipping requires authorisation',
      {
        fromStageTaskId: fromTask.id,
        fromSequence: fromTask.sequence,
        toSequence: toTask.sequence,
      },
    );
  }

  const eligible = availableToForward(fromTask);
  if (q.greaterThan(eligible)) {
    throw new InvariantViolation(
      ERR.STAGE_RECEIPT_EXCEEDS_UPSTREAM,
      'Quantity exceeds the accepted quantity still available at the preceding stage',
      {
        fromStageTaskId: fromTask.id,
        fromStageCode: fromTask.stageCode,
        requestedQty: q.toFixed(),
        availableToForwardQty: eligible.toFixed(),
        completedQty: qty(fromTask.completedQty).toFixed(),
        forwardedQty: qty(fromTask.forwardedQty).toFixed(),
      },
    );
  }

  return {
    movementType: 'FORWARD',
    qty: q,
    deltas: [
      { stageTaskId: fromTask.id, forwardedQtyDelta: q },
      { stageTaskId: toTask.id, receivedQtyDelta: q },
    ],
    batchDelta: {},
  };
}

/** Send WIP at a stage out to rework. Bounded by the stage's WIP. */
export function planSendToRework(task: StageTaskState, reworkQty: DecimalLike): StageTransitionPlan {
  const q = requirePositive(reworkQty, 'reworkQty', { stageTaskId: task.id });
  const wip = wipAtStage(task);
  if (q.greaterThan(wip)) {
    throw new InvariantViolation(
      ERR.STAGE_OUTCOME_EXCEEDS_RECEIVED,
      'Rework quantity exceeds the work in progress at this stage',
      { stageTaskId: task.id, requestedQty: q.toFixed(), wipQty: wip.toFixed() },
    );
  }
  return {
    movementType: 'SEND_TO_REWORK',
    qty: q,
    deltas: [{ stageTaskId: task.id, reworkSentQtyDelta: q }],
    batchDelta: {},
  };
}

/**
 * Bring reworked quantity back to the stage it left.
 *
 * The garments return to this stage's WIP and must be completed (and, at a QC
 * step, re-inspected) again. Because they never left the stage's `receivedQty`,
 * the quantity is conserved across the loop and a garment that is reworked
 * twice is still one garment.
 */
export function planReturnFromRework(
  task: StageTaskState,
  returnQty: DecimalLike,
): StageTransitionPlan {
  const q = requirePositive(returnQty, 'returnQty', { stageTaskId: task.id });
  const outstanding = reworkOutstanding(task);
  if (q.greaterThan(outstanding)) {
    throw new InvariantViolation(
      ERR.REWORK_RETURN_EXCEEDS_SENT,
      'Return quantity exceeds the quantity currently out in rework',
      {
        stageTaskId: task.id,
        requestedQty: q.toFixed(),
        reworkOutstandingQty: outstanding.toFixed(),
      },
    );
  }
  return {
    movementType: 'RETURN_FROM_REWORK',
    qty: q,
    deltas: [{ stageTaskId: task.id, reworkReturnedQtyDelta: q }],
    batchDelta: {},
  };
}

/**
 * Completing the LAST step of the route is what makes a garment "finished" at
 * the batch level. Any earlier stage completing does not.
 */
export function planFinalStageCompletion(
  batch: BatchState,
  lastTask: StageTaskState,
  outcome: StageOutcome,
): StageTransitionPlan {
  const plan = planStageOutcome(lastTask, outcome);
  const completed = qty(outcome.completedQty ?? 0);
  return {
    ...plan,
    batchDelta: {
      ...plan.batchDelta,
      finishedQtyDelta: completed.greaterThan(0) ? completed : undefined,
    },
  };
}

export interface StageProgressRow {
  readonly stageTaskId: string;
  readonly sequence: number;
  readonly stageCode?: string;
  readonly receivedQty: Decimal;
  readonly completedQty: Decimal;
  readonly rejectedQty: Decimal;
  readonly reworkOutstandingQty: Decimal;
  readonly wipQty: Decimal;
  readonly availableToForwardQty: Decimal;
  readonly pendingQty: Decimal;
}

export interface BatchProgress {
  readonly batchId: string;
  readonly plannedQty: Decimal;
  readonly releasedQty: Decimal;
  /** Completed the final route step. */
  readonly finishedQty: Decimal;
  /** Rejected anywhere along the route. */
  readonly totalRejectedQty: Decimal;
  /** Out in rework anywhere along the route. */
  readonly totalReworkOutstandingQty: Decimal;
  /** Released but neither finished, rejected, nor in rework. */
  readonly totalWipQty: Decimal;
  readonly stages: readonly StageProgressRow[];
  readonly currentStageCode: string | null;
}

/**
 * Build the batch progress view.
 *
 * The important thing this does NOT do is add completed quantities together.
 * For the specification's example - cutting 100, stitching 85, finishing 60,
 * QC 50 - the batch has produced 50 QC-passed garments and has 50 in progress
 * spread across stages; it has not produced 295. Each stage reports its own
 * position, and the batch totals come from the route's endpoints.
 */
export function computeBatchProgress(batch: BatchState, tasks: readonly StageTaskState[]): BatchProgress {
  const ordered = [...tasks].sort((a, b) => a.sequence - b.sequence);
  const stages: StageProgressRow[] = ordered.map((t) => ({
    stageTaskId: t.id,
    sequence: t.sequence,
    stageCode: t.stageCode,
    receivedQty: qty(t.receivedQty),
    completedQty: qty(t.completedQty),
    rejectedQty: qty(t.rejectedQty),
    reworkOutstandingQty: reworkOutstanding(t),
    wipQty: wipAtStage(t),
    availableToForwardQty: availableToForward(t),
    pendingQty: clampNonNegative(qty(t.receivedQty).minus(qty(t.completedQty)).minus(qty(t.rejectedQty))),
  }));

  const last = ordered[ordered.length - 1];
  const finished = last ? qty(last.completedQty) : new Decimal(0);
  const totalRejected = stages.reduce<Decimal>((a, s) => a.plus(s.rejectedQty), new Decimal(0));
  const totalRework = stages.reduce<Decimal>((a, s) => a.plus(s.reworkOutstandingQty), new Decimal(0));
  const released = qty(batch.releasedQty);

  const active = stages.find((s) => s.wipQty.greaterThan(0) || s.availableToForwardQty.greaterThan(0));

  return {
    batchId: batch.id,
    plannedQty: qty(batch.plannedQty),
    releasedQty: released,
    finishedQty: finished,
    totalRejectedQty: qty(totalRejected),
    totalReworkOutstandingQty: qty(totalRework),
    totalWipQty: clampNonNegative(released.minus(finished).minus(totalRejected).minus(totalRework)),
    stages,
    currentStageCode: active?.stageCode ?? null,
  };
}

/**
 * Chain check across the whole route: a stage can never have received more
 * than the stage before it forwarded. Used by the nightly reconciliation job
 * and by the integration tests.
 */
export function assertRouteChainConsistent(tasks: readonly StageTaskState[], batch: BatchState): void {
  const ordered = [...tasks].sort((a, b) => a.sequence - b.sequence);
  ordered.forEach(assertStageTaskConsistent);

  const first = ordered[0];
  if (first && qty(first.receivedQty).greaterThan(qty(batch.releasedQty))) {
    throw new InvariantViolation(
      ERR.STAGE_RECEIPT_EXCEEDS_UPSTREAM,
      'First stage received more quantity than the batch released',
      {
        batchId: batch.id,
        firstStageReceivedQty: qty(first.receivedQty).toFixed(),
        batchReleasedQty: qty(batch.releasedQty).toFixed(),
      },
    );
  }

  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    if (qty(cur.receivedQty).greaterThan(qty(prev.forwardedQty))) {
      throw new InvariantViolation(
        ERR.STAGE_RECEIPT_EXCEEDS_UPSTREAM,
        `Stage at sequence ${cur.sequence} received more than sequence ${prev.sequence} forwarded`,
        {
          batchId: batch.id,
          stageTaskId: cur.id,
          receivedQty: qty(cur.receivedQty).toFixed(),
          upstreamForwardedQty: qty(prev.forwardedQty).toFixed(),
        },
      );
    }
  }
}
