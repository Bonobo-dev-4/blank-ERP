import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@dnd/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface AttentionItem {
  kind: string;
  title: string;
  detail: string;
  href: string;
  count: number;
  severity: 'critical' | 'attention';
}

/**
 * The bell.
 *
 * Not a stored notification stream — a live reading of what needs a human
 * right now, derived on request the same way every other figure here is.
 * The schema's Notification table is deliberately unused: a stored stream
 * needs something to write it, something to expire it, and read-state per
 * user, and until there are events that cannot be derived (a push failing at
 * 2am), storing what can be computed would just be a second copy that drifts.
 *
 * Every item is permission-gated: the bell shows a person only the problems
 * they are allowed to go and fix. An approver sees approvals; a store
 * operator does not see costing-adjacent anything.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async attention(user: AuthenticatedUser): Promise<{ items: AttentionItem[]; total: number }> {
    const org = user.organizationId;
    const can = (p: string) => user.permissions.includes(p);
    const items: AttentionItem[] = [];

    const [outOfStock, approvalsPo, approvalsReq, approvalsBom, inspections, needsMapping, awaitingSync, needsCheckable] =
      await Promise.all([
        can('inventory.read')
          ? this.prisma.rawMaterial.count({
              where: {
                organizationId: org, status: 'ACTIVE',
                balances: { none: { onHandQty: { gt: 0 }, location: { kind: 'PHYSICAL' } } },
              },
            })
          : 0,
        can('purchasing.approve_po')
          ? this.prisma.rawMaterialPurchaseOrder.count({ where: { organizationId: org, status: 'PENDING_APPROVAL' } })
          : 0,
        can('purchasing.approve_requisition')
          ? this.prisma.purchaseRequisition.count({ where: { organizationId: org, status: 'PENDING_APPROVAL' } })
          : 0,
        can('bom.approve')
          ? this.prisma.bomVersion.count({ where: { organizationId: org, status: 'PENDING_APPROVAL' } })
          : 0,
        can('purchasing.inspect')
          ? this.prisma.rawMaterialReceipt.count({ where: { organizationId: org, status: 'PENDING_INSPECTION' } })
          : 0,
        can('demand.read')
          ? this.prisma.manufacturingDemand.count({ where: { organizationId: org, status: 'NEEDS_MAPPING' } })
          : 0,
        can('sync.read')
          ? this.prisma.finishedGoodsInward.count({
              where: { organizationId: org, status: 'POSTED', syncStatus: 'SYNC_PENDING' },
            })
          : 0,
        can('demand.read')
          ? this.prisma.manufacturingDemand.count({
              where: { organizationId: org, status: { notIn: ['CANCELLED', 'NOT_REQUIRED', 'FULLY_ALLOCATED'] } },
            })
          : 0,
      ]);

    // Facility switches a person has to finish: an outcome Unicommerce has not
    // confirmed, or production to review after a confirmed one.
    if (can('demand.switch_facility')) {
      const [pending, review] = await Promise.all([
        this.prisma.facilitySwitchOperation.count({ where: { organizationId: org, status: 'VERIFICATION_PENDING' } }),
        this.prisma.facilitySwitchOperation.count({ where: { organizationId: org, status: 'RECONCILIATION_REQUIRED' } }),
      ]);
      if (pending > 0) {
        items.push({
          kind: 'SWITCH_UNVERIFIED', count: pending, severity: 'critical',
          title: `${pending} facility ${pending === 1 ? 'switch needs' : 'switches need'} verification`,
          detail: 'Unicommerce did not confirm the outcome. Check status before switching the item again.',
          href: '/orders/facility-switches?open=true',
        });
      }
      if (review > 0) {
        items.push({
          kind: 'SWITCH_PRODUCTION_REVIEW', count: review, severity: 'attention',
          title: `${review} switched ${review === 1 ? 'item needs' : 'items need'} a production review`,
          detail: 'The item moved facility while manufacturing demand for it is still live.',
          href: '/orders/facility-switches?open=true',
        });
      }
    }

    if (outOfStock > 0) {
      items.push({
        kind: 'OUT_OF_STOCK', count: outOfStock, severity: 'critical',
        title: `${outOfStock} materials out of stock`,
        detail: 'Active materials with nothing available in any physical location.',
        href: '/intelligence/alerts',
      });
    }
    const approvals = approvalsPo + approvalsReq + approvalsBom;
    if (approvals > 0) {
      items.push({
        kind: 'APPROVALS', count: approvals, severity: 'attention',
        title: `${approvals} waiting on your approval`,
        detail: 'Purchase orders, requisitions and BOM versions blocked until someone decides.',
        href: '/admin/approvals',
      });
    }
    if (inspections > 0) {
      items.push({
        kind: 'INSPECTION', count: inspections, severity: 'attention',
        title: `${inspections} receipts pending inspection`,
        detail: 'Received but unusable until inspected.',
        href: '/purchasing/receipts?status=PENDING_INSPECTION',
      });
    }
    if (needsMapping > 0) {
      items.push({
        kind: 'NEEDS_MAPPING', count: needsMapping, severity: 'attention',
        title: `${needsMapping} demand lines have no product`,
        detail: 'Their SKUs match nothing in the catalogue, so this demand cannot reach manufacturing.',
        href: '/demand?status=NEEDS_MAPPING',
      });
    }
    if (awaitingSync > 0) {
      items.push({
        kind: 'SYNC_PENDING', count: awaitingSync, severity: 'attention',
        title: `${awaitingSync} receipts awaiting external sync`,
        detail: 'Finished goods not yet reflected in Unicommerce.',
        href: '/sync/push',
      });
    }
    if (needsCheckable > 0 && items.length === 0) {
      // Only shown when nothing is wrong: open demand is normal operation,
      // not an alert, and a bell that always has a number stops being read.
      items.push({
        kind: 'OPEN_DEMAND', count: needsCheckable, severity: 'attention',
        title: `${needsCheckable} open demand lines`,
        detail: 'Waiting to be dispatched, switched or manufactured.',
        href: '/orders/fulfilment',
      });
    }

    return {
      items,
      total: items.filter((i) => i.kind !== 'OPEN_DEMAND').reduce((n, i) => n + i.count, 0),
    };
  }
}
