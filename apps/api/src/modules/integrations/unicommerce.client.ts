import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isTokenExpiring, readUniwareFailure, tokenExpiryFrom, type UniwareEnvelope,
} from '@dnd/domain';

export interface UnicommerceConfig {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly clientId: string;
  readonly proxySecret: string;
  readonly defaultFacility: string;
  readonly allowExternalWrites: boolean;
}

/**
 * Paths verified against the live tenant on 23 Oct 2026.
 *
 * Casing is inconsistent and **case-sensitive** — `saleOrder/search` is
 * camelCase while `saleorder/get` is not. Getting it wrong returns a bare 404
 * with no hint, so every path used lives here rather than being spelled inline.
 */
export const UC_PATHS = {
  token: '/oauth/token',
  facilityGet: '/services/rest/v1/facility/get',
  inventorySnapshot: '/services/rest/v1/inventory/inventorySnapshot/get',
  saleOrderSearch: '/services/rest/v1/oms/saleOrder/search',
  saleOrderGet: '/services/rest/v1/oms/saleorder/get',
  itemTypeGet: '/services/rest/v1/catalog/itemType/get',
  /** A WRITE. Only `switchFacility()` may send it, behind its own gates. */
  facilitySwitch: '/services/rest/v1/oms/saleorder/facility/switch',
} as const;

/**
 * Write paths. Present so the gate below can recognise them — **not** so they
 * can be called. Their request schemas are deliberately unknown: establishing
 * them means sending a real payload at real inventory, which needs explicit
 * authorisation first (docs/unicommerce-integration.md §6).
 */
const UC_WRITE_PATHS = [
  '/services/rest/v1/inventory/adjust',
  '/services/rest/v1/purchase/purchaseOrder/create',
  '/services/rest/v1/purchase/grn/create',
  '/services/rest/v1/oms/saleOrder/create',
  UC_PATHS.facilitySwitch,
];

/** How long a switch request may take before its outcome is treated as unknown. */
const SWITCH_TIMEOUT_MS = 25_000;

/**
 * What came back from a switch request. Never "it failed" for a timeout: the
 * request may have been applied, and only reading the order can say.
 */
export type FacilitySwitchTransportResult =
  | { readonly kind: 'RESPONSE'; readonly httpStatus: number; readonly body: UniwareEnvelope | null }
  | { readonly kind: 'NO_RESPONSE'; readonly reason: string };

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAt: Date;
}

/**
 * The Unicommerce transport.
 *
 * What this does that a plain fetch would not:
 *
 *  1. **Trusts the envelope, not the HTTP status.** Uniware reports business
 *     failures with HTTP 200 and `successful: false` (decisions.md §30), so
 *     `res.ok` is close to meaningless here.
 *  2. **Never logs a credential**, in any path. The password rides the token
 *     endpoint's query string because that is the only form it accepts, so the
 *     request URL itself is sensitive and is never emitted.
 *  3. **Refuses writes structurally.** Phase 4 is read-only. A transport that
 *     cannot write is a stronger guarantee than everyone remembering not to.
 *  4. **Caches the token** and refreshes early. The measured lifetime is ~7h;
 *     expiring mid-flight fails a call that may already have changed something.
 */
@Injectable()
export class UnicommerceClient {
  private readonly logger = new Logger(UnicommerceClient.name);
  private token: CachedToken | null = null;

  constructor(private readonly config: ConfigService) {}

  resolveConfig(): UnicommerceConfig {
    // Falls back when the value is MISSING OR EMPTY. `?? default` alone is a
    // trap here: a key present in .env with no value is the empty string, not
    // undefined, so the default never applies and the request goes out with a
    // blank field. That cost a debugging cycle - an empty client_id produced
    // "No client with requested id" from Uniware, which names the symptom and
    // not the cause.
    const get = (k: string, d = ''): string => {
      const raw = String(this.config.get(k) ?? '').trim();
      return raw.length > 0 ? raw : d;
    };
    return {
      enabled: get('UNICOMMERCE_ENABLED', 'false') === 'true',
      baseUrl: get('UNICOMMERCE_BASE_URL').replace(/\/+$/, ''),
      username: get('UNICOMMERCE_USERNAME'),
      password: get('UNICOMMERCE_PASSWORD'),
      // Uniware's documented default trusted client for the password grant.
      clientId: get('UNICOMMERCE_CLIENT_ID', 'my-trusted-client'),
      proxySecret: get('UNICOMMERCE_PROXY_SECRET'),
      defaultFacility: get('UNICOMMERCE_DEFAULT_FACILITY_CODE'),
      allowExternalWrites: get('INTEGRATION_ALLOW_EXTERNAL_WRITES', 'false') === 'true',
    };
  }

