import { Injectable, Logger } from '@nestjs/common';
import {
  classifyFacilityProbe, facilityKind, readInventorySnapshot, splitSaleOrderWindows,
  shopifyVariantIdFromUniwareSku, summariseAvailability,
  type FacilityKind, type FacilityProbeResult, type InventoryReading,
  type UniwareEnvelope, type UniwareInventorySnapshot,
} from '@dnd/domain';
import { UnicommerceClient, UC_PATHS } from './unicommerce.client';

/** The seventeen codes the business supplied, all confirmed real (§8a). */
export const SUPPLIED_FACILITY_CODES = [
  'dashanddot', 'WH_Noida_3', 'WH_Noida', 'International_Warehouse', 'CWH', 'Coords_Warehouse',
  'ST_Dhanmill', 'ST_Pacific_DEL', 'ST_Mmchandigarh_CH', 'ST_dlfpromenade_DL', 'ST_dlfavenue_DL',
  'ST_Zora_Mall', 'ST_KGF_Mumbai', 'ST_Exibition_NO', 'WH_Second_Floor', 'MBO', 'ST_PhoenixPalladium',
] as const;

export interface FacilityRecord {
  readonly code: string;
  readonly displayName: string | null;
  readonly kind: FacilityKind;
  readonly probe: FacilityProbeResult;
  readonly isVisible: boolean;
  readonly enabled: boolean | null;
}

interface FacilityGetResponse extends UniwareEnvelope {
  readonly facility?: {
    type?: string | null; displayName?: string | null;
    operationalType?: string | null; enabled?: boolean | null;
  } | null;
}

interface InventoryResponse extends UniwareEnvelope {
  readonly inventorySnapshots?: UniwareInventorySnapshot[] | null;
}

interface SaleOrderSearchResponse extends UniwareEnvelope {
  readonly elements?: {
    code?: string; displayOrderCode?: string; status?: string;
    channel?: string; source?: string; created?: string; updated?: string;
  }[] | null;
}

interface SaleOrderGetResponse extends UniwareEnvelope {
  readonly saleOrderDTO?: {
    code?: string; displayOrderCode?: string; status?: string; channel?: string; source?: string;
    saleOrderItems?: {
      code?: string; itemSku?: string; sellerSkuCode?: string; itemName?: string;
      facilityCode?: string; facilityName?: string; alternateFacilityCode?: string | null;
      statusCode?: string; allocatedQuantity?: number | null; unallocatedQuantity?: number | null;
      inProcessQuantity?: number | null; completedQuantity?: number | null;
      cancelledQuantity?: number | null; unfulfillableQuantity?: number | null;
      totalQuantity?: number | null; onHold?: boolean;
    }[];
  } | null;
}

/**
 * Unicommerce reads.
 *
 * Phase 4 is read-only by design and by transport (see `UnicommerceClient`).
 * Everything here was shaped by probing the live tenant, so the surprises are
 * handled rather than discovered: business failures arrive as HTTP 200, the
 * `Facility` header is honoured on some endpoints and ignored on others, and
 * the service account cannot see five of the seventeen facilities.
 */
@Injectable()
export class UnicommerceService {
  private readonly logger = new Logger(UnicommerceService.name);

  constructor(private readonly client: UnicommerceClient) {}

  /** Configuration as it is safe to show a user. Never reveals credentials. */
  status(): ReturnType<UnicommerceClient['describe']> {
    return this.client.describe();
  }

