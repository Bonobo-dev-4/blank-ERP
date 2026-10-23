import { ERR, IllegalStateError, ValidationError } from '../errors';

export const BARCODE_KINDS = [
  'MATERIAL_LOT',
  'FABRIC_ROLL',
  'PRODUCTION_BATCH',
  'PRODUCTION_UNIT',
  'GOODS_RECEIPT',
  'FG_CARTON',
] as const;

export type BarcodeKind = (typeof BARCODE_KINDS)[number];

/**
 * Barcode identity strategy.
 *
 * The printed symbol carries ONLY a short, stable, opaque-ish identifier. It
 * does not carry JSON, quantities, or stage information, for three reasons:
 *
 *  1. Context changes. A label printed when a batch was at cutting would still
 *     claim "stage: CUTTING" three weeks later. The server is the only honest
 *     source of a batch's current state.
 *  2. Code 128 density. An embedded JSON payload produces a symbol too wide to
 *     print on a garment tag and too error-prone for a cheap USB scanner.
 *  3. Mutability. Quantities get split and merged. An identifier does not.
 *
 * Codes are human-readable because operators read them aloud over the noise of
 * a stitching floor and type them in when a scanner fails.
 */
export const BARCODE_PREFIXES: Readonly<Record<BarcodeKind, string>> = {
  MATERIAL_LOT: 'LOT',
  FABRIC_ROLL: 'ROL',
  PRODUCTION_BATCH: 'BAT',
  PRODUCTION_UNIT: 'UNT',
  GOODS_RECEIPT: 'GRN',
  FG_CARTON: 'CTN',
};

/** Characters that survive a bad print and a tired human: no 0/O or 1/I/L. */
const CROCKFORD = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

const CODE_PATTERN = /^(LOT|ROL|BAT|UNT|GRN|CTN)-[0-9A-Z-]{3,40}$/;

/** Normalise a scanned string: scanners add whitespace and casing varies. */
export function normaliseScannedCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isWellFormedBarcode(code: string): boolean {
  return CODE_PATTERN.test(normaliseScannedCode(code));
}

/**
 * Mod-30 check character over the Crockford alphabet.
 *
 * Catches the single most common shop-floor failure: a code read aloud and
 * typed in with one character wrong. Cheap to compute, no external dependency.
 */
export function checkCharacter(payload: string): string {
  let sum = 0;
  const body = normaliseScannedCode(payload);
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    const v = CROCKFORD.indexOf(ch);
    sum += (v >= 0 ? v : ch.charCodeAt(0) % CROCKFORD.length) * (i + 1);
  }
  return CROCKFORD[sum % CROCKFORD.length]!;
}

/** Batch barcode: BAT-<MO number body>-B<nn>-<check>, e.g. BAT-000125-B01-K. */
export function buildBatchCode(moNo: string, batchSequence: number): string {
  if (batchSequence < 1 || batchSequence > 999) {
    throw new ValidationError('INVALID_BATCH_SEQUENCE', 'Batch sequence must be between 1 and 999', {
      batchSequence,
    });
  }
  const body = `${compactDocNo(moNo)}-B${String(batchSequence).padStart(2, '0')}`;
  return `${BARCODE_PREFIXES.PRODUCTION_BATCH}-${body}-${checkCharacter(body)}`;
}

/** Unit barcode: UNT-<MO body>-B<nn>-U<nnnn>-<check>. */
export function buildUnitCode(moNo: string, batchSequence: number, unitSequence: number): string {
  if (unitSequence < 1 || unitSequence > 99999) {
    throw new ValidationError('INVALID_UNIT_SEQUENCE', 'Unit sequence must be between 1 and 99999', {
      unitSequence,
    });
  }
  const body = `${compactDocNo(moNo)}-B${String(batchSequence).padStart(2, '0')}-U${String(unitSequence).padStart(4, '0')}`;
  return `${BARCODE_PREFIXES.PRODUCTION_UNIT}-${body}-${checkCharacter(body)}`;
}

export function buildLotCode(lotCode: string): string {
  const body = compactDocNo(lotCode);
  return `${BARCODE_PREFIXES.MATERIAL_LOT}-${body}-${checkCharacter(body)}`;
}

export function buildRollCode(rollNo: string): string {
  const body = compactDocNo(rollNo);
  return `${BARCODE_PREFIXES.FABRIC_ROLL}-${body}-${checkCharacter(body)}`;
}

export function buildReceiptCode(grnNo: string): string {
  const body = compactDocNo(grnNo);
  return `${BARCODE_PREFIXES.GOODS_RECEIPT}-${body}-${checkCharacter(body)}`;
}

/** Strip a document prefix down to its significant characters. */
function compactDocNo(docNo: string): string {
  const cleaned = normaliseScannedCode(docNo).replace(/[^0-9A-Z]/g, '');
  // Keep the tail, which is the part that actually varies.
  return cleaned.length > 18 ? cleaned.slice(-18) : cleaned;
}

export function kindOf(code: string): BarcodeKind | null {
  const prefix = normaliseScannedCode(code).split('-')[0];
  const entry = Object.entries(BARCODE_PREFIXES).find(([, p]) => p === prefix);
  return entry ? (entry[0] as BarcodeKind) : null;
}

export interface BarcodeResolution {
  readonly code: string;
  readonly kind: BarcodeKind;
  readonly isActive: boolean;
  readonly revokedAt?: Date | null;
}

/** Guard applied to every scan before any quantity is touched. */
export function assertScannable(
  resolution: BarcodeResolution | null,
  scannedCode: string,
  expectedKinds?: readonly BarcodeKind[],
): BarcodeResolution {
  if (!resolution) {
    throw new ValidationError(ERR.BARCODE_UNKNOWN, 'This barcode is not known to the system', {
      scannedCode: normaliseScannedCode(scannedCode),
    });
  }
  if (!resolution.isActive) {
    throw new IllegalStateError(ERR.BARCODE_REVOKED, 'This barcode has been revoked and reprinted', {
      scannedCode: resolution.code,
      revokedAt: resolution.revokedAt ?? null,
    });
  }
  if (expectedKinds && !expectedKinds.includes(resolution.kind)) {
    throw new IllegalStateError(
      'BARCODE_WRONG_KIND',
      `This screen expects a ${expectedKinds.join(' or ')} barcode, but ${resolution.kind} was scanned`,
      { scannedCode: resolution.code, actualKind: resolution.kind, expectedKinds },
    );
  }
  return resolution;
}