  /** Configuration as it is safe to show a user or write to a log. */
  describe(): {
    enabled: boolean; baseUrl: string; defaultFacility: string; hasCredentials: boolean;
    usesProxy: boolean; isPlaintextTransport: boolean; allowExternalWrites: boolean;
    isConfigured: boolean; missing: string[];
  } {
    const c = this.resolveConfig();
    const missing: string[] = [];
    if (!c.baseUrl) missing.push('UNICOMMERCE_BASE_URL');
    if (!c.username) missing.push('UNICOMMERCE_USERNAME');
    if (!c.password) missing.push('UNICOMMERCE_PASSWORD');
    if (!c.defaultFacility) missing.push('UNICOMMERCE_DEFAULT_FACILITY_CODE');
    if (!c.enabled) missing.push('UNICOMMERCE_ENABLED=true');
    return {
      enabled: c.enabled,
      baseUrl: c.baseUrl,
      defaultFacility: c.defaultFacility,
      hasCredentials: c.username.length > 0 && c.password.length > 0,
      usesProxy: c.proxySecret.length > 0,
      // Surfaced deliberately: the credential crosses the public internet in
      // cleartext on this transport, which is a deployment decision someone
      // has to make knowingly rather than discover. See decisions.md §29.
      isPlaintextTransport: c.baseUrl.startsWith('http://'),
      allowExternalWrites: c.allowExternalWrites,
      isConfigured: missing.length === 0,
      missing,
    };
  }

  /** True once a token has been obtained, for the UI. Never exposes the token. */
  hasLiveSession(): boolean {
    return this.token !== null && !isTokenExpiring(this.token.expiresAt, new Date());
  }

  /**
   * Read-only POST against a verified path.
   *
   * `facility` is always explicit. The header is honoured on some endpoints and
   * silently ignored on others (decisions.md §31), so callers that depend on it
   * must verify the result rather than assume the scope applied.
   */
  async post<T>(path: string, body: Record<string, unknown>, facility?: string): Promise<T> {
    const config = this.resolveConfig();
    this.assertConfigured(config);
    this.assertReadOnly(path, config);

    const token = await this.accessToken(config);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    };
    if (config.proxySecret) headers['X-Proxy-Secret'] = config.proxySecret;
    const facilityCode = facility ?? config.defaultFacility;
    if (facilityCode) headers.Facility = facilityCode;

