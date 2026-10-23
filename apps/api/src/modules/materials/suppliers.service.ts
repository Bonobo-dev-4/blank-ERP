import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateSupplierRequest, PaginationQuery } from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { pageArgs, paginated, searchFilter } from '../../common/pagination';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, query: PaginationQuery & { status?: string }) {
    const where: Prisma.SupplierWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(searchFilter(query.search, ['supplierCode', 'name', 'contactPerson', 'city', 'gstin']) ?? {}),
    };
    const args = pageArgs(query, ['supplierCode', 'name', 'createdAt', 'leadTimeDays'], 'name');
    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where, ...args,
        include: { _count: { select: { purchaseOrders: true, materials: true, receipts: true } } },
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return paginated(rows, total, query);
  }

  async get(organizationId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, organizationId },
      include: {
        materials: { select: { id: true, materialCode: true, name: true, baseUom: true }, take: 100 },
        purchaseOrders: {
          select: { id: true, poNo: true, status: true, orderDate: true, totalAmount: true },
          orderBy: { orderDate: 'desc' }, take: 20,
        },
      },
    });
    if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier not found' });
    return supplier;
  }

  async create(organizationId: string, actorUserId: string, body: CreateSupplierRequest) {
    const created = await this.prisma.supplier.create({
      data: { ...normalise(body), organizationId } as Prisma.SupplierUncheckedCreateInput,
    });
    await this.audit.record({
      organizationId, actorUserId, action: 'CREATE',
      entityType: 'Supplier', entityId: created.id,
      diff: this.audit.diffOf(null, created as never),
    });
    return created;
  }

  async update(organizationId: string, actorUserId: string, id: string, body: Partial<CreateSupplierRequest>) {
    const before = await this.prisma.supplier.findFirst({ where: { id, organizationId } });
    if (!before) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier not found' });
    const after = await this.prisma.supplier.update({ where: { id }, data: normalise(body) });
    await this.audit.record({
      organizationId, actorUserId, action: 'UPDATE',
      entityType: 'Supplier', entityId: id,
      diff: this.audit.diffOf(before as never, after as never),
    });
    return after;
  }
}

function normalise(body: Partial<CreateSupplierRequest>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  // An empty email string would fail the format check on a later update.
  if (out.email === '') out.email = null;
  return out;
}
