-- Shopify order detail: contact, ship-to, price breakdown, and per-line
-- product identity. Additive and nullable; existing rows fill on next import.
ALTER TABLE "shopify_orders"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "customerExternalId" TEXT,
  ADD COLUMN "shippingCity" TEXT,
  ADD COLUMN "shippingProvince" TEXT,
  ADD COLUMN "shippingZip" TEXT,
  ADD COLUMN "shippingCountry" TEXT,
  ADD COLUMN "subtotalAmount" DECIMAL(18,2),
  ADD COLUMN "discountAmount" DECIMAL(18,2),
  ADD COLUMN "shippingAmount" DECIMAL(18,2),
  ADD COLUMN "taxAmount" DECIMAL(18,2),
  ADD COLUMN "refundedAmount" DECIMAL(18,2),
  ADD COLUMN "paymentGateways" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "discountCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "closedAt" TIMESTAMP(3);

ALTER TABLE "shopify_order_lines"
  ADD COLUMN "externalProductId" TEXT,
  ADD COLUMN "variantTitle" TEXT,
  ADD COLUMN "vendor" TEXT,
  ADD COLUMN "barcode" TEXT,
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "unitPrice" DECIMAL(18,2),
  ADD COLUMN "discountedUnitPrice" DECIMAL(18,2),
  ADD COLUMN "totalDiscount" DECIMAL(18,2);

CREATE INDEX "shopify_orders_organizationId_shippingZip_idx" ON "shopify_orders"("organizationId", "shippingZip");
CREATE INDEX "shopify_order_lines_organizationId_externalProductId_idx" ON "shopify_order_lines"("organizationId", "externalProductId");
