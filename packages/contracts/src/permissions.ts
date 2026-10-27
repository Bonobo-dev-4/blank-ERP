/**
 * The permission catalogue and the role matrix.
 *
 * Permissions are "module.action" strings. The `elevated` flag marks the ones
 * that create or destroy value - stock adjustments, BOM approval, external
 * inventory pushes - which the API additionally audits and, where configured,
 * routes through the approval matrix.
 */
export interface PermissionDef {
  readonly code: string;
  readonly module: string;
  readonly action: string;
  readonly description: string;
  readonly elevated?: boolean;
}

const p = (
  code: string,
  description: string,
  elevated = false,
): PermissionDef => {
  const [module = '', action = ''] = code.split('.');
  return { code, module, action, description, elevated };
};

export const PERMISSIONS: readonly PermissionDef[] = [
  // --- administration ------------------------------------------------------
  p('admin.manage_users', 'Create and edit users, assign roles', true),
  p('admin.manage_roles', 'Define roles and their permissions', true),
  p('admin.manage_settings', 'Change organisation settings', true),
  p('admin.manage_integrations', 'Configure Shopify and Unicommerce connections', true),
  p('admin.view_audit_log', 'Read the audit log'),
  p('admin.manage_locations', 'Create and edit stock locations'),
  p('admin.manage_routes', 'Define production stages and routes'),
  p('admin.manage_approvals', 'Configure the approval matrix', true),

  // --- product master ------------------------------------------------------
  p('products.read', 'View products and variants'),
  p('products.write', 'Create and edit products and variants'),
  p('products.manage_mappings', 'Map SKUs to external systems'),
  p('products.import', 'Bulk import products'),

  // --- raw material master -------------------------------------------------
  p('materials.read', 'View raw materials'),
  p('materials.write', 'Create and edit raw materials'),
  p('materials.manage_uom', 'Configure unit conversions', true),

  // --- inventory -----------------------------------------------------------
  p('inventory.read', 'View stock balances and movements'),
  p('inventory.issue', 'Issue material to production or a job worker'),
  p('inventory.return', 'Return material from production'),
  p('inventory.transfer', 'Transfer material between locations'),
  p('inventory.consume', 'Post material consumption'),
  p('inventory.adjust', 'Adjust stock without a source document', true),
  p('inventory.count', 'Record and post stock counts', true),
  p('inventory.manage_rolls', 'Create, issue and return fabric rolls'),

  // --- purchasing ----------------------------------------------------------
  p('purchasing.read', 'View requisitions, purchase orders and receipts'),
  p('purchasing.write_requisition', 'Raise purchase requisitions'),
  p('purchasing.approve_requisition', 'Approve purchase requisitions', true),
  p('purchasing.write_po', 'Create and edit purchase orders'),
  p('purchasing.approve_po', 'Approve purchase orders', true),
  p('purchasing.close_po', 'Close a purchase order short', true),
  p('purchasing.receive', 'Record goods receipts'),
  p('purchasing.inspect', 'Record incoming material inspection'),
  p('purchasing.manage_suppliers', 'Create and edit suppliers'),

  // --- BOM and MRP ---------------------------------------------------------
  p('bom.read', 'View bills of materials'),
  p('bom.write', 'Create and edit BOM drafts'),
  p('bom.approve', 'Approve a BOM version for production', true),
  p('mrp.run', 'Run material requirement planning'),
  p('mrp.reserve', 'Reserve material for a manufacturing order'),

  // --- demand --------------------------------------------------------------
  p('demand.read', 'View imported orders and manufacturing demand'),
  p('demand.import', 'Trigger an order import'),
  p('demand.view_customer', "See a customer's contact details and addresses on orders"),
  p('demand.approve', 'Approve demand for manufacturing', true),
  p('demand.switch_facility', "Move an order item to another Unicommerce fulfilment facility", true),

  // --- manufacturing -------------------------------------------------------
  p('manufacturing.read', 'View manufacturing orders'),
  p('manufacturing.write', 'Create and edit manufacturing orders'),
  p('manufacturing.release', 'Release a manufacturing order to the floor', true),
  p('manufacturing.release_with_shortage', 'Release despite a material shortage', true),
  p('manufacturing.cancel', 'Cancel a manufacturing order', true),
  p('manufacturing.split', 'Split and consolidate batches'),

  // --- shop floor ----------------------------------------------------------
  p('production.scan', 'Record barcode scans at a production stage'),
  p('production.record_stage', 'Record stage completion quantities'),
  p('production.override_stage', 'Advance a stage without a valid scan', true),
  p('production.print_labels', 'Print barcode labels'),
  p('production.assign', 'Assign work to operators and job workers'),

  // --- quality -------------------------------------------------------------
  p('quality.read', 'View inspections and defects'),
  p('quality.inspect', 'Record a quality inspection'),
  p('quality.approve_final', 'Give final QC approval', true),
  p('quality.manage_rework', 'Raise and complete rework orders'),

  // --- finished goods ------------------------------------------------------
  p('finished_goods.read', 'View finished goods stock'),
  p('finished_goods.inward', 'Record finished goods inward'),
  p('finished_goods.adjust', 'Adjust finished goods stock', true),

  // --- external sync -------------------------------------------------------
  p('sync.read', 'View push jobs and sync logs'),
  p('sync.preview', 'Preview an inventory push'),
  p('sync.push', 'Submit an inventory push to Unicommerce', true),
  p('sync.change_facility', 'Change the destination facility of a push', true),
  p('sync.reconcile', 'Reconcile external inventory', true),

  // --- job workers ---------------------------------------------------------
  p('job_workers.read', 'View job workers and their work orders'),
  p('job_workers.write', 'Create and edit job workers'),
  p('job_workers.manage_orders', 'Issue and receive job work'),

  // --- reporting -----------------------------------------------------------
  p('reports.read', 'View production reports'),
  p('reports.view_costing', 'View costing and margin data'),
  p('reports.export', 'Export report data'),
];

