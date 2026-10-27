import { z } from 'zod';

/** Unicommerce codes: plain identifiers, never paths or markup. */
const ucCode = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.\-/]+$/, 'Not a Unicommerce code');

export const facilitySwitchOptionsQuery = z.object({
  /** ERP order line to preselect; the operator still picks the exact item. */
  line: z.string().uuid().optional(),
  item: ucCode.optional(),
});

export const facilitySwitchPreflightRequest = z.object({
  saleOrderItemCode: ucCode,
  targetFacilityCode: ucCode,
  expectedCurrentFacilityCode: ucCode,
});
export type FacilitySwitchPreflightRequest = z.infer<typeof facilitySwitchPreflightRequest>;

export const facilitySwitchStartRequest = facilitySwitchPreflightRequest.extend({
  preflightToken: z.string().min(20).max(2000),
  reason: z.string().trim().min(5, 'Say why, in a few words').max(500),
});
export type FacilitySwitchStartRequest = z.infer<typeof facilitySwitchStartRequest>;

/** One key per confirmed operation; the same key replays, never re-sends. */
export const idempotencyKeyHeader = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);

export const facilitySwitchResolveRequest = z.object({
  action: z.enum(['PRODUCTION_REVIEWED', 'CONFIRM_NOT_APPLIED']),
  note: z.string().trim().min(5).max(1000),
});
export type FacilitySwitchResolveRequest = z.infer<typeof facilitySwitchResolveRequest>;
