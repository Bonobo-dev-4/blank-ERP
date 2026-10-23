/**
 * The application navigation map.
 *
 * Every screen carries an explicit `phase` and `status`. The specification is
 * emphatic that there must be no dummy buttons: a screen that is not built yet
 * is marked PLANNED and renders as a disabled item with the phase it belongs
 * to, rather than a link to an empty page. That keeps the sidebar honest about
 * what the system can actually do today.
 */

export type BuildStatus = 'BUILT' | 'PARTIAL' | 'PLANNED';

export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: string;
  /** Permission required to see the item at all. */
  readonly permission?: string;
  readonly status: BuildStatus;
  /** Implementation phase from the roadmap. */
  readonly phase: 1 | 2 | 3 | 4 | 5 | 6;
  readonly description?: string;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAVIGATION: readonly NavGroup[] = [
  {
    label: '',
    items: [
      {
        label: 'Dashboard', href: '/', icon: 'LayoutDashboard',
        status: 'PARTIAL', phase: 1,
        description: 'Live operational figures for the modules that are built',
      },
    ],
  },
  {
    label: 'Orders & Demand',
    items: [
      { label: 'All Orders', href: '/orders', icon: 'ShoppingCart', permission: 'demand.read', status: 'PLANNED', phase: 4 },
      { label: 'Shopify Orders', href: '/orders/shopify', icon: 'Store', permission: 'demand.read', status: 'PLANNED', phase: 4 },
      { label: 'POS Orders', href: '/orders/pos', icon: 'Receipt', permission: 'demand.read', status: 'PLANNED', phase: 4 },
      { label: 'Unicommerce Bulk POs', href: '/orders/bulk-po', icon: 'FileStack', permission: 'demand.read', status: 'PLANNED', phase: 4 },
      { label: 'Stock Availability', href: '/orders/availability', icon: 'PackageSearch', permission: 'demand.read', status: 'PLANNED', phase: 4 },
      { label: 'Manufacturing Demand', href: '/demand', icon: 'ListChecks', permission: 'demand.read', status: 'PLANNED', phase: 4 },
      { label: 'Demand Forecast', href: '/demand/forecast', icon: 'TrendingUp', permission: 'reports.read', status: 'PLANNED', phase: 6 },
    ],
  },
  {
    label: 'Raw Materials',
    items: [
      { label: 'Raw Material Master', href: '/materials', icon: 'Boxes', permission: 'materials.read', status: 'BUILT', phase: 1 },
      { label: 'Fabric Rolls', href: '/materials/rolls', icon: 'Scroll', permission: 'inventory.read', status: 'BUILT', phase: 1 },
      { label: 'Material Lots', href: '/materials/lots', icon: 'Layers', permission: 'inventory.read', status: 'BUILT', phase: 1 },
      { label: 'Raw Material Stock', href: '/inventory/stock', icon: 'Warehouse', permission: 'inventory.read', status: 'BUILT', phase: 1 },
      { label: 'Material Movements', href: '/inventory/movements', icon: 'ArrowLeftRight', permission: 'inventory.read', status: 'BUILT', phase: 1 },
      { label: 'Stock Adjustments', href: '/inventory/adjustments', icon: 'SlidersHorizontal', permission: 'inventory.adjust', status: 'BUILT', phase: 1 },
      { label: 'Stock Audits', href: '/inventory/audits', icon: 'ClipboardCheck', permission: 'inventory.count', status: 'PLANNED', phase: 6 },
    ],
  },
  {
    label: 'Purchasing',
    items: [
      { label: 'Purchase Requests', href: '/purchasing/requisitions', icon: 'FileText', permission: 'purchasing.read', status: 'BUILT', phase: 1 },
      { label: 'Purchase Orders', href: '/purchasing/orders', icon: 'FileCheck2', permission: 'purchasing.read', status: 'BUILT', phase: 1 },
      { label: 'Goods Receipts', href: '/purchasing/receipts', icon: 'PackageCheck', permission: 'purchasing.read', status: 'BUILT', phase: 1 },
      { label: 'Vendor Management', href: '/purchasing/suppliers', icon: 'Truck', permission: 'purchasing.read', status: 'BUILT', phase: 1 },
      { label: 'Purchase Approvals', href: '/purchasing/approvals', icon: 'BadgeCheck', permission: 'purchasing.approve_po', status: 'BUILT', phase: 1 },
    ],
  },
  {
    label: 'BOM & MRP',
    items: [
      { label: 'BOM Master', href: '/bom', icon: 'Network', permission: 'bom.read', status: 'BUILT', phase: 2 },
      { label: 'BOM Builder', href: '/bom/builder', icon: 'Wrench', permission: 'bom.write', status: 'BUILT', phase: 2 },
      { label: 'BOM Versions', href: '/bom/versions', icon: 'GitBranch', permission: 'bom.read', status: 'BUILT', phase: 2 },
      { label: 'Material Requirements', href: '/mrp', icon: 'Calculator', permission: 'mrp.run', status: 'BUILT', phase: 2 },
      { label: 'Material Shortages', href: '/mrp/shortages', icon: 'TriangleAlert', permission: 'mrp.run', status: 'BUILT', phase: 2 },
      { label: 'Purchase Suggestions', href: '/mrp/suggestions', icon: 'Lightbulb', permission: 'purchasing.write_requisition', status: 'BUILT', phase: 2 },
      { label: 'Material Allocation', href: '/mrp/allocation', icon: 'Lock', permission: 'mrp.reserve', status: 'PARTIAL', phase: 2,
        description: 'Reserving and viewing reservations works on each manufacturing order; the cross-order allocation view is outstanding' },
    ],
  },
  {
    label: 'Production',
    items: [
      { label: 'Manufacturing Orders', href: '/manufacturing', icon: 'Factory', permission: 'manufacturing.read', status: 'BUILT', phase: 2 },
      { label: 'Production Planning', href: '/manufacturing/planning', icon: 'CalendarRange', permission: 'manufacturing.write', status: 'PLANNED', phase: 2,
        description: 'Calendar, capacity and the priority queue; the order list already filters by priority and due date' },
      { label: 'Cutting', href: '/production/cutting', icon: 'Scissors', permission: 'production.record_stage', status: 'BUILT', phase: 3 },
      { label: 'Embroidery', href: '/production/embroidery', icon: 'Sparkles', permission: 'production.record_stage', status: 'BUILT', phase: 3 },
      { label: 'Stitching', href: '/production/stitching', icon: 'Shirt', permission: 'production.record_stage', status: 'BUILT', phase: 3 },
      { label: 'Washing / Processing', href: '/production/washing', icon: 'Droplets', permission: 'production.record_stage', status: 'BUILT', phase: 3 },
      { label: 'Finishing', href: '/production/finishing', icon: 'Wand2', permission: 'production.record_stage', status: 'BUILT', phase: 3 },
      { label: 'Quality Control', href: '/quality', icon: 'ShieldCheck', permission: 'quality.read', status: 'PLANNED', phase: 3,
        description: 'QC verdicts and defect codes are tested in the domain; the inspection screens and checklists are outstanding' },
      { label: 'Rework', href: '/quality/rework', icon: 'RefreshCw', permission: 'quality.manage_rework', status: 'PLANNED', phase: 3,
        description: 'Sending to and returning from rework works on each stage queue; rework tickets and reinspection are outstanding' },
      { label: 'Production Handover', href: '/production/handover', icon: 'ArrowRightLeft', permission: 'production.record_stage', status: 'PLANNED', phase: 3,
        description: 'Handing work between stages is on each stage queue and the scan station; the job-work handover document is outstanding' },
    ],
  },
  {
    label: 'Barcode Operations',
    items: [
      { label: 'Scan Station', href: '/scan', icon: 'ScanLine', permission: 'production.scan', status: 'BUILT', phase: 3 },
      { label: 'Barcode Printing', href: '/barcodes/print', icon: 'Printer', permission: 'production.print_labels', status: 'BUILT', phase: 1,
        description: 'Code 128 and QR labels for material lots, fabric rolls and receipts' },
      { label: 'Scan History', href: '/barcodes/history', icon: 'History', permission: 'production.scan', status: 'BUILT', phase: 3 },
      { label: 'Batch Tracking', href: '/barcodes/batches', icon: 'Package2', permission: 'manufacturing.read', status: 'BUILT', phase: 3 },
      { label: 'Unit Tracking', href: '/barcodes/units', icon: 'Tag', permission: 'manufacturing.read', status: 'PLANNED', phase: 3,
        description: 'Batches are tracked today; per-garment serialisation is modelled and tested but has no screen' },
    ],
  },
  {
    label: 'Finished Goods',
    items: [
      { label: 'Finished Stock', href: '/finished-goods', icon: 'PackageOpen', permission: 'finished_goods.read', status: 'PLANNED', phase: 5 },
      { label: 'Finished Goods Inward', href: '/finished-goods/inward', icon: 'Import', permission: 'finished_goods.inward', status: 'PLANNED', phase: 5 },
      { label: 'GRN Management', href: '/finished-goods/grn', icon: 'FileSpreadsheet', permission: 'finished_goods.read', status: 'PLANNED', phase: 5 },
      { label: 'Unicommerce Inventory Push', href: '/sync/push', icon: 'CloudUpload', permission: 'sync.read', status: 'PLANNED', phase: 5 },
      { label: 'External Reconciliation', href: '/sync/reconciliation', icon: 'Scale', permission: 'sync.reconcile', status: 'PLANNED', phase: 5 },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { label: 'Inventory Alerts', href: '/intelligence/alerts', icon: 'Bell', permission: 'inventory.read', status: 'BUILT', phase: 1,
        description: 'Live low-stock, minimum-stock and reorder-point alerts from the ledger' },
      { label: 'Replenishment', href: '/intelligence/replenishment', icon: 'Repeat', permission: 'reports.read', status: 'PLANNED', phase: 6 },
      { label: 'Forecasting', href: '/intelligence/forecasting', icon: 'LineChart', permission: 'reports.read', status: 'PLANNED', phase: 6 },
      { label: 'Production Reports', href: '/reports/production', icon: 'BarChart3', permission: 'reports.read', status: 'PLANNED', phase: 6 },
      { label: 'Material Consumption', href: '/reports/consumption', icon: 'PieChart', permission: 'reports.read', status: 'PLANNED', phase: 6 },
      { label: 'Production Costing', href: '/reports/costing', icon: 'IndianRupee', permission: 'reports.view_costing', status: 'PLANNED', phase: 6 },
      { label: 'Job Worker Performance', href: '/reports/job-workers', icon: 'Users', permission: 'reports.read', status: 'PLANNED', phase: 6 },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Product Master', href: '/admin/products', icon: 'Shirt', permission: 'products.read', status: 'BUILT', phase: 1,
        description: 'Styles, the colour x size SKU matrix and bundles' },
      { label: 'SKU Mappings', href: '/admin/mappings', icon: 'Link2', permission: 'products.read', status: 'BUILT', phase: 1,
        description: 'Shopify and Unicommerce identifiers, and the gaps that would block a sync' },
      { label: 'Users', href: '/admin/users', icon: 'UserCog', permission: 'admin.manage_users', status: 'BUILT', phase: 1 },
      { label: 'Roles', href: '/admin/roles', icon: 'KeyRound', permission: 'admin.manage_roles', status: 'BUILT', phase: 1 },
      { label: 'Locations', href: '/admin/locations', icon: 'MapPin', permission: 'admin.manage_locations', status: 'BUILT', phase: 1 },
      { label: 'Production Routes', href: '/admin/routes', icon: 'Route', permission: 'admin.manage_routes', status: 'PLANNED', phase: 3,
        description: 'Routes and stages are readable through the API and seeded; editing them in the app is outstanding' },
      { label: 'Approvals', href: '/admin/approvals', icon: 'Stamp', permission: 'admin.manage_approvals', status: 'PLANNED', phase: 6 },
      { label: 'Integrations', href: '/admin/integrations', icon: 'Plug', permission: 'admin.manage_integrations', status: 'PARTIAL', phase: 4,
        description: 'Connection status and contracts; live connectors land in phase 4' },
      { label: 'Settings', href: '/admin/settings', icon: 'Settings', permission: 'admin.manage_settings', status: 'BUILT', phase: 1 },
      { label: 'Audit Logs', href: '/admin/audit', icon: 'ScrollText', permission: 'admin.view_audit_log', status: 'BUILT', phase: 1 },
    ],
  },
];

/**
 * Phases whose screens are actually built.
 *
 * Kept as data rather than hardcoded in a test, so that marking a phase
 * delivered is one edit in one place and the consistency tests follow.
 */
export const DELIVERED_PHASES = [1, 2, 3] as const;

/** Flat list of every navigable screen. */
export const ALL_NAV_ITEMS: readonly NavItem[] = NAVIGATION.flatMap((g) => g.items);

export function navItemFor(href: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.href === href);
}

export const BUILD_STATUS_SUMMARY = {
  built: ALL_NAV_ITEMS.filter((i) => i.status === 'BUILT').length,
  partial: ALL_NAV_ITEMS.filter((i) => i.status === 'PARTIAL').length,
  planned: ALL_NAV_ITEMS.filter((i) => i.status === 'PLANNED').length,
  total: ALL_NAV_ITEMS.length,
} as const;