  /**
   * Does this configuration actually work, and what can it see?
   *
   * Deliberately reports what is NOT reachable as prominently as what is. The
   * blind spots are the part that changes decisions.
   */
  async verify(): Promise<Record<string, unknown>> {
    const described = this.client.describe();
    if (!described.isConfigured) {
      return {
        ...described,
        checks: [{ name: 'Configuration', ok: false, detail: `Missing: ${described.missing.join(', ')}` }],
      };
    }

    const checks: { name: string; ok: boolean; detail: string }[] = [];
    let facilities: FacilityRecord[] = [];

    // Authentication is proved on its own, with a call that RAISES on failure.
    // Inferring it from `facilities()` was wrong: that uses `probe()`, which
    // deliberately swallows errors, so a failed sign-in reported as a healthy
    // "Authentication OK" next to seventeen unexplained facility errors. A
    // check that cannot fail is not a check.
    try {
      await this.client.post(UC_PATHS.facilityGet, {
        facilityCode: this.client.resolveConfig().defaultFacility,
      });
      checks.push({
        name: 'Authentication',
        ok: true,
        detail: 'Signed in, a session token was issued, and the default facility resolved.',
      });
    } catch (error) {
      const message = (error as { response?: { message?: string } }).response?.message ?? 'Sign-in failed.';
      checks.push({ name: 'Authentication', ok: false, detail: message });
      // Nothing below can mean anything without a session.
      return { ...described, checks, facilities };
    }

    try {
      facilities = await this.facilities();
      const visible = facilities.filter((f) => f.isVisible);
      checks.push({
        name: 'Facility master',
        ok: visible.length > 0,
        detail: `${visible.length} of ${facilities.length} facilities are visible to this account.`
          + (visible.length < facilities.length
            ? ` Not visible: ${facilities.filter((f) => !f.isVisible).map((f) => f.code).join(', ')}.`
            : ''),
      });
      const invalid = facilities.filter((f) => f.probe === 'INVALID_CODE');
      checks.push({
        name: 'Facility codes',
        ok: invalid.length === 0,
        detail: invalid.length === 0
          ? 'Every configured facility code is a real facility.'
          : `Not real facilities: ${invalid.map((f) => f.code).join(', ')}.`,
      });
    } catch (error) {
      checks.push({
        name: 'Facility master',
        ok: false,
        detail: (error as { response?: { message?: string } }).response?.message ?? 'Facility resolution failed.',
      });
    }

    try {
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd.getTime() - 7 * 86_400_000);
      const orders = await this.searchOrders(windowStart, windowEnd);
      checks.push({
        name: 'Order read',
        ok: true,
        detail: `${orders.length} orders in the last 7 days.`,
      });
      const shopifySourced = orders.filter((o) => o.source === 'SHOPIFY').length;
      checks.push({
        name: 'Shopify linkage',
        ok: shopifySourced > 0,
        detail: shopifySourced > 0
          ? `${shopifySourced} of ${orders.length} carry source=SHOPIFY, so displayOrderCode joins them to Shopify order names.`
          : 'No recent order reports source=SHOPIFY.',
      });
    } catch (error) {
      checks.push({
        name: 'Order read',
        ok: false,
        detail: (error as { response?: { message?: string } }).response?.message ?? 'Order search failed.',
      });
    }

    checks.push({
      name: 'Write protection',
      ok: true,
      detail: 'The transport refuses write paths outright. No inventory can be changed by this connector.',
    });

    if (described.isPlaintextTransport) {
      checks.push({
        name: 'Transport security',
        ok: false,
        detail:
          'The base URL is plain HTTP, so credentials cross the network in cleartext. '
          + 'Acceptable for development; needs TLS or a whitelisted direct route before production (decisions.md §29).',
      });
    }

