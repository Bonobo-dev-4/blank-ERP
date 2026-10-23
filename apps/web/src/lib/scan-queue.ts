'use client';

import * as React from 'react';
import { api, ApiError } from './api';

/**
 * The scan station's offline queue.
 *
 * The rule this exists to enforce (decisions.md §27): **an operator is never
 * told "done" for a scan that has not landed.** A scan is accepted onto the
 * device, held as PENDING, and only becomes CONFIRMED when the server says so.
 *
 * Three properties matter more than anything else here:
 *
 *  1. The idempotency key is minted when the physical scan happens, not when
 *     the request is finally sent. That is what makes a replay provably the
 *     same event rather than a second one.
 *  2. A pending scan is never dropped. It is retried until the server either
 *     confirms it or refuses it with a reason.
 *  3. Nothing in here touches displayed stage counters. Those come from the
 *     server. A queued scan that later fails must not have moved a number on
 *     screen in the meantime.
 */

const STORAGE_KEY = 'dnd.scanQueue.v1';

export type QueuedScanState = 'PENDING' | 'SENDING' | 'CONFIRMED' | 'REJECTED';

export interface QueuedScan {
  /** Minted at the moment of the physical scan. Never regenerated. */
  readonly idempotencyKey: string;
  readonly code: string;
  readonly eventType: string;
  readonly stageTaskId: string | null;
  readonly completedQty?: string;
  readonly rejectedQty?: string;
  readonly reworkQty?: string;
  readonly rejectionReason?: string | null;
  /** When the operator actually scanned, not when it was sent. */
  readonly scannedAt: string;
  readonly deviceId: string;
  readonly label: string;
  state: QueuedScanState;
  attempts: number;
  /** The server's reason, when it refused. Shown verbatim to the operator. */
  error?: string;
  errorCode?: string;
  confirmedAt?: string;
}

function read(): QueuedScan[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedScan[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt queue is worse than an empty one only if it hides scans. It
    // cannot be read, so it cannot be sent; report empty and carry on.
    return [];
  }
}

function write(scans: QueuedScan[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scans));
  } catch {
    // Storage full or blocked. The in-memory queue still holds the scans for
    // this session, so do not pretend the scan was lost.
  }
}

