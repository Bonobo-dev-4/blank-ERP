import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Prisma client wrapper.
 *
 * `$transaction` is used everywhere stock or production quantities change, with
 * SERIALIZABLE-adjacent protection supplied by explicit row locks rather than a
 * blanket isolation level: locking only the balance rows a movement touches
 * keeps two unrelated materials from serialising against each other, which on
 * a busy shop floor is the difference between workable and unusable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run work in a transaction with the isolation and timeouts appropriate to
   * an inventory mutation. ReadCommitted plus explicit `FOR UPDATE` locks is
   * the combination that gives correctness without deadlock storms.
   */
  async inTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { timeoutMs?: number; maxWaitMs?: number } = {},
  ): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: options.timeoutMs ?? 15_000,
      maxWait: options.maxWaitMs ?? 5_000,
    });
  }
}
