import { describe, expect, it } from 'vitest';
import {
  ALL_NAV_ITEMS, BUILD_STATUS_SUMMARY, DELIVERED_PHASES, NAVIGATION, PERMISSIONS,
  PERMISSION_CODES, ROLE_CODES, ROLE_LABELS, ROLE_PERMISSIONS, navItemFor,
  permissionsForRoles,
} from './index';

/**
 * Consistency tests for the shared contracts.
 *
 * These catch a specific class of bug that is otherwise invisible until
 * runtime: a role granting a permission that does not exist, or a navigation
 * item gated on a permission nobody can hold. Both would produce a screen that
 * is silently unreachable for every user, with no error anywhere.
 */

describe('permission catalogue', () => {
  it('has unique codes', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
  });

  it('derives module and action from every code', () => {
    for (const p of PERMISSIONS) {
      expect(p.code).toBe(`${p.module}.${p.action}`);
      expect(p.module).not.toBe('');
      expect(p.action).not.toBe('');
    }
  });

  it('gives every permission a human description', () => {
    for (const p of PERMISSIONS) {
      expect(p.description.length).toBeGreaterThan(8);
    }
  });

  it('marks the permissions that create or destroy value as elevated', () => {
    const elevated = new Set(PERMISSIONS.filter((p) => p.elevated).map((p) => p.code));
    // These are the ones the specification singles out for extra control.
    for (const code of [
      'inventory.adjust',
      'bom.approve',
      'manufacturing.release',
      'manufacturing.release_with_shortage',
      'production.override_stage',
      'quality.approve_final',
      'sync.push',
      'sync.change_facility',
      'purchasing.close_po',
    ]) {
      expect(elevated.has(code)).toBe(true);
    }
  });

  it('does not mark plain reads as elevated', () => {
    for (const p of PERMISSIONS.filter((x) => x.action === 'read')) {
      expect(p.elevated).toBeFalsy();
    }
  });
});