    return { ...described, checks, facilities };
  }

  /**
   * Resolve every configured facility code.
   *
   * Uses `facility/get`, which is the only call that distinguishes a wrong code
   * from a real one this account cannot see. Building this from inventory
   * errors instead would silently drop five genuine facilities.
   */
  async facilities(): Promise<FacilityRecord[]> {
    const records: FacilityRecord[] = [];
    for (const code of SUPPLIED_FACILITY_CODES) {
      const result = await this.client.probe(UC_PATHS.facilityGet, { facilityCode: code });
      const probe = classifyFacilityProbe(result.ok ? result.body : result.body);
      const facility = result.ok ? (result.body as FacilityGetResponse).facility ?? null : null;
      records.push({
        code,
        displayName: facility?.displayName ?? null,
        // operationalType, never type - every facility here reports WAREHOUSE.
        kind: facility ? facilityKind(facility) : 'UNKNOWN',
        probe,
        isVisible: probe === 'VALID',
        enabled: facility?.enabled ?? null,
      });
    }
    return records;
  }

  /**
   * Stock for one SKU at one facility.
   *
   * Three outcomes, kept distinct on purpose:
   *
   *  - `reading` — the facility answered with numbers.
   *  - `reading` of zero — the facility answered `INVENTORY_NOT_AVAILABLE`,
   *    which means "this SKU is not stocked here". That is an ANSWER, not a
   *    failure, and recording it as unchecked would make a complete search
   *    look partial and bury the facilities genuinely not visible.
   *  - `null` — the facility could not be asked at all.
   */
  async inventoryAt(sku: string, facilityCode: string): Promise<InventoryReading | null> {
    const result = await this.client.probe(
      UC_PATHS.inventorySnapshot,
      { itemTypeSKUs: [sku] },
      facilityCode,
    );

    if (!result.ok) {
      const code = result.body?.errors?.[0]?.message ?? '';
      // A definitive "nothing of this SKU here" - the facility was reached and
      // it answered. Zero known is not the same as nothing known.
      if (code === 'INVENTORY_NOT_AVAILABLE') {
        return readInventorySnapshot({ itemTypeSKU: sku, inventory: 0 }, facilityCode);
      }
      return null;
    }

    const snapshots = (result.body as InventoryResponse).inventorySnapshots ?? [];
    const snapshot = snapshots.find((s) => s.itemTypeSKU === sku) ?? snapshots[0];
    return snapshot ? readInventorySnapshot(snapshot, facilityCode) : null;
  }

  /**
   * Where else is this piece available?
   *
   * The user's actual question — "switch facility if the piece is available
   * somewhere else". The answer is structurally partial, because five
   * facilities are invisible to this account, so the result carries the list it
   * could not check. A caller must read `isComplete` before telling anyone a
   * garment is unavailable.
   */
  async availability(sku: string, facilityCodes?: readonly string[]): Promise<{
    sku: string;
    search: ReturnType<typeof summariseAvailability>;
    readings: InventoryReading[];
  }> {
    const codes = facilityCodes?.length ? facilityCodes : SUPPLIED_FACILITY_CODES;
    const readings: InventoryReading[] = [];
    const unchecked: string[] = [];

    for (const code of codes) {
      const reading = await this.inventoryAt(sku, code);
      if (reading) readings.push(reading);
      else unchecked.push(code);
    }

    return { sku, search: summariseAvailability(readings, unchecked), readings };
  }

  /**
   * Orders in a date range.
   *
   * Chunked to the measured 31-day cap. Note this endpoint IGNORES the
   * `Facility` header — a deliberately invalid facility returns identical
   * results — so these are tenant-wide, and per-line `facilityCode` is the only
   * honest source of where an order is being served from.
   */
  async searchOrders(from: Date, to: Date): Promise<{
    code: string; displayOrderCode: string | null; status: string | null;
    channel: string | null; source: string | null;
  }[]> {
    const windows = splitSaleOrderWindows(from, to);
    const seen = new Map<string, { code: string; displayOrderCode: string | null; status: string | null; channel: string | null; source: string | null }>();

    for (const window of windows) {
      const body = await this.client.post<SaleOrderSearchResponse>(UC_PATHS.saleOrderSearch, {
        fromDate: isoDate(window.from),
        toDate: isoDate(window.to),
      });
      for (const el of body.elements ?? []) {
        if (!el.code) continue;
        // Windows abut rather than overlap, but an order updated on a boundary
        // can still appear twice; the code is the identity either way.
        seen.set(el.code, {
          code: el.code,
          displayOrderCode: el.displayOrderCode ?? null,
          status: el.status ?? null,
          channel: el.channel ?? null,
          source: el.source ?? null,
        });
      }
    }

    return [...seen.values()];
  }

  /**
   * One order, with its lines.
   *
   * The per-line quantities are STAGE COUNTERS and are reported separately on
   * purpose. Summing allocated + inProcess + completed would double-count the
   * same garment as it moves, exactly as summing cutting + stitching + finishing
   * would internally.
   */
  async order(code: string): Promise<{
    code: string; displayOrderCode: string | null; status: string | null; source: string | null;
    lines: {
      sku: string | null; itemName: string | null; shopifyVariantId: string | null;
      facilityCode: string | null; facilityName: string | null; alternateFacilityCode: string | null;
      statusCode: string | null; onHold: boolean;
      /**
       * Null means Uniware did not report the figure, NOT that it is zero.
       * Measured: every quantity on a CREATED line comes back null. Coercing
       * those to 0 would state "none of these were allocated" on the authority
       * of a field the API declined to answer.
       */
      totalQty: number | null; allocatedQty: number | null; unallocatedQty: number | null;
      inProcessQty: number | null; completedQty: number | null;
      cancelledQty: number | null; unfulfillableQty: number | null;
    }[];
  }> {
    const body = await this.client.post<SaleOrderGetResponse>(UC_PATHS.saleOrderGet, { code });
    const dto = body.saleOrderDTO ?? null;
    return {
      code: dto?.code ?? code,
      displayOrderCode: dto?.displayOrderCode ?? null,
      status: dto?.status ?? null,
      source: dto?.source ?? null,
      lines: (dto?.saleOrderItems ?? []).map((i) => ({
        sku: i.itemSku ?? i.sellerSkuCode ?? null,
        itemName: i.itemName ?? null,
        shopifyVariantId: shopifyVariantIdFromUniwareSku(i.itemSku ?? i.sellerSkuCode),
        facilityCode: i.facilityCode ?? null,
        facilityName: i.facilityName ?? null,
        alternateFacilityCode: i.alternateFacilityCode ?? null,
        statusCode: i.statusCode ?? null,
        onHold: Boolean(i.onHold),
        totalQty: i.totalQuantity ?? null,
        allocatedQty: i.allocatedQuantity ?? null,
        unallocatedQty: i.unallocatedQuantity ?? null,
        inProcessQty: i.inProcessQuantity ?? null,
        completedQty: i.completedQuantity ?? null,
        cancelledQty: i.cancelledQuantity ?? null,
        unfulfillableQty: i.unfulfillableQuantity ?? null,
      })),
    };
  }
}

/** Uniware's sale-order search takes plain `yyyy-MM-dd`. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
