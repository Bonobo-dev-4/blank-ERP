import {
  Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/auth/guards';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ShopifyService } from './shopify.service';

const ORDER_TOPICS = new Set(['orders/create', 'orders/updated', 'orders/edited', 'orders/cancelled', 'orders/fulfilled']);

/** Shopify signs the exact bytes it sent; anything else is not Shopify. */
export function verifyShopifyHmac(rawBody: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!rawBody || !header || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Shopify order webhooks.
 *
 * The payload is used only for the order's id: the order is then re-read
 * through the same query and the same rules as every import, so a webhook can
 * never write anything an import would not. Answered at once — Shopify waits
 * five seconds — with the re-read done after.
 *
 * Registering the subscription is done in Shopify (Settings → Notifications →
 * Webhooks, or the admin API), which also issues SHOPIFY_WEBHOOK_SECRET.
 */
@ApiExcludeController()
@Controller('integrations/shopify/webhooks')
export class ShopifyWebhookController {
  private readonly logger = new Logger(ShopifyWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
  ) {}

  @Public()
  @Post('orders')
  @HttpCode(HttpStatus.OK)
  async orders(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') hmac: string | undefined,
    @Headers('x-shopify-topic') topic: string | undefined,
  ) {
    const secret = String(this.config.get('SHOPIFY_WEBHOOK_SECRET') ?? '');
    if (!verifyShopifyHmac(req.rawBody, hmac, secret)) {
      throw new UnauthorizedException({ code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Signature did not verify.' });
    }
    if (!topic || !ORDER_TOPICS.has(topic)) return { ignored: topic ?? null };

    const body = (req.body ?? {}) as { admin_graphql_api_id?: unknown };
    const gid = typeof body.admin_graphql_api_id === 'string' ? body.admin_graphql_api_id : null;
    if (!gid || !/^gid:\/\/shopify\/Order\/\d+$/.test(gid)) return { ignored: 'no order id' };

    // Single-organisation deployment: the one organisation with a Shopify connection.
    const connection = await this.prisma.integrationConnection.findFirst({
      where: { provider: 'SHOPIFY' }, orderBy: { createdAt: 'asc' }, select: { organizationId: true },
    });
    if (!connection) return { ignored: 'no Shopify connection' };

    void this.shopify.refreshOrders(connection.organizationId, null, [gid])
      .catch((e) => this.logger.warn(`Webhook refresh of ${gid} failed: ${e instanceof Error ? e.message : String(e)}`));
    return { accepted: true };
  }
}