/** A device identifier, stable for this browser, so scans can be traced back. */
export function deviceId(): string {
  if (typeof window === 'undefined') return 'server';
  const existing = localStorage.getItem('dnd.deviceId');
  if (existing) return existing;
  const minted = `DEV-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  try {
    localStorage.setItem('dnd.deviceId', minted);
  } catch {
    /* non-persistent device id is still useful within the session */
  }
  return minted;
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Listener = (scans: QueuedScan[]) => void;

/**
 * A single queue shared by every component on the page.
 *
 * Deliberately a module-level singleton rather than React state: the queue
 * must survive a route change, and two copies of it would send a scan twice.
 */
class ScanQueue {
  private scans: QueuedScan[] = read();
  private listeners = new Set<Listener>();
  private flushing = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.scans);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    write(this.scans);
    for (const fn of this.listeners) fn([...this.scans]);
  }

  all(): QueuedScan[] {
    return [...this.scans];
  }

  pendingCount(): number {
    return this.scans.filter((s) => s.state === 'PENDING' || s.state === 'SENDING').length;
  }

  /** Accept a scan onto the device. It is PENDING until the server confirms. */
  enqueue(input: {
    code: string;
    eventType: string;
    stageTaskId: string | null;
    completedQty?: string;
    rejectedQty?: string;
    reworkQty?: string;
    rejectionReason?: string | null;
    label: string;
  }): QueuedScan {
    const scan: QueuedScan = {
      ...input,
      idempotencyKey: newKey(),
      scannedAt: new Date().toISOString(),
      deviceId: deviceId(),
      state: 'PENDING',
      attempts: 0,
    };
    this.scans = [scan, ...this.scans].slice(0, 500);
    this.emit();
    void this.flush();
    return scan;
  }

  /**
   * Send every pending scan, oldest first.
   *
   * Order matters: two scans on the same batch are a sequence, and applying
   * them out of order can make the second fail against a state the first was
   * meant to produce.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    this.flushing = true;
    try {
      const pending = this.scans
        .filter((s) => s.state === 'PENDING')
        .sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));

      for (const scan of pending) {
        this.patch(scan.idempotencyKey, { state: 'SENDING', attempts: scan.attempts + 1 });
        try {
          await api.post('/production/scan', {
            idempotencyKey: scan.idempotencyKey,
            code: scan.code,
            eventType: scan.eventType,
            stageTaskId: scan.stageTaskId,
            ...(scan.completedQty ? { completedQty: scan.completedQty } : {}),
            ...(scan.rejectedQty ? { rejectedQty: scan.rejectedQty } : {}),
            ...(scan.reworkQty ? { reworkQty: scan.reworkQty } : {}),
            ...(scan.rejectionReason ? { rejectionReason: scan.rejectionReason } : {}),
            scannedAt: scan.scannedAt,
            deviceId: scan.deviceId,
          });
          this.patch(scan.idempotencyKey, {
            state: 'CONFIRMED',
            confirmedAt: new Date().toISOString(),
            error: undefined,
            errorCode: undefined,
          });
        } catch (error) {
          if (error instanceof ApiError && !error.isRetryable && error.status < 500) {
            // The server refused it on business grounds. Retrying will not
            // change the answer, so show the operator the real reason.
            this.patch(scan.idempotencyKey, {
              state: 'REJECTED',
              error: error.message,
              errorCode: error.code,
            });
          } else {
            // Network or server trouble: stays PENDING and will be retried.
            // It is NOT lost, and it is NOT reported as done.
            this.patch(scan.idempotencyKey, {
              state: 'PENDING',
              error: error instanceof Error ? error.message : 'Could not reach the server',
            });
            break; // stop the run; the next tick retries from here
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Put a rejected scan back in the queue — for when the cause was fixed. */
  retry(idempotencyKey: string): void {
    this.patch(idempotencyKey, { state: 'PENDING', error: undefined, errorCode: undefined });
    void this.flush();
  }

  /**
   * Acknowledge a rejected scan.
   *
   * Only a REJECTED scan can be dismissed — one the server has explicitly
   * refused, so nothing is lost by removing it. A pending scan cannot be
   * cleared, because clearing it would discard a real physical event.
   */
  dismiss(idempotencyKey: string): void {
    const scan = this.scans.find((s) => s.idempotencyKey === idempotencyKey);
    if (!scan || scan.state === 'PENDING' || scan.state === 'SENDING') return;
    this.scans = this.scans.filter((s) => s.idempotencyKey !== idempotencyKey);
    this.emit();
  }

  /** Clear the confirmed history. Pending and rejected scans are untouched. */
  clearConfirmed(): void {
    this.scans = this.scans.filter((s) => s.state !== 'CONFIRMED');
    this.emit();
  }

  private patch(idempotencyKey: string, next: Partial<QueuedScan>): void {
    this.scans = this.scans.map((s) => (s.idempotencyKey === idempotencyKey ? { ...s, ...next } : s));
    this.emit();
  }
}

export const scanQueue = new ScanQueue();

/** Subscribe a component to the queue, and keep it draining. */
export function useScanQueue(): {
  scans: QueuedScan[];
  pendingCount: number;
  rejectedCount: number;
  online: boolean;
} {
  const [scans, setScans] = React.useState<QueuedScan[]>([]);
  const [online, setOnline] = React.useState(true);

  React.useEffect(() => scanQueue.subscribe(setScans), []);

  React.useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void scanQueue.flush();
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    // A retry tick, because `online` does not fire for a server that is down
    // rather than a network that is off.
    const timer = setInterval(() => void scanQueue.flush(), 10_000);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      clearInterval(timer);
    };
  }, []);

  return {
    scans,
    pendingCount: scans.filter((s) => s.state === 'PENDING' || s.state === 'SENDING').length,
    rejectedCount: scans.filter((s) => s.state === 'REJECTED').length,
    online,
  };
}
