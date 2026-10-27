/**
 * Seed: CONFIGURATION ONLY.
 *
 * The organisation, permission catalogue, roles, the administrator, stock
 * locations, production stages and routes, unit conversions, alert and
 * approval rules, and the (disabled, read-only) integration connections.
 *
 * No sample data of any kind: no suppliers, raw materials or products, no
 * stock and no transactions. Sample records appear in every list and every
 * figure as if they were real. Suppliers and materials are entered through
 * the application; products are imported from Shopify.
 *
 * The script is idempotent: run it as often as you like.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import {
  PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, ROLE_CODES, type RoleCode,
} from '@dnd/contracts';
import { SYSTEM_LOCATION_SPECS } from '@dnd/domain';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const orgCode = process.env.SEED_ORG_CODE ?? 'DND';
  const orgName = process.env.SEED_ORG_NAME ?? 'Dash and Dot';

  console.log(`\nSeeding master data for ${orgName} (${orgCode})\n`);

  // -------------------------------------------------------------------------
  // organisation
  // -------------------------------------------------------------------------
  const org = await prisma.organization.upsert({
    where: { code: orgCode },
    update: { name: orgName },
    create: { code: orgCode, name: orgName, timezone: 'Asia/Kolkata', currency: 'INR' },
  });
  console.log(`  organisation          ${org.name}`);

  // -------------------------------------------------------------------------
  // permission catalogue
  // -------------------------------------------------------------------------
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, action: p.action, elevated: p.elevated ?? false },
      create: { code: p.code, module: p.module, action: p.action, elevated: p.elevated ?? false },
    });
  }
  console.log(`  permissions           ${PERMISSIONS.length}`);

  // -------------------------------------------------------------------------
  // roles and the role matrix
  // -------------------------------------------------------------------------
  const allPermissions = await prisma.permission.findMany({ select: { id: true, code: true } });
  const permissionIdByCode = new Map(allPermissions.map((p) => [p.code, p.id]));
  const roleIdByCode = new Map<RoleCode, string>();

  for (const code of ROLE_CODES) {
    const role = await prisma.role.upsert({
      where: { organizationId_code: { organizationId: org.id, code } },
      update: { name: ROLE_LABELS[code] },
      create: {
        organizationId: org.id,
        code,
        name: ROLE_LABELS[code],
        description: `${ROLE_LABELS[code]} - default permission set`,
        isSystem: true,
      },
    });
    roleIdByCode.set(code, role.id);

    const codes = ROLE_PERMISSIONS[code];
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: codes
        .map((c) => permissionIdByCode.get(c))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }
  console.log(`  roles                 ${ROLE_CODES.length}`);

  // -------------------------------------------------------------------------
  // administrator
  // -------------------------------------------------------------------------
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@dashanddot.local').toLowerCase();
  const existingAdmin = await prisma.user.findFirst({
    where: { organizationId: org.id, email: adminEmail },
    select: { id: true },
  });

  let generatedPassword: string | null = null;
  if (!existingAdmin) {
    // A random password printed once beats a known default that survives into
    // production because nobody changed it.
    const password = process.env.SEED_ADMIN_PASSWORD?.trim() || randomBytes(12).toString('base64url');
    generatedPassword = process.env.SEED_ADMIN_PASSWORD?.trim() ? null : password;

    const admin = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: adminEmail,
        fullName: 'System Administrator',
        employeeCode: 'ADMIN',
        passwordHash: await bcrypt.hash(password, 12),
        userRoles: { create: [{ roleId: roleIdByCode.get('SUPER_ADMIN')! }] },
      },
      select: { id: true, email: true },
    });
    console.log(`  administrator         ${admin.email}`);
  } else {
    console.log(`  administrator         ${adminEmail} (already exists, untouched)`);
  }

  // -------------------------------------------------------------------------
  // system locations - the ledger's virtual counter-accounts
  // -------------------------------------------------------------------------
  for (const spec of SYSTEM_LOCATION_SPECS) {
    await prisma.materialLocation.upsert({
      where: { organizationId_code: { organizationId: org.id, code: spec.code } },
      update: { name: spec.name, kind: spec.kind, blocksIssue: spec.blocksIssue, isSystem: true },
      create: {
        organizationId: org.id,
        code: spec.code,
        name: spec.name,
        kind: spec.kind,
        storageLevel: 'VIRTUAL',
        isSystem: true,
        blocksIssue: spec.blocksIssue,
      },
    });
  }
  console.log(`  system locations      ${SYSTEM_LOCATION_SPECS.length}`);

  // -------------------------------------------------------------------------
  // physical locations: warehouse -> room -> rack -> bin, plus departments
  // -------------------------------------------------------------------------
  type LocSpec = {
    code: string; name: string; kind: Prisma.MaterialLocationCreateInput['kind'];
    storageLevel: string; parent?: string; blocksIssue?: boolean;
  };

  const physical: LocSpec[] = [
    { code: 'RM-WH', name: 'Raw Material Warehouse', kind: 'PHYSICAL', storageLevel: 'WAREHOUSE' },
    { code: 'RM-WH-FAB', name: 'Fabric Room', kind: 'PHYSICAL', storageLevel: 'ROOM', parent: 'RM-WH' },
    { code: 'RM-WH-FAB-R03', name: 'Fabric Room / Rack 03', kind: 'PHYSICAL', storageLevel: 'RACK', parent: 'RM-WH-FAB' },
    { code: 'RM-WH-FAB-R03-B05', name: 'Fabric Room / Rack 03 / Bin 05', kind: 'PHYSICAL', storageLevel: 'BIN', parent: 'RM-WH-FAB-R03' },
    { code: 'RM-WH-TRM', name: 'Trims and Accessories Room', kind: 'PHYSICAL', storageLevel: 'ROOM', parent: 'RM-WH' },
    // Department floors are PRODUCTION_FLOOR, not PHYSICAL: stock issued here
    // is still owned but is already committed to an order.
    { code: 'DEPT-CUT', name: 'Cutting Department', kind: 'PRODUCTION_FLOOR', storageLevel: 'DEPARTMENT' },
    { code: 'DEPT-EMB', name: 'Embroidery Department', kind: 'PRODUCTION_FLOOR', storageLevel: 'DEPARTMENT' },
    { code: 'DEPT-STITCH', name: 'Stitching Department', kind: 'PRODUCTION_FLOOR', storageLevel: 'DEPARTMENT' },
    { code: 'DEPT-WASH', name: 'Washing and Processing', kind: 'PRODUCTION_FLOOR', storageLevel: 'DEPARTMENT' },
    { code: 'DEPT-FIN', name: 'Finishing Department', kind: 'PRODUCTION_FLOOR', storageLevel: 'DEPARTMENT' },
    { code: 'DEPT-QC', name: 'Quality Control', kind: 'PRODUCTION_FLOOR', storageLevel: 'DEPARTMENT' },
    { code: 'DEPT-PACK', name: 'Packing', kind: 'PRODUCTION_FLOOR', storageLevel: 'DEPARTMENT' },
    { code: 'FG-WH', name: 'Finished Goods Store', kind: 'PHYSICAL', storageLevel: 'WAREHOUSE' },
  ];

  const locationIdByCode = new Map<string, string>();
  for (const spec of physical) {
    const parentId = spec.parent ? locationIdByCode.get(spec.parent) : undefined;
    const loc = await prisma.materialLocation.upsert({
      where: { organizationId_code: { organizationId: org.id, code: spec.code } },
      update: { name: spec.name, storageLevel: spec.storageLevel, parentId: parentId ?? null },
      create: {
        organizationId: org.id,
        code: spec.code,
        name: spec.name,
        kind: spec.kind,
        storageLevel: spec.storageLevel,
        parentId: parentId ?? null,
        blocksIssue: spec.blocksIssue ?? false,
      },
    });
    locationIdByCode.set(spec.code, loc.id);
  }
  console.log(`  physical locations    ${physical.length}`);

  // -------------------------------------------------------------------------
  // production stages and the default garment route
  // -------------------------------------------------------------------------
  const stages: {
    code: string; name: string; seq: number; location?: string;
    consumesMaterial?: boolean; allowsJobWork?: boolean; requiresQc?: boolean;
    serialisesUnits?: boolean; isTerminal?: boolean;
  }[] = [
    { code: 'RELEASE', name: 'Production Release', seq: 1 },
    { code: 'MATERIAL_ISSUE', name: 'Material Issue', seq: 2, location: 'RM-WH' },
    { code: 'CUTTING', name: 'Fabric Cutting', seq: 3, location: 'DEPT-CUT', consumesMaterial: true, serialisesUnits: true },
    { code: 'EMBROIDERY', name: 'Embroidery / Handwork', seq: 4, location: 'DEPT-EMB', allowsJobWork: true },
    { code: 'STITCHING', name: 'Stitching', seq: 5, location: 'DEPT-STITCH', allowsJobWork: true, consumesMaterial: true },
    { code: 'WASHING', name: 'Washing / Processing', seq: 6, location: 'DEPT-WASH', allowsJobWork: true },
    { code: 'FINISHING', name: 'Finishing', seq: 7, location: 'DEPT-FIN', consumesMaterial: true },
    { code: 'QC', name: 'Quality Check', seq: 8, location: 'DEPT-QC', requiresQc: true },
    { code: 'PRESSING', name: 'Pressing', seq: 9, location: 'DEPT-FIN' },
    { code: 'TAGGING', name: 'Tagging', seq: 10, location: 'DEPT-PACK', consumesMaterial: true },
    { code: 'PACKING', name: 'Packing', seq: 11, location: 'DEPT-PACK', consumesMaterial: true },
    { code: 'FG_INWARD', name: 'Finished Goods Inward', seq: 12, location: 'FG-WH', isTerminal: true },
  ];

  const stageIdByCode = new Map<string, string>();
  for (const s of stages) {
    const stage = await prisma.productionStage.upsert({
      where: { organizationId_code: { organizationId: org.id, code: s.code } },
      update: { name: s.name, sequenceHint: s.seq },
      create: {
        organizationId: org.id,
        code: s.code,
        name: s.name,
        sequenceHint: s.seq,
        defaultLocationId: s.location ? (locationIdByCode.get(s.location) ?? null) : null,
        consumesMaterial: s.consumesMaterial ?? false,
        allowsJobWork: s.allowsJobWork ?? false,
        requiresQc: s.requiresQc ?? false,
        serialisesUnits: s.serialisesUnits ?? false,
        isTerminal: s.isTerminal ?? false,
      },
    });
    stageIdByCode.set(s.code, stage.id);
  }
  console.log(`  production stages     ${stages.length}`);

  // Two routes: the full garment path, and a simpler one for styles with no
  // embroidery or wash. Routes are configurable, which is the point.
  const routes: { code: string; name: string; isDefault: boolean; steps: string[] }[] = [
    {
      code: 'STD-GARMENT', name: 'Standard Garment', isDefault: true,
      steps: ['RELEASE', 'MATERIAL_ISSUE', 'CUTTING', 'EMBROIDERY', 'STITCHING', 'WASHING',
              'FINISHING', 'QC', 'PRESSING', 'TAGGING', 'PACKING', 'FG_INWARD'],
    },
    {
      code: 'PLAIN-GARMENT', name: 'Plain Garment (no embroidery or wash)', isDefault: false,
      steps: ['RELEASE', 'MATERIAL_ISSUE', 'CUTTING', 'STITCHING', 'FINISHING', 'QC',
              'PRESSING', 'TAGGING', 'PACKING', 'FG_INWARD'],
    },
  ];

  const routeIdByCode = new Map<string, string>();
  for (const r of routes) {
    const route = await prisma.productionRoute.upsert({
      where: { organizationId_code: { organizationId: org.id, code: r.code } },
      update: { name: r.name, isDefault: r.isDefault },
      create: { organizationId: org.id, code: r.code, name: r.name, isDefault: r.isDefault },
    });
    routeIdByCode.set(r.code, route.id);

    await prisma.productionRouteStep.deleteMany({ where: { routeId: route.id } });
    await prisma.productionRouteStep.createMany({
      data: r.steps.map((code, idx) => ({
        routeId: route.id,
        productionStageId: stageIdByCode.get(code)!,
        sequence: idx + 1,
        // An eight-hour SLA per stage is a starting point a planner will tune.
        slaHours: new Prisma.Decimal(8),
      })),
    });
  }
  console.log(`  production routes     ${routes.length}`);

  // -------------------------------------------------------------------------
  // unit conversions
  //
  // Only genuinely definitional ones. There is deliberately NO roll-to-metre
  // conversion here: roll length varies per fabric, so it must be configured
  // per material or the system would be inventing stock.
  // -------------------------------------------------------------------------
  const conversions: { from: string; to: string; factor: string; note: string }[] = [
    { from: 'METER', to: 'YARD', factor: '1.0936133', note: 'Definitional: 1 m = 1.0936133 yd' },
    { from: 'YARD', to: 'METER', factor: '0.9144', note: 'Definitional: 1 yd = 0.9144 m' },
  ];
  for (const c of conversions) {
    const existing = await prisma.uomConversion.findFirst({
      where: { organizationId: org.id, rawMaterialId: null, fromUom: c.from as never, toUom: c.to as never },
      select: { id: true },
    });
    if (existing) {
      await prisma.uomConversion.update({
        where: { id: existing.id },
        data: { factor: new Prisma.Decimal(c.factor), note: c.note },
      });
    } else {
      await prisma.uomConversion.create({
        data: {
          organizationId: org.id,
          rawMaterialId: null,
          fromUom: c.from as never,
          toUom: c.to as never,
          factor: new Prisma.Decimal(c.factor),
          note: c.note,
        },
      });
    }
  }
  console.log(`  uom conversions       ${conversions.length} (roll lengths are per-material by design)`);

  // -------------------------------------------------------------------------
  // No sample suppliers, raw materials or products.
  //
  // Suppliers and raw materials are entered by the business; products come in
  // from Shopify. A seeded "example" record would show up in every list and
  // every figure as if it were real.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // integration connections - created DISABLED and read-only
  // -------------------------------------------------------------------------
  for (const provider of ['SHOPIFY', 'UNICOMMERCE'] as const) {
    await prisma.integrationConnection.upsert({
      where: { organizationId_provider_name: { organizationId: org.id, provider, name: 'primary' } },
      update: {},
      create: {
        organizationId: org.id,
        provider,
        name: 'primary',
        isEnabled: false,
        // Both flags off: a connector cannot write to external inventory until
        // someone turns this on deliberately.
        allowExternalWrites: false,
        healthStatus: 'NOT_CONFIGURED',
        config:
          provider === 'SHOPIFY'
            ? { apiVersion: '2025-07', shopDomain: null }
            : { baseUrl: null, defaultFacilityCode: null },
      },
    });
  }
  console.log(`  integrations          2 (both disabled and read-only)`);

  // -------------------------------------------------------------------------
  // alert rules
  // -------------------------------------------------------------------------
  const alertRules: { code: string; name: string; type: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; roles: string[]; cooldown: number }[] = [
    { code: 'LOW_STOCK', name: 'Raw material below minimum stock', type: 'LOW_STOCK', severity: 'WARNING', roles: ['RAW_MATERIAL_MANAGER', 'PURCHASE_MANAGER'], cooldown: 1440 },
    { code: 'REORDER_POINT', name: 'Raw material at reorder level', type: 'REORDER_POINT', severity: 'INFO', roles: ['PURCHASE_MANAGER'], cooldown: 1440 },
    { code: 'PO_OVERDUE', name: 'Purchase order past its expected date', type: 'PO_OVERDUE', severity: 'WARNING', roles: ['PURCHASE_MANAGER'], cooldown: 1440 },
    { code: 'QC_HOLD', name: 'Material waiting at incoming inspection', type: 'QC_HOLD', severity: 'INFO', roles: ['QC_EXECUTIVE', 'RAW_MATERIAL_MANAGER'], cooldown: 720 },
    { code: 'SYNC_FAILED', name: 'External inventory sync failed', type: 'SYNC_FAILED', severity: 'CRITICAL', roles: ['PRODUCTION_HEAD'], cooldown: 60 },
    { code: 'RECONCILIATION_VARIANCE', name: 'External inventory does not match the ERP', type: 'RECONCILIATION_VARIANCE', severity: 'CRITICAL', roles: ['PRODUCTION_HEAD'], cooldown: 60 },
  ];
  for (const r of alertRules) {
    await prisma.alertRule.upsert({
      where: { organizationId_code: { organizationId: org.id, code: r.code } },
      update: { name: r.name },
      create: {
        organizationId: org.id,
        code: r.code,
        name: r.name,
        alertType: r.type,
        severity: r.severity,
        channels: ['IN_APP'],
        recipientRoles: r.roles,
        cooldownMinutes: r.cooldown,
        isEnabled: true,
      },
    });
  }
  console.log(`  alert rules           ${alertRules.length}`);

  // -------------------------------------------------------------------------
  // approval matrix
  // -------------------------------------------------------------------------
  const approvals: { code: string; name: string; subject: string; roles: string[]; conditions: object }[] = [
    { code: 'PO_APPROVAL', name: 'Purchase order approval', subject: 'PURCHASE_ORDER', roles: ['PURCHASE_MANAGER', 'PRODUCTION_HEAD'], conditions: { minAmount: 0 } },
    { code: 'STOCK_ADJUSTMENT', name: 'Stock adjustment approval', subject: 'STOCK_ADJUSTMENT', roles: ['RAW_MATERIAL_MANAGER', 'PRODUCTION_HEAD'], conditions: {} },
    { code: 'BOM_RELEASE', name: 'BOM version release', subject: 'BOM_RELEASE', roles: ['PRODUCTION_HEAD'], conditions: {} },
    { code: 'SHORTAGE_RELEASE', name: 'Release production despite a material shortage', subject: 'SHORTAGE_RELEASE', roles: ['PRODUCTION_HEAD'], conditions: {} },
    { code: 'SHADE_MIX', name: 'Mixing fabric shades in one batch', subject: 'SHADE_MIX', roles: ['PRODUCTION_HEAD'], conditions: {} },
    { code: 'FACILITY_CHANGE', name: 'Change the destination facility of an inventory push', subject: 'FACILITY_CHANGE', roles: ['PRODUCTION_HEAD'], conditions: {} },
  ];
  for (const a of approvals) {
    await prisma.approvalRule.upsert({
      where: { organizationId_code: { organizationId: org.id, code: a.code } },
      update: { name: a.name },
      create: {
        organizationId: org.id,
        code: a.code,
        name: a.name,
        subjectType: a.subject,
        conditions: a.conditions as Prisma.InputJsonValue,
        approverRoles: a.roles,
        minApprovals: 1,
        isEnabled: true,
      },
    });
  }
  console.log(`  approval rules        ${approvals.length}`);

  console.log('\nSeed complete. Configuration only — no sample suppliers, materials, products or stock.');
  console.log('Add suppliers and raw materials in the app, and import products from Shopify.\n');

  if (generatedPassword) {
    console.log('='.repeat(64));
    console.log('  ADMIN PASSWORD (shown once - store it now)');
    console.log(`  email:    ${adminEmail}`);
    console.log(`  password: ${generatedPassword}`);
    console.log('='.repeat(64) + '\n');
  }
}

main()
  .catch((e) => {
    console.error('\nSeed failed:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
