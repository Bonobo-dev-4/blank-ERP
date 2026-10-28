/**
 * Expected dispatch dates.
 *
 * The CRM team promises customers a dispatch date, and until now that promise
 * lived only in Shopify order notes, written by hand. This module reads it
 * back out — conservatively — and holds the calendar rules every screen
 * shares, in the business's own day (Asia/Kolkata).
 *
 * Measured on the store, 28 Oct 2026: 179 of 1,064 notes mention dispatch.
 * The common forms are "Dispatch By Date 15-10-2026" and "Dispatch by 12th
 * October" — the second usually without a year. 185 notes mention delivery,
 * which must never be read as dispatch.
 */

export const DISPATCH_DATE_SOURCES = [
  'CRM_MANUAL', 'SHOPIFY_METAFIELD', 'SHOPIFY_CUSTOM_ATTRIBUTE', 'SHOPIFY_NOTE', 'UNASSIGNED',
] as const;
export type DispatchDateSource = (typeof DISPATCH_DATE_SOURCES)[number];
export type ShopifyDispatchSource = Exclude<DispatchDateSource, 'CRM_MANUAL' | 'UNASSIGNED'>;

export type DispatchIssue = 'CONFLICTING_DATES' | 'AMBIGUOUS_DATE' | 'INVALID_DATE';

export interface DispatchDateFinding {
  /** YYYY-MM-DD, or null when there is no single trustworthy date. */
  readonly date: string | null;
  readonly source: ShopifyDispatchSource | null;
  /** The label and date as written, so a person can see what was read. */
  readonly text: string | null;
  readonly issue: DispatchIssue | null;
  /** The note gave a day and month only; the year came from the order date. */
  readonly yearInferred: boolean;
  /** Every distinct date found, for review when they disagree. */
  readonly candidates: readonly string[];
}

const NONE: DispatchDateFinding = { date: null, source: null, text: null, issue: null, yearInferred: false, candidates: [] };

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// -----------------------------------------------------------------------------
// Calendar, in Asia/Kolkata
// -----------------------------------------------------------------------------

const IST_OFFSET_MS = 330 * 60_000;