    const res = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body is how the proxy reports its own failures, and how
      // Uniware answers an unknown path. Either way it is not a result.
      throw new ServiceUnavailableException({
        code: 'UNICOMMERCE_BAD_RESPONSE',
        message: `Unicommerce returned a non-JSON response (HTTP ${res.status}) for ${path}`,
        details: { status: res.status, path },
      });
    }

    if (res.status === 401) {
      // The cached token is no longer accepted; drop it so the next call
      // re-authenticates rather than repeating a known-bad credential.
      this.token = null;
      throw new ServiceUnavailableException({
        code: 'UNICOMMERCE_UNAUTHORISED',
        message: 'Unicommerce rejected the session token.',
        details: { path },
      });
    }

    const failure = readUniwareFailure(parsed as UniwareEnvelope);
    if (failure) {
      throw new ServiceUnavailableException({
        code: `UNICOMMERCE_${failure.code}`,
        message: failure.description,
        details: { path, facility: facilityCode, errors: failure.all, fields: failure.fieldNames },
      });
    }

    return parsed as T;
  }

  /**
   * As `post`, but returns the failure instead of raising.
   *
   * For probes where a failure IS the answer — `facility/get` returning
   * `FACILITY_ACCESS_DENIED` means the code is valid and invisible, which is
   * information, not an error.
   */
  async probe(
    path: string,
    body: Record<string, unknown>,
    facility?: string,
  ): Promise<{ ok: true; body: UniwareEnvelope } | { ok: false; body: UniwareEnvelope | null; status: number }> {
    try {
      const body2 = await this.post<UniwareEnvelope>(path, body, facility);
      return { ok: true, body: body2 };
    } catch (error) {
      const details = (error as { response?: { details?: { status?: number } } }).response?.details;
      const raw = (error as { response?: { code?: string; message?: string } }).response;
      return {
        ok: false,
        body: raw
          ? { successful: false, errors: [{ message: String(raw.code ?? '').replace(/^UNICOMMERCE_/, ''), description: raw.message }] }
          : null,
        status: details?.status ?? 0,
      };
    }
  }

  /**
   * Send ONE facility switch. The only write this transport will carry.
   *
   * Refuses before sending unless INTEGRATION_ALLOW_EXTERNAL_WRITES is true;
   * the caller enforces the connection flag, the operator's permission and a
   * validated preflight. Never retries: a retried write is how one switch
   * becomes two. Business failures arrive as HTTP 200 and are returned, not
   * raised, so the caller records them verbatim.
   */
  async switchFacility(
    body: { facilityCode: string; saleOrderCode: string; saleOrderItemCodes: string[] },
    facilityHeader: string,
  ): Promise<FacilitySwitchTransportResult> {
    const config = this.resolveConfig();
    this.assertConfigured(config);
    if (!config.allowExternalWrites) {
      throw new ServiceUnavailableException({
        code: 'UNICOMMERCE_WRITES_DISABLED',
        message: 'Writes to Unicommerce are switched off for this ERP (INTEGRATION_ALLOW_EXTERNAL_WRITES=false).',
        details: { path: UC_PATHS.facilitySwitch },
      });
    }
    if (body.saleOrderItemCodes.length !== 1) {
      // One item per operation: a list here would switch items nobody chose.
      throw new ServiceUnavailableException({
        code: 'UNICOMMERCE_SWITCH_ONE_ITEM',
        message: 'A facility switch moves exactly one sale-order item.',
      });
    }

    // Authentication happens before the write is attempted, so a sign-in
    // failure is a clean refusal rather than an unknown outcome.
    const token = await this.accessToken(config);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      Facility: facilityHeader,
    };
    if (config.proxySecret) headers['X-Proxy-Secret'] = config.proxySecret;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SWITCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${config.baseUrl}${UC_PATHS.facilitySwitch}`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: abort.signal,
      });
      const text = await res.text();
      let parsed: UniwareEnvelope | null = null;
      try {
        parsed = text ? (JSON.parse(text) as UniwareEnvelope) : null;
      } catch {
        parsed = null;
      }
      if (res.status === 401) this.token = null;
      return { kind: 'RESPONSE', httpStatus: res.status, body: parsed };
    } catch (error) {
      return {
        kind: 'NO_RESPONSE',
        reason: abort.signal.aborted
          ? `No answer within ${SWITCH_TIMEOUT_MS / 1000}s`
          : `The connection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async accessToken(config: UnicommerceConfig): Promise<string> {
    if (this.token && !isTokenExpiring(this.token.expiresAt, new Date())) {
      return this.token.accessToken;
    }

    // The password grant is a GET with query parameters. That is the only form
    // the endpoint accepts - a form-encoded POST is rejected - so the
    // credential is in the URL by the API's design, not by choice. The URL is
    // therefore sensitive and is never logged, here or in any error path.
    const url = new URL(`${config.baseUrl}${UC_PATHS.token}`);
    url.searchParams.set('grant_type', 'password');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('username', config.username);
    url.searchParams.set('password', config.password);

    const headers: Record<string, string> = { accept: 'application/json' };
    if (config.proxySecret) headers['X-Proxy-Secret'] = config.proxySecret;

    const res = await fetch(url, { method: 'GET', headers });
    const body = (await res.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error_description?: string }
      | null;

    if (!res.ok || !body?.access_token) {
      throw new ServiceUnavailableException({
        code: 'UNICOMMERCE_AUTH_FAILED',
        message:
          body?.error_description ??
          'Unicommerce refused the credentials. The account password may have changed, or the proxy secret may be wrong.',
        // Deliberately no URL and no credential, only the shape of the failure.
        details: { status: res.status },
      });
    }

    this.token = {
      accessToken: body.access_token,
      expiresAt: tokenExpiryFrom(body.expires_in ?? 3600, new Date()),
    };
    this.logger.log(`Unicommerce session established, valid for ${body.expires_in ?? 3600}s`);
    return this.token.accessToken;
  }

  private assertConfigured(config: UnicommerceConfig): void {
    const described = this.describe();
    if (!described.isConfigured) {
      throw new ServiceUnavailableException({
        code: 'UNICOMMERCE_NOT_CONFIGURED',
        message: `Unicommerce is not configured. Set ${described.missing.join(', ')} in the environment.`,
        details: { missing: described.missing },
      });
    }
    if (!/^https?:\/\//.test(config.baseUrl)) {
      throw new ServiceUnavailableException({
        code: 'UNICOMMERCE_BAD_BASE_URL',
        message: 'UNICOMMERCE_BASE_URL must be an absolute http(s) URL',
      });
    }
  }

  /**
   * Structurally refuse to send a write.
   *
   * Phase 4 reads. Writing to Unicommerce moves real stock in a real building,
   * and the specification forbids live external inventory changes without
   * explicit authorisation — so the transport will not carry one, regardless of
   * what a caller asks for.
   */
  private assertReadOnly(path: string, config: UnicommerceConfig): void {
    if (!UC_WRITE_PATHS.some((w) => path.startsWith(w))) return;
    throw new ServiceUnavailableException({
      code: 'UNICOMMERCE_WRITES_DISABLED',
      message:
        config.allowExternalWrites
          ? 'This connector is read-only. The inventory push has its own reviewed path and is not enabled yet.'
          : 'This connector is read-only. Writing to Unicommerce needs explicit authorisation and its own reviewed path.',
      details: { path },
    });
  }
}
