import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SYSTEM_LOCATION_SPECS } from '@dnd/domain';
import type { CreateLocationRequest as CreateLocationBody } from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The full location tree, including the virtual counter-accounts. */
  async list(organizationId: string, options: { includeSystem?: boolean } = {}) {
    const rows = await this.prisma.materialLocation.findMany({
      where: {
        organizationId,
        ...(options.includeSystem ? {} : { isSystem: false }),
      },
      include: {
        jobWorker: { select: { id: true, code: true, name: true } },
        _count: { select: { balances: true } },
      },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
    });

    // Report how much stock each location actually holds, so an admin cannot
    // deactivate a rack that still has fabric on it without noticing.
    const totals = await this.prisma.materialBalance.groupBy({
      by: ['locationId'],
      where: { organizationId },
      _sum: { onHandQty: true, reservedQty: true },
    });
    const byLocation = new Map(totals.map((t) => [t.locationId, t._sum]));

    return rows.map((r) => ({
      ...r,
      totalOnHandQty: byLocation.get(r.id)?.onHandQty ?? new Prisma.Decimal(0),
      totalReservedQty: byLocation.get(r.id)?.reservedQty ?? new Prisma.Decimal(0),
    }));
  }

  async create(organizationId: string, actorUserId: string, body: CreateLocationBody) {
    if (body.parentId) {
      const parent = await this.prisma.materialLocation.findFirst({
        where: { id: body.parentId, organizationId },
        select: { id: true },
      });
      if (!parent) {
        throw new BadRequestException({ code: 'PARENT_NOT_FOUND', message: 'Parent location not found' });
      }
    }
    const created = await this.prisma.materialLocation.create({
      data: {
        organizationId,
        code: body.code,
        name: body.name,
        kind: body.kind,
        storageLevel: body.storageLevel ?? null,
        parentId: body.parentId ?? null,
        jobWorkerId: body.jobWorkerId ?? null,
        blocksIssue: body.blocksIssue,
        status: body.status,
      },
    });
    await this.audit.record({
      organizationId, actorUserId, action: 'CREATE',
      entityType: 'MaterialLocation', entityId: created.id,
      diff: this.audit.diffOf(null, created as never),
    });
    return created;
  }

  async update(
    organizationId: string,
    actorUserId: string,
    id: string,
    body: Partial<CreateLocationBody>,
  ) {
    const before = await this.prisma.materialLocation.findFirst({ where: { id, organizationId } });
    if (!before) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND', message: 'Location not found' });

    // System locations are the ledger's counter-accounts. Renaming one is
    // harmless; changing its code or kind would break movement resolution.
    if (before.isSystem && (body.code !== undefined || body.status !== undefined)) {
      throw new BadRequestException({
        code: 'SYSTEM_LOCATION_PROTECTED',
        message: 'A system location cannot be recoded or deactivated; it is part of the inventory ledger',
        details: { code: before.code },
      });
    }

    const after = await this.prisma.materialLocation.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.storageLevel !== undefined ? { storageLevel: body.storageLevel } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        ...(body.jobWorkerId !== undefined ? { jobWorkerId: body.jobWorkerId } : {}),
        ...(body.blocksIssue !== undefined ? { blocksIssue: body.blocksIssue } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });

    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'MaterialLocation', entityId: id,
      diff: this.audit.diffOf(before as never, after as never),
    });
    return after;
  }

  /** Create the system locations the ledger needs. Idempotent. */
  async ensureSystemLocations(organizationId: string): Promise<number> {
    let created = 0;
    for (const spec of SYSTEM_LOCATION_SPECS) {
      const existing = await this.prisma.materialLocation.findUnique({
        where: { organizationId_code: { organizationId, code: spec.code } },
        select: { id: true },
      });
      if (existing) continue;
      await this.prisma.materialLocation.create({
        data: {
          organizationId,
          code: spec.code,
          name: spec.name,
          kind: spec.kind,
          storageLevel: 'VIRTUAL',
          isSystem: true,
          blocksIssue: spec.blocksIssue,
        },
      });
      created += 1;
    }
    return created;
  }
}

