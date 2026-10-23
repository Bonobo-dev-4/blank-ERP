/**
 * @dnd/contracts - the API contract, shared by the NestJS backend and the
 * Next.js frontend.
 *
 * Zod schemas are the single source of truth: the backend validates requests
 * with them and generates its OpenAPI document from them, and the frontend
 * uses the same objects to validate forms. A field cannot drift between the
 * two because there is only one definition of it.
 */
export * from './common';
export * from './permissions';
export * from './navigation';
export * from './modules/auth';
export * from './modules/products';
export * from './modules/materials';
export * from './modules/inventory';
export * from './modules/purchasing';
export * from './modules/bom';
export * from './modules/manufacturing';
export * from './modules/production';
export * from './modules/quality';
export * from './modules/cutting';
export * from './modules/integrations';
