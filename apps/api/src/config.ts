import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL: z.string().default('12h'),
  DATA_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_KEY must be 32 bytes, base64-encoded'),
  STAFF_API_KEY: z.string().min(8),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  PAYSTACK_BASE_URL: z.string().default('https://api.paystack.co'),
  EXPO_PUSH_URL: z.string().default('https://exp.host/--/api/v2/push/send'),
  /** Seconds the merged plan entitlements are cached per tenant. */
  ENTITLEMENTS_TTL_SECONDS: z.coerce.number().default(60),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol('CONFIG');
