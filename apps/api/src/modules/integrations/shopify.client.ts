import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throttleDelayMs, type ShopifyThrottleState } from '@dnd/domain';

export interface ShopifyGraphqlResponse<T> {
  readonly data?: T;
  readonly errors?: { message: string; extensions?: Record<string, unknown> }[];
  readonly extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: ShopifyThrottleState;
    };
  };
}

export interface ShopifyConfig {
  readonly enabled: boolean;
  readonly shopDomain: string;
  readonly apiVersion: string;
  readonly accessToken: string;
}

/**
 * The Shopify Admin GraphQL transport.
 *
 * Three things this does that a plain fetch would not:
 *
 *  1. **Paces against query COST, not request count.** Shopify's limit is a
 *     leaky bucket of points sized by the page you ask for, so "N requests per
 *     second" is wrong in both directions. The cost each response reports
 *     drives the wait before the next call.
 *  2. **Never logs the access token**, including in error paths. A token in a
 *     log file is a token in a backup, a ticket and a screen share.
 *  3. **Refuses mutations outright.** Phase 4 is read-only; the specification
 *     forbids live external changes without explicit authorisation, and a
 *     transport that cannot write is a stronger guarantee than a convention
 *     that it will not.
 */
@Injectable()
export class ShopifyClient {
  private readonly logger = new Logger(ShopifyClient.name);
  private throttle: ShopifyThrottleState | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Read configuration from the environment.
   *
   * Returns the token but never stores or logs it — `describe()` is what
   * anything user-facing should report.
   */
  resolveConfig(): ShopifyConfig {
    return {
      enabled: String(this.config.get('SHOPIFY_ENABLED') ?? 'false') === 'true',
      shopDomain: String(this.config.get('SHOPIFY_SHOP_DOMAIN') ?? '').trim(),
      apiVersion: String(this.config.get('SHOPIFY_ADMIN_API_VERSION') ?? '2025-07').trim(),
      accessToken: String(this.config.get('SHOPIFY_ADMIN_ACCESS_TOKEN') ?? '').trim(),
    };
  }

  /** Configuration as it is safe to show a user or write to a log. */
  describe(): {
    enabled: boolean; shopDomain: string; apiVersion: string;
    hasToken: boolean; isConfigured: boolean; missing: string[];
  } {
    const c = this.resolveConfig();
    const missing: string[] = [];
    if (!c.shopDomain) missing.push('SHOPIFY_SHOP_DOMAIN');
    if (!c.accessToken) missing.push('SHOPIFY_ADMIN_ACCESS_TOKEN');
    if (!c.enabled) missing.push('SHOPIFY_ENABLED=true');
    return {
      enabled: c.enabled,
      shopDomain: c.shopDomain,
      apiVersion: c.apiVersion,
      hasToken: c.accessToken.length > 0,
      isConfigured: missing.length === 0,
      missing,
    };
  }

  /** The last throttle position Shopify reported, for the UI and for pacing. */
  throttleState(): ShopifyThrottleState | null {
    return this.throttle;
  }

  /**
   * Run a read-only GraphQL query.
   *
   * `estimatedCost` paces the call before it is made. Shopify also reports the
   * real cost afterwards, which replaces the estimate for the next one.
   */
  async query<T>(
    query: string,
    variables: Record<string, unknown> = {},
    options: { readonly estimatedCost?: number } = {},
  ): Promise<T> {
    const config = this.resolveConfig();
    this.assertConfigured(config);
    this.assertReadOnly(query);

    const wait = throttleDelayMs(this.throttle, options.estimatedCost ?? 50);
    if (wait > 0) {
      this.logger.debug(`Pausing ${wait}ms for the Shopify cost budget to refill`);
      await sleep(wait);
    }

    const url = `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Shopify-Access-Token': config.accessToken,
        accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 429) {
      // Shopify asks for a specific wait; honouring it is cheaper than guessing.
      const retryAfter = Number(res.headers.get('retry-after') ?? '2');
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_RATE_LIMITED',
        message: `Shopify rate limit reached. Retry in ${retryAfter}s.`,
        details: { retryAfterSeconds: retryAfter },
      });
    }

    if (res.status === 401 || res.status === 403) {
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_UNAUTHORISED',
        message:
          'Shopify rejected the access token. It may be revoked, or it may lack the scopes this call needs.',
        details: { status: res.status, shopDomain: config.shopDomain },
      });
    }

    if (!res.ok) {
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_HTTP_ERROR',
        message: `Shopify returned HTTP ${res.status}`,
        details: { status: res.status },
      });
    }

    const body = (await res.json()) as ShopifyGraphqlResponse<T>;

    if (body.extensions?.cost?.throttleStatus) {
      this.throttle = body.extensions.cost.throttleStatus;
    }

    if (body.errors?.length) {
      // GraphQL reports business errors with HTTP 200, so this is where most
      // real failures surface — a missing scope included.
      const messages = body.errors.map((e) => e.message);
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_GRAPHQL_ERROR',
        message: messages.join('; '),
        details: {
          errors: body.errors.map((e) => ({ message: e.message, extensions: e.extensions })),
        },
      });
    }

    if (!body.data) {
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_EMPTY_RESPONSE',
        message: 'Shopify returned no data and no error',
      });
    }

    return body.data;
  }

  private assertConfigured(config: ShopifyConfig): void {
    const described = this.describe();
    if (!described.isConfigured) {
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_NOT_CONFIGURED',
        message: `Shopify is not configured. Set ${described.missing.join(', ')} in the environment.`,
        details: { missing: described.missing },
      });
    }
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(config.shopDomain)) {
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_BAD_SHOP_DOMAIN',
        message:
          'SHOPIFY_SHOP_DOMAIN must be the myshopify.com domain, e.g. dash-and-dot.myshopify.com',
        details: { shopDomain: config.shopDomain },
      });
    }
  }

  /**
   * Structurally refuse to send a mutation.
   *
   * Phase 4 reads; it does not write. Enforcing that in the transport means a
   * mutation cannot reach Shopify even by mistake, which is a different kind of
   * assurance from everyone remembering not to write one.
   */
  private assertReadOnly(query: string): void {
    const stripped = query.replace(/#[^\n]*/g, '').trimStart();
    if (/^\s*mutation\b/i.test(stripped)) {
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_WRITES_DISABLED',
        message:
          'This connector is read-only. Writing to Shopify needs explicit authorisation and its own reviewed path.',
      });
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
