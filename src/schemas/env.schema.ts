import { z } from 'zod';

const frontendOriginsSchema = z
  .string()
  .min(1)
  .transform((value) => value.split(',').map((origin) => origin.trim()))
  .pipe(z.array(z.url()).min(1))
  .transform((origins) => origins.map((origin) => new URL(origin).origin));

const optionalBooleanSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
}, z.boolean().optional());

export const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z.string().min(1).regex(/^mongodb(?:\+srv)?:\/\//),
  FRONTEND_URL: frontendOriginsSchema,
  SESSION_SECRET: z.string().min(32).optional(),
  COOKIE_NAME: z.string().min(1).default('chat_session'),
  COOKIE_SECURE: optionalBooleanSchema.default(false),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `- ${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}