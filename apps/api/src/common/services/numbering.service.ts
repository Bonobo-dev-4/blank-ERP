import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DOC_SCOPES, SEQUENCE_SPECS, formatDocNo, sequenceScopeKey, type DocScope } from '@dnd/domain';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Allocate the next document number.
   *
   * MUST be called with the caller's transaction client so the number is
   * allocated and the document written atomically: a committed number with no
   * document leaves a gap, and operations staff treat a gap in GRN numbers as
   * evidence of a missing delivery.
   *
   * The atomic `update` with `increment` takes a row lock on the counter, so
   * two concurrent receipts cannot be handed the same number.
   */
  async next(tx: Prisma.TransactionClient, organizationId: string, scope: DocScope): Promise<string> {
    const spec = SEQUENCE_SPECS[scope];
    const year = spec.includeYear ? new Date().getUTCFullYear() : undefined;
    const scopeKey = sequenceScopeKey(scope, year);

    const existing = await tx.numberSequence.findUnique({
      where: { organizationId_scope: { organizationId, scope: scopeKey } },
      select: { id: true },
    });

    if (!existing) {
      // First document of this scope (or of this year). Create the counter
      // already consumed so the first number issued is 1.
      try {
        await tx.numberSequence.create({
          data: {
            organizationId,
            scope: scopeKey,
            prefix: spec.prefix,
            padding: spec.padding,
            nextValue: 2,
          },
        });
        return formatDocNo(scope, 1, year);
      } catch {
        // Another transaction created it first; fall through to the increment.
      }
    }

    const updated = await tx.numberSequence.update({
      where: { organizationId_scope: { organizationId, scope: scopeKey } },
      data: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    return formatDocNo(scope, updated.nextValue - 1, year);
  }

  /** Allocate several numbers of the same scope in one round trip. */
  async nextBatch(
    tx: Prisma.TransactionClient,
    organizationId: string,
    scope: DocScope,
    count: number,
  ): Promise<string[]> {
    if (count < 1) return [];
    const spec = SEQUENCE_SPECS[scope];
    const year = spec.includeYear ? new Date().getUTCFullYear() : undefined;
    const scopeKey = sequenceScopeKey(scope, year);

    await tx.numberSequence.upsert({
      where: { organizationId_scope: { organizationId, scope: scopeKey } },
      update: {},
      create: {
        organizationId, scope: scopeKey, prefix: spec.prefix, padding: spec.padding, nextValue: 1,
      },
    });

    const updated = await tx.numberSequence.update({
      where: { organizationId_scope: { organizationId, scope: scopeKey } },
      data: { nextValue: { increment: count } },
      select: { nextValue: true },
    });

    const first = updated.nextValue - count;
    return Array.from({ length: count }, (_, i) => formatDocNo(scope, first + i, year));
  }
}

export { DOC_SCOPES };
export type { DocScope };
