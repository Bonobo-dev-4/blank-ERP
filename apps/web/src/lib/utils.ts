import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format a decimal STRING for display.
 *
 * Quantities arrive from the API as strings precisely so they are not routed
 * through a JS float. They are formatted with Intl here and never parsed into
 * arithmetic on this side: the browser displays numbers, the server owns them.
 */
export function fmtQty(value: string | null | undefined, dp = 2): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Quantity with its unit, e.g. "262.50 m". */
export function fmtQtyUom(value: string | null | undefined, uom?: string | null, dp = 2): string {
  const q = fmtQty(value, dp);
  if (q === '-') return q;
  return uom ? `${q} ${uomShort(uom)}` : q;
}

export function fmtMoney(value: string | null | undefined, dp = 2): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Compact money for dashboard tiles: 1.7L, 2.4Cr - the units Indian ops use. */
export function fmtMoneyCompact(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
  return `₹${n.toFixed(0)}`;
}

export function fmtInt(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-IN');
}

const UOM_SHORT: Record<string, string> = {
  METER: 'm', YARD: 'yd', PIECE: 'pc', KILOGRAM: 'kg',
  GRAM: 'g', ROLL: 'roll', PACKET: 'pkt', SET: 'set',
};
export const uomShort = (uom: string): string => UOM_SHORT[uom] ?? uom.toLowerCase();

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtRelative(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60_000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return fmtDate(d);
}

/** Humanise an enum value: PARTIALLY_RECEIVED -> Partially received. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '-';
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Fresh idempotency key for a mutating request.
 *
 * Generated once per form submission attempt, so a double-click or a retry on
 * a flaky connection replays the same key and the server returns the stored
 * result instead of applying the effect twice.
 */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
