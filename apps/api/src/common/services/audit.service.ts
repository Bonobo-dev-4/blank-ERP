import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  readonly organizationId: string;
  readonly actorUserId?: string | null;
  readonly actorLabel?: string | null;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly diff?: Prisma.InputJsonValue;
  readonly context?: Prisma.InputJsonValue;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

/**
 * Append-only audit trail.
 *
 * Written inside the caller's transaction wherever one exists, so an audited
 * action and its audit row commit or roll back together - an audit log that can
 * disagree with the data it describes is worse than none.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId ?? null,
        actorLabel: entry.actorLabel ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        diff: entry.diff ?? undefined,
        context: entry.context ?? undefined,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }

  /**
   * Field-level diff of a record update, with secret-bearing fields removed.
   * Only changed fields are kept, which keeps the log readable.
   */
  diffOf(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Prisma.InputJsonValue {
    const SECRET = /password|passwordhash|pinhash|secret|token|credential|accesskey/i;
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of keys) {
      if (SECRET.test(key)) continue;
      const from = serialise(before?.[key]);
      const to = serialise(after?.[key]);
      if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
    }
    return changes as Prisma.InputJsonValue;
  }
}

/** Decimals and dates must survive as readable strings in the JSON diff. */
function serialise(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v !== null && 'toFixed' in v && typeof (v as { toFixed: unknown }).toFixed === 'function') {
    return String(v);
  }
  if (typeof v === 'bigint') return v.toString();
  return v;
}
