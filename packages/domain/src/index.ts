/**
 * @dnd/domain - pure manufacturing business logic.
 *
 * Everything in this package is framework-free and database-free: no Prisma,
 * no Nest, no HTTP. That is deliberate. The quantity invariants are the part of
 * this ERP that must not be wrong, so they live where they can be exercised
 * exhaustively in milliseconds, and the service layer is reduced to locking
 * rows, calling these functions, and persisting the deltas they return.
 */

export * from './decimal';
export * from './errors';
export * from './uom';
export * from './numbering';

export * from './inventory/locations';
export * from './inventory/ledger';
export * from './inventory/availability';
export * from './inventory/reservations';
export * from './inventory/rolls';

export * from './purchasing/receipt';

export * from './bom/explode';
export * from './mrp/plan';
export * from './manufacturing/order-lifecycle';

export * from './production/stage-ledger';
export * from './production/barcode';
export * from './production/serialization';

export * from './quality/qc';
export * from './finished-goods/inward';

export * from './integrations/dedupe';
export * from './integrations/shopify-order';
export * from './integrations/shopify-order-details';
export * from './integrations/push';

export * from './costing/rollup';
export * from './forecasting/replenishment';
export * from './integrations/unicommerce';
export * from './integrations/shopify-product';
export * from './fulfilment/route';
