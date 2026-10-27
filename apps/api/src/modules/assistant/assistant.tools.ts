import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@dnd/contracts';
import { Decimal, dec } from '@dnd/domain';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * What the assistant is allowed to look at.
 *
 * Three rules hold this together, and none of them is optional.
 *
 * **It reads as the person asking.** Every tool is gated on that user's own
 * permissions, and a tool they cannot use is not even described to the model.
 * Without this the assistant becomes a privilege escalation: a scan operator
 * asks "what did this order cost us" and gets margin data the UI would never
 * show them.
 *
 * **It cannot write.** There is no tool that changes anything — no stock
 * adjustment, no order, nothing that reaches Shopify or Unicommerce. A model
 * that can be talked into a mistake must not be able to act on one.
 *
 * **Everything it reads is untrusted.** Customer names, order notes, remarks
 * and Shopify tags are typed by people outside this company and could contain
 * text shaped like instructions. The system prompt says so, and tool output is
 * handed back as data.
 */

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the arguments, in the shape both providers accept. */
  parameters: Record<string, unknown>;
  /** The permission a caller needs. Null means anyone signed in. */
  permission: string | null;
}

const noArgs = { type: 'object', properties: {}, additionalProperties: false };

export const TOOLS: ToolDef[] = [
  {
    name: 'get_stock_alerts',
    description:
      'Raw materials at or below their reorder level, with how much is available and how much to order. Use for questions about shortages, what to buy, or what is out of stock.',
    parameters: noArgs,
    permission: 'inventory.read',
  },
  {
    name: 'get_production_status',
    description:
      'The production line stage by stage: units taken in, completed, rejected and outstanding rework. Figures are PER STAGE and must never be added together — a garment passes through every stage.',
    parameters: noArgs,
    permission: 'manufacturing.read',
  },
  {
    name: 'get_manufacturing_orders',
    description: 'Recent manufacturing orders with their status and quantities.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status filter, e.g. RELEASED, COMPLETED.' },
        limit: { type: 'number', description: 'How many to return, max 50.' },
      },
      additionalProperties: false,
    },
    permission: 'manufacturing.read',
  },
  {
    name: 'get_open_demand',
    description:
      'Manufacturing demand that is not yet satisfied: which SKU, how many, and where it came from. Use for "what do we owe" or "what needs making".',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many to return, max 100.' } },
      additionalProperties: false,
    },
    permission: 'demand.read',
  },
  {
    name: 'get_recent_orders',
    description: 'Imported sales orders with channel, value and how much is still owed.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Optional: ONLINE, POS or CUSTOM.' },
        limit: { type: 'number', description: 'How many to return, max 50.' },
      },
      additionalProperties: false,
    },
    permission: 'demand.read',
  },
  {
    name: 'get_material_consumption',
    description:
      'What production actually consumed per material, against the BOM standard frozen at release, with wastage. Use for consumption, wastage or variance questions.',
    parameters: noArgs,
    permission: 'reports.read',
  },
  {
    name: 'get_costing',
    description:
      'Planned against actual cost per manufacturing order, and cost per ACCEPTED unit. Restricted — only available to users who may view costing.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many orders, max 50.' } },
      additionalProperties: false,
    },
    permission: 'reports.view_costing',
  },
  {
    name: 'search_products',
    description: 'Find products and their sizes by style code, name or SKU.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Style code, product name or SKU fragment.' } },
      required: ['query'],
      additionalProperties: false,
    },
    permission: 'products.read',
  },
  {
    name: 'get_finished_stock',
    description: 'Finished garments on hand by SKU and location, and how much is awaiting external sync.',
    parameters: noArgs,
    permission: 'finished_goods.read',
  },
];

/** The tools this particular person is allowed to use. */
export function toolsFor(user: AuthenticatedUser): ToolDef[] {
  const held = new Set(user.permissions);
  return TOOLS.filter((t) => t.permission === null || held.has(t.permission));
}

