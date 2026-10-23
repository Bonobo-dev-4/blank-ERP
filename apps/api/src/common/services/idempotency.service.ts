import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface IdempotentResult<T> {
  readonly result: T;
  /** True when the stored result of an earlier identical call was returned. */
  readonly replayed: boolean;
}

/**
 * Request-level idempotency for stock and production mutations.
 *
 * The shop floor runs barcode terminals on factory wifi. A scan that times out
 * gets retried - by the device, or by an operator who did not see a
 * confirmation. Without this, one physical event becomes two ledger entries,
 * and the specification is explicit that must not happen.
 *
 * Behaviour:
 *  - same key, same payload -> the stored result is returned, nothing re-runs
 *  - same key, DIFFERENT payload -> 409, because the client has reused a key
 *    for a different operation and silently accepting either answer would be
 *    wrong
 *  - key in flight -> 409 asking the caller to retry, rather than running the
 *    operation twice concurrently
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  static hashPayload(payload: unknown): string {
    return createHash('sha256').update(stableStringify(payload)).digest('hex');
  }

  async execute<T>(
    params: {
      organizationId: string;
      scope: string;
      key: string;
      payload: unknown;
      entityType?: string;
    },
    work: () => Promise<{ result: T; entityId?: string | null }>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = IdempotencyService.hashPayload(params.payload);
    const where = {
      organizationId_scope_key: {
        organizationId: params.organizationId,
        scope: params.scope,
        key: params.key,
      },
    };

    const existing = await this.prisma.idempotencyRecord.findUnique({ where });
    if (existing) {
      return this.replay<T>(existing, requestHash, params);
    }

    // Claim the key. A unique-violation here means a concurrent request won the
    // race, so we fall back to the replay path.
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          organizationId: params.organizationId,
          scope: params.scope,
          key: params.key,
          requestHash,
          status: 'IN_FLIGHT',
          entityType: params.entityType ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.idempotencyRecord.findUnique({ where });
        if (raced) return this.replay<T>(raced, requestHash, params);
      }
      throw e;
    }

    try {
      const { result, entityId } = await work();
      await this.prisma.idempotencyRecord.update({
        where,
        data: {
          status: 'COMPLETED',
          responseBody: toJson(result),
          entityId: entityId ?? null,
          completedAt: new Date(),
        },
      });
      return { result, replayed: false };
    } catch (error) {
      // A failed attempt releases the key so the caller can correct the request
      // and try again. The operation did not take effect, so there is nothing
      // to protect against repeating.
      await this.prisma.idempotencyRecord
        .delete({ where })
        .catch(() => this.logger.warn(`Could not release idempotency key ${params.scope}:${params.key}`));
      throw error;
    }
  }

  private replay<T>(
    existing: { status: string; requestHash: string; responseBody: unknown },
    requestHash: string,
    params: { scope: string; key: string },
  ): IdempotentResult<T> {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message:
          'This idempotency key was already used for a different request. Generate a new key for a new operation.',
        details: { scope: params.scope, key: params.key },
      });
    }
    if (existing.status === 'IN_FLIGHT') {
      throw new ConflictException({
        code: 'REQUEST_IN_FLIGHT',
        message: 'An identical request is still being processed. Retry in a moment.',
        details: { scope: params.scope, key: params.key },
      });
    }
    return { result: existing.responseBody as T, replayed: true };
  }
}

/** Key-order-independent JSON, so {a,b} and {b,a} hash identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue;
}
