import { z } from 'zod';

/**
 * Environment validation.
 *
 * The process refuses to start with a bad or missing configuration rather than
 * failing later on the first request. Secrets have no defaults: a deployment
 * that forgot to set JWT_ACCESS_SECRET must not quietly run with a known key.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_GLOBAL_PREFIX: z.string().default('api'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('900s'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_BUCKET: z.string().default('dnd-erp'),
  STORAGE_REGION: z.string().default('ap-south-1'),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),

  /**
   * Master switch for any call that MUTATES external inventory. Off by default
   * in every environment: a developer running this locally against production
   * credentials must not be one typo away from crediting real stock.
   */
  INTEGRATION_ALLOW_EXTERNAL_WRITES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  SHOPIFY_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SHOPIFY_SHOP_DOMAIN: z.string().optional(),
  SHOPIFY_ADMIN_API_VERSION: z.string().default('2025-07'),
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().optional(),
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  ASSISTANT_PROVIDER: z.enum(['anthropic', 'openai']).optional(),

  UNICOMMERCE_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  UNICOMMERCE_BASE_URL: z.string().optional(),
  UNICOMMERCE_CLIENT_ID: z.string().optional(),
  UNICOMMERCE_CLIENT_SECRET: z.string().optional(),
  UNICOMMERCE_USERNAME: z.string().optional(),
  UNICOMMERCE_PASSWORD: z.string().optional(),
  UNICOMMERCE_DEFAULT_FACILITY_CODE: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  isProduction: boolean;
};

export function loadConfiguration(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n`);
  }
  const env = parsed.data;

  // A production deployment must not run with the placeholder secrets from
  // .env.example.
  if (env.NODE_ENV === 'production') {
    for (const [key, value] of Object.entries({
      JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
    })) {
      if (value.startsWith('change-me')) {
        throw new Error(`${key} still holds its placeholder value; generate a real secret.`);
      }
    }
  }

  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
  };
}