describe('role matrix', () => {
  it('defines permissions and a label for every role', () => {
    for (const role of ROLE_CODES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it('grants only permissions that exist', () => {
    const known = new Set(PERMISSION_CODES);
    for (const role of ROLE_CODES) {
      for (const code of ROLE_PERMISSIONS[role]) {
        expect(known.has(code), `${role} grants unknown permission ${code}`).toBe(true);
      }
    }
  });

  it('grants no duplicates within a role', () => {
    for (const role of ROLE_CODES) {
      const codes = ROLE_PERMISSIONS[role];
      expect(new Set(codes).size, `${role} has duplicate grants`).toBe(codes.length);
    }
  });

  it('gives the super admin every permission', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.length).toBe(PERMISSION_CODES.length);
  });

  it('keeps the barcode operator minimal', () => {
    // A shared shop-floor terminal is the least physically secure device in the
    // building, so it must hold the least authority.
    const held = new Set(ROLE_PERMISSIONS.BARCODE_OPERATOR);
    expect(held.has('production.scan')).toBe(true);
    expect(held.has('production.record_stage')).toBe(true);

    for (const forbidden of [
      'inventory.adjust', 'inventory.issue', 'inventory.consume',
      'purchasing.approve_po', 'bom.approve', 'sync.push',
      'quality.approve_final', 'manufacturing.release', 'reports.view_costing',
    ]) {
      expect(held.has(forbidden), `barcode operator must not hold ${forbidden}`).toBe(false);
    }

    const elevated = new Set(PERMISSIONS.filter((p) => p.elevated).map((p) => p.code));
    expect([...held].filter((c) => elevated.has(c))).toEqual([]);
  });

  it('separates buying from stock correction', () => {
    // Combining them is how a short delivery quietly becomes an inventory
    // adjustment instead of a supplier conversation.
    expect(ROLE_PERMISSIONS.PURCHASE_MANAGER).not.toContain('inventory.adjust');
    expect(ROLE_PERMISSIONS.RAW_MATERIAL_MANAGER).not.toContain('purchasing.approve_po');
  });

  it('keeps the external inventory push narrow', () => {
    const pushers = ROLE_CODES.filter((r) => ROLE_PERMISSIONS[r].includes('sync.push'));
    // Only the super admin, because this is the one path that writes to real
    // sellable inventory.
    expect(pushers).toEqual(['SUPER_ADMIN']);
  });

  it('gives read-only roles no write permissions', () => {
    for (const role of ['FINANCE_VIEWER', 'MANAGEMENT_VIEWER'] as const) {
      const writes = ROLE_PERMISSIONS[role].filter(
        (c) => !c.endsWith('.read') && !c.endsWith('.export') && !c.endsWith('.view_costing'),
      );
      expect(writes, `${role} should be read-only`).toEqual([]);
    }
  });

  it('unions permissions across roles', () => {
    const both = permissionsForRoles(['QC_EXECUTIVE', 'BARCODE_OPERATOR']);
    expect(both).toContain('quality.inspect');
    expect(both).toContain('production.record_stage');
    expect(new Set(both).size).toBe(both.length);
  });
});

describe('navigation map', () => {
  it('has unique hrefs', () => {
    const hrefs = ALL_NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('gates every item on a permission that exists', () => {
    const known = new Set(PERMISSION_CODES);
    for (const item of ALL_NAV_ITEMS) {
      if (!item.permission) continue;
      // An item gated on a non-existent permission is invisible to everyone,
      // with no error to explain why.
      expect(known.has(item.permission), `${item.href} needs unknown ${item.permission}`).toBe(true);
    }
  });

  it('gives every item a phase and a status', () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(item.phase).toBeGreaterThanOrEqual(1);
      expect(item.phase).toBeLessThanOrEqual(6);
      expect(['BUILT', 'PARTIAL', 'PLANNED']).toContain(item.status);
    }
  });

  it('only marks an item built if its phase has been delivered', () => {
    // Nothing can be built ahead of its phase. DELIVERED_PHASES is the single
    // place that says which phases are done, so marking a phase delivered is
    // one edit rather than a test rewrite.
    const delivered = new Set<number>(DELIVERED_PHASES);
    for (const item of ALL_NAV_ITEMS.filter((i) => i.status === 'BUILT')) {
      expect(
        delivered.has(item.phase),
        `${item.href} is built but phase ${item.phase} is not delivered`,
      ).toBe(true);
    }
  });

  it('leaves nothing in a delivered phase unaccounted for', () => {
    // A PLANNED screen inside a delivered phase is a gap someone chose to
    // leave, so it has to say what is missing rather than sit there silently.
    for (const item of ALL_NAV_ITEMS.filter(
      (i) => (DELIVERED_PHASES as readonly number[]).includes(i.phase) && i.status !== 'BUILT',
    )) {
      expect(
        item.description,
        `${item.href} is ${item.status} inside delivered phase ${item.phase} with no explanation`,
      ).toBeTruthy();
    }
  });

  it('never marks an undelivered phase as built', () => {
    const delivered = new Set<number>(DELIVERED_PHASES);
    for (const item of ALL_NAV_ITEMS.filter((i) => !delivered.has(i.phase))) {
      expect(item.status, `${item.href} is phase ${item.phase}`).not.toBe('BUILT');
    }
  });

  it('delivers phases contiguously from one', () => {
    // Phase 4 delivered while phase 3 is not would mean the roadmap's
    // dependency order was broken somewhere.
    expect([...DELIVERED_PHASES]).toEqual(
      Array.from({ length: DELIVERED_PHASES.length }, (_, i) => i + 1),
    );
  });

  it('starts every href with a slash', () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(item.href.startsWith('/')).toBe(true);
    }
  });

  it('resolves an item by href', () => {
    expect(navItemFor('/materials')?.label).toBe('Raw Material Master');
    expect(navItemFor('/nonexistent')).toBeUndefined();
  });

  it('summarises build status consistently', () => {
    const { built, partial, planned, total } = BUILD_STATUS_SUMMARY;
    expect(built + partial + planned).toBe(total);
    expect(total).toBe(ALL_NAV_ITEMS.length);
    expect(built).toBeGreaterThan(0);
    expect(planned).toBeGreaterThan(0);
  });

  it('groups items without an empty group', () => {
    for (const group of NAVIGATION) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it('describes every partial item, so the gap is explained', () => {
    for (const item of ALL_NAV_ITEMS.filter((i) => i.status === 'PARTIAL')) {
      expect(item.description, `${item.href} is partial with no explanation`).toBeTruthy();
    }
  });
});

describe('reachability', () => {
  it('makes every built screen reachable by at least one role', () => {
    // A built screen nobody can open is a built screen nobody will use.
    for (const item of ALL_NAV_ITEMS.filter((i) => i.status !== 'PLANNED')) {
      if (!item.permission) continue;
      const roles = ROLE_CODES.filter((r) => ROLE_PERMISSIONS[r].includes(item.permission!));
      expect(roles.length, `${item.href} is unreachable by every role`).toBeGreaterThan(0);
    }
  });

  it('makes the raw material path reachable by its operational role', () => {
    const rmm = new Set(ROLE_PERMISSIONS.RAW_MATERIAL_MANAGER);
    // The whole phase 1 workflow, from receiving to issuing.
    for (const code of [
      'purchasing.receive', 'purchasing.inspect', 'inventory.manage_rolls',
      'inventory.issue', 'inventory.read', 'materials.read',
    ]) {
      expect(rmm.has(code), `raw material manager needs ${code}`).toBe(true);
    }
  });
});