/** Today's date in India, as YYYY-MM-DD, whatever the server's timezone. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The calendar date of an instant, in India. */
export function istDateOf(instant: Date): string {
  return istToday(instant);
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidYmd(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

function ymd(y: number, m: number, d: number): string | null {
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidYmd(s) ? s : null;
}

function dayDiff(a: string, b: string): number {
  return Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000);
}

// -----------------------------------------------------------------------------
// Reading a date
// -----------------------------------------------------------------------------

type DateRead =
  | { kind: 'DATE'; date: string; yearInferred: boolean; consumed: number }
  | { kind: 'AMBIGUOUS' | 'INVALID'; consumed: number }
  | null;

/**
 * Read one date at the start of `s`.
 *
 * Numeric dates are day-first (DD/MM/YYYY, the Indian convention this store
 * writes in) or ISO year-first. A two-digit year is ambiguous and refused.
 * A day and month without a year take the year from the order: the first such
 * date on or after a month before the order — a dispatch promise is never a
 * year away, so anything that would be is refused as ambiguous.
 */
function readDate(s: string, orderDate: string): DateRead {
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s);
  if (m) {
    const date = ymd(+m[1]!, +m[2]!, +m[3]!);
    return date ? { kind: 'DATE', date, yearInferred: false, consumed: m[0].length } : { kind: 'INVALID', consumed: m[0].length };
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?!\d)/.exec(s);
  if (m) {
    if (m[3]!.length !== 4) return { kind: 'AMBIGUOUS', consumed: m[0].length };
    const date = ymd(+m[3]!, +m[2]!, +m[1]!);
    return date ? { kind: 'DATE', date, yearInferred: false, consumed: m[0].length } : { kind: 'INVALID', consumed: m[0].length };
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?[\s\-.,/]*([a-z]{3,9})\.?(?:[\s\-.,/']+(\d{4}))?(?![a-z\d])/i.exec(s);
  if (m && MONTHS[m[2]!.toLowerCase()]) {
    return withYear(+m[1]!, MONTHS[m[2]!.toLowerCase()]!, m[3] ? +m[3] : null, orderDate, m[0].length);
  }
  m = /^([a-z]{3,9})\.?[\s\-]+(\d{1,2})(?:st|nd|rd|th)?(?:,?[\s\-]+(\d{4}))?(?![a-z\d])/i.exec(s);
  if (m && MONTHS[m[1]!.toLowerCase()]) {
    return withYear(+m[2]!, MONTHS[m[1]!.toLowerCase()]!, m[3] ? +m[3] : null, orderDate, m[0].length);
  }
  return null;
}

function withYear(day: number, month: number, year: number | null, orderDate: string, consumed: number): DateRead {
  if (year !== null) {
    const date = ymd(year, month, day);
    return date ? { kind: 'DATE', date, yearInferred: false, consumed } : { kind: 'INVALID', consumed };
  }
  const orderYear = Number(orderDate.slice(0, 4));
  let date = ymd(orderYear, month, day);
  if (!date) return { kind: 'INVALID', consumed };
  if (dayDiff(date, orderDate) < -31) date = ymd(orderYear + 1, month, day);
  if (!date || dayDiff(date, orderDate) > 300) return { kind: 'AMBIGUOUS', consumed };
  return { kind: 'DATE', date, yearInferred: true, consumed };
}

/** Words that may sit between "dispatch" and its date. Nothing else may. */
const FILLER = /^(?:[\s:\-–—=,.()]|\b(?:date|dt|by|on|before|is|latest|the|of|for|will|be|should|expected|exp|tentative|approx|around)\b)*/i;

/**
 * A dispatch date from free text — only where the text names it as one.
 *
 * Each "dispatch" (or "despatch") is a label; the date must follow it with
 * nothing but filler words between. "Delivery by 5 Nov" is therefore never
 * read, nor is an order date elsewhere in the note. Two different dates is a
 * conflict for a person, not a choice for the parser.
 */
export function extractDispatchDateFromText(text: string | null | undefined, orderDate: string): Omit<DispatchDateFinding, 'source'> {
  if (!text) return { ...NONE };
  const found: { date: string; text: string; yearInferred: boolean }[] = [];
  let ambiguous = false;
  let invalid = false;

  for (const label of text.matchAll(/\b(?:expected\s+)?d[ie]spatch\b/gi)) {
    const after = text.slice(label.index! + label[0].length);
    const filler = FILLER.exec(after)?.[0] ?? '';
    const rest = after.slice(filler.length);
    const read = readDate(rest, orderDate);
    if (!read) continue;
    const snippet = text.slice(label.index!, label.index! + label[0].length + filler.length + read.consumed).replace(/\s+/g, ' ').trim();
    if (read.kind === 'DATE') found.push({ date: read.date, text: snippet, yearInferred: read.yearInferred });
    else if (read.kind === 'AMBIGUOUS') ambiguous = true;
    else invalid = true;
  }

  const candidates = [...new Set(found.map((f) => f.date))].sort();
  if (candidates.length > 1) {
    return { date: null, text: found.map((f) => f.text).join(' | '), issue: 'CONFLICTING_DATES', yearInferred: false, candidates };
  }
  if (candidates.length === 1 && !ambiguous) {
    const first = found[0]!;
    return { date: first.date, text: first.text, issue: null, yearInferred: found.some((f) => f.yearInferred), candidates };
  }
  if (ambiguous || candidates.length === 1) {
    return { date: null, text: found[0]?.text ?? null, issue: 'AMBIGUOUS_DATE', yearInferred: false, candidates };
  }
  return invalid ? { ...NONE, issue: 'INVALID_DATE' } : { ...NONE };
}

/** A structured field's value: the whole value must be one date. */
export function parseDispatchDateValue(value: string | null | undefined, orderDate: string): Omit<DispatchDateFinding, 'source'> {
  const v = value?.trim();
  if (!v) return { ...NONE };
  const read = readDate(v, orderDate);
  if (!read || read.consumed < v.replace(/[\s.]+$/, '').length) return { ...NONE, text: v, issue: 'INVALID_DATE' };
  if (read.kind !== 'DATE') return { ...NONE, text: v, issue: read.kind === 'AMBIGUOUS' ? 'AMBIGUOUS_DATE' : 'INVALID_DATE' };
  return { date: read.date, text: v, issue: null, yearInferred: read.yearInferred, candidates: [read.date] };
}

/**
 * What Shopify says the dispatch date is, by precedence: an approved
 * metafield, then a checkout attribute named for dispatch, then the note.
 * The first source that has anything to say wins — including saying it is
 * ambiguous, so a structured field is never silently outvoted by free text.
 */
export function detectShopifyDispatchDate(input: {
  readonly note: string | null;
  readonly attributes: readonly { key: string; value: string | null }[];
  readonly metafieldValue: string | null;
  readonly orderedAt: Date;
}): DispatchDateFinding {
  const orderDate = istDateOf(input.orderedAt);
  if (input.metafieldValue?.trim()) {
    return { ...parseDispatchDateValue(input.metafieldValue, orderDate), source: 'SHOPIFY_METAFIELD' };
  }
  const attr = input.attributes.find((a) => /d[ie]spatch/i.test(a.key) && !/deliver/i.test(a.key) && a.value?.trim());
  if (attr) {
    const read = parseDispatchDateValue(attr.value, orderDate);
    return { ...read, text: `${attr.key}: ${attr.value}`, source: 'SHOPIFY_CUSTOM_ATTRIBUTE' };
  }
  const note = extractDispatchDateFromText(input.note, orderDate);
  return note.date || note.issue ? { ...note, source: 'SHOPIFY_NOTE' } : { ...NONE };
}

// -----------------------------------------------------------------------------
// Filters and display
// -----------------------------------------------------------------------------

export const DISPATCH_PRESETS = [
  'TODAY', 'TOMORROW', 'NEXT_3_DAYS', 'NEXT_7_DAYS', 'THIS_WEEK', 'THIS_MONTH', 'OVERDUE', 'NONE', 'CUSTOM',
] as const;
export type DispatchPreset = (typeof DISPATCH_PRESETS)[number];

export type DispatchWindow =
  | { readonly kind: 'RANGE'; readonly from: string | null; readonly to: string | null }
  | { readonly kind: 'OVERDUE'; readonly before: string }
  | { readonly kind: 'NONE' };

/**
 * A preset as a date range in India. "Next N days" counts today: next 3 days
 * is today and the two after it. Weeks run Monday to Sunday.
 */
export function dispatchWindow(
  preset: DispatchPreset, now: Date, custom: { from?: string | null; to?: string | null } = {},
): DispatchWindow {
  const today = istToday(now);
  switch (preset) {
    case 'TODAY': return { kind: 'RANGE', from: today, to: today };
    case 'TOMORROW': return { kind: 'RANGE', from: addDays(today, 1), to: addDays(today, 1) };
    case 'NEXT_3_DAYS': return { kind: 'RANGE', from: today, to: addDays(today, 2) };
    case 'NEXT_7_DAYS': return { kind: 'RANGE', from: today, to: addDays(today, 6) };
    case 'THIS_WEEK': {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      return { kind: 'RANGE', from: addDays(today, -dow), to: addDays(today, 6 - dow) };
    }
    case 'THIS_MONTH': {
      const first = `${today.slice(0, 7)}-01`;
      const next = new Date(`${first}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return { kind: 'RANGE', from: first, to: addDays(next.toISOString().slice(0, 10), -1) };
    }
    case 'OVERDUE': return { kind: 'OVERDUE', before: today };
    case 'NONE': return { kind: 'NONE' };
    case 'CUSTOM': return {
      kind: 'RANGE',
      from: custom.from && isValidYmd(custom.from) ? custom.from : null,
      to: custom.to && isValidYmd(custom.to) ? custom.to : null,
    };
  }
}

/** Has the order left, or will it never? Either way a past date is not overdue. */
export function isDispatchSettled(order: {
  readonly status: string; readonly externalShipmentStatus: string | null;
}): boolean {
  return ['FULFILLED', 'CANCELLED'].includes(order.status)
    || ['COMPLETE', 'CANCELLED'].includes(order.externalShipmentStatus ?? '');
}

export type DispatchState = 'NONE' | 'OVERDUE' | 'TODAY' | 'SOON' | 'LATER' | 'SETTLED';

/** How a dispatch date should read today: overdue red, today blue, soon amber. */
export function dispatchState(date: string | null, today: string, settled: boolean): DispatchState {
  if (!date) return 'NONE';
  if (settled) return 'SETTLED';
  const diff = dayDiff(date, today);
  if (diff < 0) return 'OVERDUE';
  if (diff === 0) return 'TODAY';
  if (diff <= 2) return 'SOON';
  return 'LATER';
}