export const PERMISSION_CODES = PERMISSIONS.map((x) => x.code);
export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const ROLE_CODES = [
  'SUPER_ADMIN',
  'PRODUCTION_HEAD',
  'PRODUCTION_PLANNER',
  'PURCHASE_MANAGER',
  'RAW_MATERIAL_MANAGER',
  'WAREHOUSE_EXECUTIVE',
  'CUTTING_SUPERVISOR',
  'STITCHING_SUPERVISOR',
  'EMBROIDERY_SUPERVISOR',
  'FINISHING_SUPERVISOR',
  'QC_EXECUTIVE',
  'BARCODE_OPERATOR',
  'JOB_WORKER_COORDINATOR',
  'FINANCE_VIEWER',
  'MANAGEMENT_VIEWER',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

const READ_ONLY_CORE = [
  'products.read', 'materials.read', 'inventory.read', 'bom.read',
  'manufacturing.read', 'quality.read', 'finished_goods.read', 'reports.read',
];

const SUPERVISOR_BASE = [
  'manufacturing.read', 'production.scan', 'production.record_stage',
  'production.print_labels', 'production.assign', 'inventory.read',
  'materials.read', 'products.read', 'bom.read', 'reports.read',
];

/**
 * The role matrix.
 *
 * A barcode operator deliberately gets a very narrow grant: scan, record stage
 * quantities, and look things up. No adjustments, no approvals, no pushes. The
 * terminal on a stitching floor is the least physically secure device in the
 * building, so it holds the least authority.
 */
export const ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly string[]>> = {
  SUPER_ADMIN: PERMISSION_CODES,

  PRODUCTION_HEAD: [
    ...READ_ONLY_CORE, 'demand.read', 'demand.view_customer', 'demand.approve', 'demand.switch_facility',
    'manufacturing.write',
    'manufacturing.release', 'manufacturing.release_with_shortage', 'manufacturing.cancel',
    'manufacturing.split', 'mrp.run', 'mrp.reserve', 'production.assign',
    'production.override_stage', 'production.print_labels', 'quality.approve_final',
    'quality.manage_rework', 'finished_goods.inward', 'sync.read', 'sync.preview',
    'job_workers.read', 'job_workers.manage_orders', 'reports.view_costing', 'reports.export',
    'admin.manage_routes', 'admin.view_audit_log', 'bom.approve',
  ],

  PRODUCTION_PLANNER: [
    ...READ_ONLY_CORE, 'demand.read', 'demand.import', 'bom.write', 'mrp.run', 'mrp.reserve',
    'manufacturing.write', 'manufacturing.split', 'production.assign', 'production.print_labels',
    'purchasing.read', 'purchasing.write_requisition', 'job_workers.read', 'reports.export',
  ],

  PURCHASE_MANAGER: [
    'materials.read', 'inventory.read', 'products.read', 'bom.read', 'reports.read',
    'purchasing.read', 'purchasing.write_requisition', 'purchasing.approve_requisition',
    'purchasing.write_po', 'purchasing.approve_po', 'purchasing.close_po',
    'purchasing.manage_suppliers', 'reports.view_costing', 'reports.export',
  ],

  RAW_MATERIAL_MANAGER: [
    'materials.read', 'materials.write', 'materials.manage_uom', 'inventory.read',
    'inventory.issue', 'inventory.return', 'inventory.transfer', 'inventory.adjust',
    'inventory.count', 'inventory.manage_rolls', 'purchasing.read', 'purchasing.receive',
    'purchasing.inspect', 'purchasing.write_requisition', 'products.read', 'bom.read',
    'reports.read', 'reports.export', 'admin.manage_locations',
  ],

  WAREHOUSE_EXECUTIVE: [
    'materials.read', 'inventory.read', 'inventory.issue', 'inventory.return',
    'inventory.transfer', 'inventory.manage_rolls', 'purchasing.read', 'purchasing.receive',
    'products.read', 'finished_goods.read', 'finished_goods.inward', 'reports.read',
    'production.print_labels',
  ],

  CUTTING_SUPERVISOR: [...SUPERVISOR_BASE, 'inventory.issue', 'inventory.return', 'inventory.consume', 'inventory.manage_rolls'],
  STITCHING_SUPERVISOR: [...SUPERVISOR_BASE, 'job_workers.read', 'job_workers.manage_orders'],
  EMBROIDERY_SUPERVISOR: [...SUPERVISOR_BASE, 'job_workers.read', 'job_workers.manage_orders'],
  FINISHING_SUPERVISOR: [...SUPERVISOR_BASE, 'finished_goods.read'],

  QC_EXECUTIVE: [
    'manufacturing.read', 'quality.read', 'quality.inspect', 'quality.manage_rework',
    'quality.approve_final', 'production.scan', 'products.read', 'inventory.read',
    'purchasing.read', 'purchasing.inspect', 'reports.read', 'finished_goods.read',
  ],

  // Intentionally minimal: the shop-floor terminal holds the least authority.
  BARCODE_OPERATOR: [
    'production.scan', 'production.record_stage', 'manufacturing.read', 'products.read',
  ],

  JOB_WORKER_COORDINATOR: [
    'job_workers.read', 'job_workers.write', 'job_workers.manage_orders',
    'manufacturing.read', 'inventory.read', 'inventory.issue', 'inventory.return',
    'products.read', 'reports.read', 'production.print_labels',
  ],

  FINANCE_VIEWER: [...READ_ONLY_CORE, 'purchasing.read', 'reports.view_costing', 'reports.export', 'sync.read'],

  MANAGEMENT_VIEWER: [...READ_ONLY_CORE, 'purchasing.read', 'demand.read', 'demand.view_customer', 'sync.read', 'job_workers.read', 'reports.view_costing', 'reports.export'],
};

export const ROLE_LABELS: Readonly<Record<RoleCode, string>> = {
  SUPER_ADMIN: 'Super Admin',
  PRODUCTION_HEAD: 'Production Head',
  PRODUCTION_PLANNER: 'Production Planner',
  PURCHASE_MANAGER: 'Purchase Manager',
  RAW_MATERIAL_MANAGER: 'Raw Material Manager',
  WAREHOUSE_EXECUTIVE: 'Warehouse Executive',
  CUTTING_SUPERVISOR: 'Cutting Supervisor',
  STITCHING_SUPERVISOR: 'Stitching Supervisor',
  EMBROIDERY_SUPERVISOR: 'Embroidery Supervisor',
  FINISHING_SUPERVISOR: 'Finishing Supervisor',
  QC_EXECUTIVE: 'QC Executive',
  BARCODE_OPERATOR: 'Barcode Operator',
  JOB_WORKER_COORDINATOR: 'Job Worker Coordinator',
  FINANCE_VIEWER: 'Finance Viewer',
  MANAGEMENT_VIEWER: 'Management Viewer',
};

/** Every permission a set of roles grants, de-duplicated. */
export function permissionsForRoles(roles: readonly RoleCode[]): string[] {
  const set = new Set<string>();
  for (const r of roles) for (const c of ROLE_PERMISSIONS[r] ?? []) set.add(c);
  return [...set].sort();
}