@Injectable()
export class AssistantTools {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run one tool.
   *
   * Re-checks the permission here rather than trusting that the model was only
   * offered tools it may use. The model chooses the call; it does not get to
   * choose the authorisation.
   */
  async run(user: AuthenticatedUser, name: string, args: Record<string, unknown>): Promise<unknown> {
    const def = TOOLS.find((t) => t.name === name);
    if (!def) return { error: `No such tool: ${name}` };
    if (def.permission && !user.permissions.includes(def.permission)) {
      return { error: `Not permitted. This needs ${def.permission}, which you do not have.` };
    }

    const org = user.organizationId;
    const limit = (v: unknown, max: number, d: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : d;
    };

    switch (name) {
      case 'get_stock_alerts': {
        const rows = await this.prisma.rawMaterial.findMany({
          where: { organizationId: org, status: 'ACTIVE' },
          select: {
            materialCode: true, name: true, baseUom: true, minimumStock: true,
            reorderLevel: true, reorderQty: true, leadTimeDays: true,
            defaultSupplier: { select: { name: true } },
          },
          take: 200,
        });
        const balances = await this.prisma.materialBalance.groupBy({
          by: ['rawMaterialId'],
          where: { organizationId: org, location: { kind: 'PHYSICAL' } },
          _sum: { onHandQty: true },
        });
        const codes = await this.prisma.rawMaterial.findMany({
          where: { organizationId: org }, select: { id: true, materialCode: true },
        });
        const codeById = new Map(codes.map((c) => [c.id, c.materialCode]));
        const availBy = new Map(
          balances.map((b) => [codeById.get(b.rawMaterialId) ?? '', dec(b._sum?.onHandQty?.toFixed() ?? '0')]),
        );
        return rows
          .map((m) => {
            const avail = availBy.get(m.materialCode) ?? new Decimal(0);
            return {
              materialCode: m.materialCode, name: m.name, uom: m.baseUom,
              available: avail.toFixed(), reorderLevel: m.reorderLevel.toFixed(),
              suggestedOrderQty: m.reorderQty?.toFixed() ?? null,
              leadTimeDays: m.leadTimeDays,
              supplier: m.defaultSupplier?.name ?? null,
              level: avail.lessThanOrEqualTo(0) ? 'OUT_OF_STOCK'
                : avail.lessThan(dec(m.minimumStock.toFixed())) ? 'BELOW_MINIMUM'
                : avail.lessThanOrEqualTo(dec(m.reorderLevel.toFixed())) ? 'AT_REORDER_LEVEL' : 'OK',
            };
          })
          .filter((m) => m.level !== 'OK');
      }

      case 'get_production_status': {
        const stages = await this.prisma.productionStage.findMany({
          where: { organizationId: org, status: 'ACTIVE' },
          select: { id: true, name: true, sequenceHint: true },
          orderBy: { sequenceHint: 'asc' },
        });
        const rows = await this.prisma.productionStageTask.groupBy({
          by: ['productionStageId'],
          where: { organizationId: org },
          _sum: {
            receivedQty: true, completedQty: true, forwardedQty: true,
            rejectedQty: true, reworkSentQty: true, reworkReturnedQty: true,
          },
        });
        const by = new Map(rows.map((r) => [r.productionStageId, r._sum]));
        return {
          note: 'Figures are per stage and must not be summed: a garment passes through every stage.',
          stages: stages.map((s) => {
            const r = by.get(s.id);
            const received = dec(r?.receivedQty?.toFixed() ?? '0');
            const forwarded = dec(r?.forwardedQty?.toFixed() ?? '0');
            const rejected = dec(r?.rejectedQty?.toFixed() ?? '0');
            const reworkOpen = Decimal.max(
              dec(r?.reworkSentQty?.toFixed() ?? '0').minus(dec(r?.reworkReturnedQty?.toFixed() ?? '0')), 0,
            );
            return {
              stage: s.name,
              takenIn: received.toFixed(),
              completed: dec(r?.completedQty?.toFixed() ?? '0').toFixed(),
              onTheFloor: Decimal.max(received.minus(forwarded).minus(rejected).minus(reworkOpen), 0).toFixed(),
              rejected: rejected.toFixed(),
              reworkOutstanding: reworkOpen.toFixed(),
            };
          }).filter((s) => Number(s.takenIn) > 0),
        };
      }

      case 'get_manufacturing_orders': {
        const rows = await this.prisma.manufacturingOrder.findMany({
          where: {
            organizationId: org,
            ...(typeof args.status === 'string' ? { status: args.status as never } : {}),
          },
          select: {
            moNo: true, status: true, orderedQty: true, completedQty: true,
            rejectedQty: true, createdAt: true,
            product: { select: { name: true, styleCode: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: limit(args.limit, 50, 20),
        });
        return rows.map((o) => ({
          moNo: o.moNo, status: o.status,
          product: o.product?.name ?? null, styleCode: o.product?.styleCode ?? null,
          ordered: o.orderedQty.toFixed(), completed: o.completedQty.toFixed(),
          rejected: o.rejectedQty.toFixed(), createdAt: o.createdAt.toISOString().slice(0, 10),
        }));
      }

      case 'get_open_demand': {
        const rows = await this.prisma.manufacturingDemand.findMany({
          where: { organizationId: org, status: { notIn: ['CANCELLED', 'NOT_REQUIRED', 'FULLY_ALLOCATED'] } },
          select: {
            demandNo: true, channel: true, externalSku: true, status: true,
            manufacturingQty: true, allocatedQty: true, requiredByDate: true,
            productVariant: { select: { sku: true, size: true, product: { select: { name: true } } } },
          },
          orderBy: [{ requiredByDate: 'asc' }, { createdAt: 'desc' }],
          take: limit(args.limit, 100, 40),
        });
        return rows.map((d) => ({
          demandNo: d.demandNo, channel: d.channel, status: d.status,
          sku: d.productVariant?.sku ?? d.externalSku,
          product: d.productVariant?.product?.name ?? null,
          size: d.productVariant?.size ?? null,
          toMake: d.manufacturingQty.toFixed(),
          allocated: d.allocatedQty.toFixed(),
          neededBy: d.requiredByDate?.toISOString().slice(0, 10) ?? null,
          isMapped: d.productVariant !== null,
        }));
      }

      case 'get_recent_orders': {
        const rows = await this.prisma.shopifyOrder.findMany({
          where: {
            organizationId: org,
            ...(typeof args.channel === 'string' ? { channel: args.channel as never } : {}),
          },
          select: {
            orderName: true, orderNumber: true, channel: true, status: true,
            totalAmount: true, currency: true, orderedAt: true, posLocationName: true,
            lines: { select: { manufacturingQty: true } },
          },
          orderBy: { orderedAt: 'desc' },
          take: limit(args.limit, 50, 20),
        });
        return rows.map((o) => ({
          order: o.orderName ?? o.orderNumber,
          channel: o.channel, status: o.status,
          store: o.posLocationName,
          value: o.totalAmount?.toFixed() ?? null, currency: o.currency,
          stillOwed: o.lines.reduce<Decimal>((s, l) => s.plus(dec(l.manufacturingQty.toFixed())), new Decimal(0)).toFixed(),
          placedAt: o.orderedAt.toISOString().slice(0, 10),
        }));
      }

      case 'get_material_consumption': {
        const rows = await this.prisma.materialConsumption.groupBy({
          by: ['rawMaterialId'],
          where: { organizationId: org },
          _sum: { consumedBaseQty: true, wastageBaseQty: true, totalCost: true },
        });
        const mats = await this.prisma.rawMaterial.findMany({
          where: { organizationId: org, id: { in: rows.map((r) => r.rawMaterialId) } },
          select: { id: true, materialCode: true, name: true, baseUom: true },
        });
        const byId = new Map(mats.map((m) => [m.id, m]));
        return rows.map((r) => {
          const m = byId.get(r.rawMaterialId);
          const consumed = dec(r._sum?.consumedBaseQty?.toFixed() ?? '0');
          const wastage = dec(r._sum?.wastageBaseQty?.toFixed() ?? '0');
          return {
            materialCode: m?.materialCode ?? '-', name: m?.name ?? '-', uom: m?.baseUom ?? null,
            consumed: consumed.toFixed(), wastage: wastage.toFixed(),
            wastagePct: consumed.greaterThan(0) ? wastage.dividedBy(consumed).times(100).toFixed(2) : null,
            valueConsumed: dec(r._sum?.totalCost?.toFixed() ?? '0').toFixed(),
          };
        });
      }

      case 'get_costing': {
        const orders = await this.prisma.manufacturingOrder.findMany({
          where: { organizationId: org, status: { notIn: ['DRAFT', 'CANCELLED'] } },
          select: { id: true, moNo: true, status: true, completedQty: true },
          orderBy: { createdAt: 'desc' },
          take: limit(args.limit, 50, 15),
        });
        if (orders.length === 0) return [];
        const ids = orders.map((o) => o.id);
        const [planned, actual] = await Promise.all([
          this.prisma.moBomSnapshotLine.findMany({
            where: { manufacturingOrderId: { in: ids } },
            select: { manufacturingOrderId: true, plannedQty: true, unitCost: true },
          }),
          this.prisma.materialConsumption.groupBy({
            by: ['manufacturingOrderId'],
            where: { organizationId: org, manufacturingOrderId: { in: ids } },
            _sum: { totalCost: true },
          }),
        ]);
        const plannedBy = new Map<string, Decimal>();
        for (const l of planned) {
          const v = dec(l.plannedQty.toFixed()).times(dec(l.unitCost.toFixed()));
          plannedBy.set(l.manufacturingOrderId, (plannedBy.get(l.manufacturingOrderId) ?? new Decimal(0)).plus(v));
        }
        const actualBy = new Map(actual.map((a) => [a.manufacturingOrderId, dec(a._sum?.totalCost?.toFixed() ?? '0')]));
        return orders.map((o) => {
          const p = plannedBy.get(o.id) ?? new Decimal(0);
          const a = actualBy.get(o.id) ?? new Decimal(0);
          const accepted = dec(o.completedQty.toFixed());
          return {
            moNo: o.moNo, status: o.status,
            plannedMaterialCost: p.toFixed(2), actualMaterialCost: a.toFixed(2),
            variance: a.minus(p).toFixed(2),
            acceptedUnits: accepted.toFixed(),
            costPerAcceptedUnit: accepted.greaterThan(0) ? a.dividedBy(accepted).toFixed(2) : null,
            note: 'Material cost only. Labour and overhead are not captured per order.',
          };
        });
      }

      case 'search_products': {
        const q = String(args.query ?? '').trim();
        if (!q) return { error: 'A search term is required.' };
        const rows = await this.prisma.product.findMany({
          where: {
            organizationId: org,
            OR: [
              { styleCode: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } },
            ],
          },
          select: {
            styleCode: true, name: true, category: true, status: true,
            variants: { select: { sku: true, size: true, color: true }, take: 20 },
          },
          take: 15,
        });
        return rows.map((p) => ({
          styleCode: p.styleCode, name: p.name, category: p.category, status: p.status,
          sizes: p.variants.map((v) => ({ sku: v.sku, size: v.size, colour: v.color })),
        }));
      }

      case 'get_finished_stock': {
        const rows = await this.prisma.finishedGoodsBalance.findMany({
          where: { organizationId: org, onHandQty: { gt: 0 } },
          select: {
            onHandQty: true, pendingSyncQty: true,
            productVariant: { select: { sku: true, size: true, product: { select: { name: true } } } },
            location: { select: { code: true } },
          },
          orderBy: { onHandQty: 'desc' },
          take: 100,
        });
        return rows.map((b) => ({
          sku: b.productVariant.sku, size: b.productVariant.size,
          product: b.productVariant.product?.name ?? null,
          location: b.location.code,
          onHand: b.onHandQty.toFixed(),
          awaitingExternalSync: b.pendingSyncQty.toFixed(),
        }));
      }

      default:
        return { error: `Tool ${name} is defined but not implemented.` };
    }
  }
}
