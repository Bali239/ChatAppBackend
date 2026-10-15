import { z } from 'zod';

const commaSeparatedStringSchema = z
  .string()
  .min(1)
  .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean));

const frontendOriginsSchema = z
  .string()
  .min(1)
  .transform((value) => value.split(',').map((origin) => origin.trim()))
  .pipe(z.array(z.url()).min(1))
  .superRefine((origins, context) => {
    origins.forEach((origin, index) => {
      const url = new URL(origin);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: 'Each value must be an HTTP(S) origin without a path, query, or fragment',
        });
      }
    });
  })
  .transform((origins) => origins.map((origin) => new URL(origin).origin));

const optionalBooleanSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
}, z.boolean().optional());

const optionalUrlListSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  },
  z.array(z.string().url()).optional(),
);

export const environmentSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    MONGODB_URI: z.string().min(1).regex(/^mongodb(?:\+srv)?:\/\//),
    FRONTEND_URL: frontendOriginsSchema,
    SESSION_SECRET: z.string().min(32).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CALLBACK_URL: z.string().url().optional(),
    POST_LOGIN_REDIRECT_URL: z.string().url().optional(),
    POST_LOGOUT_REDIRECT_URL: z.string().url().optional(),
    AUTH_REDIRECT_ALLOWLIST: optionalUrlListSchema,
    SESSION_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1).default(7 * 24 * 60 * 60 * 1000),
    SESSION_ABSOLUTE_TIMEOUT_MS: z.coerce.number().int().min(1).default(30 * 24 * 60 * 60 * 1000),
    COOKIE_NAME: z.string().min(1).default('__Host-chat_session'),
    COOKIE_SECURE: optionalBooleanSchema.default(false),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((environment, context) => {
    if (environment.COOKIE_SAME_SITE === 'none' && !environment.COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true when COOKIE_SAME_SITE is none',
      });
    }

    if (environment.NODE_ENV === 'production') {
      if (!environment.COOKIE_SECURE) {
        context.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'must be true in production',
        });
      }

      const requiredValues = {
        SESSION_SECRET: environment.SESSION_SECRET,
        GOOGLE_CLIENT_ID: environment.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: environment.GOOGLE_CLIENT_SECRET,
        GOOGLE_CALLBACK_URL: environment.GOOGLE_CALLBACK_URL,
        POST_LOGIN_REDIRECT_URL: environment.POST_LOGIN_REDIRECT_URL,
        POST_LOGOUT_REDIRECT_URL: environment.POST_LOGOUT_REDIRECT_URL,
      } satisfies Record<string, string | undefined>;

      Object.entries(requiredValues).forEach(([key, value]) => {
        if (!value || value.trim() === '') {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required in production',
          });
        }
      });

      if (!environment.AUTH_REDIRECT_ALLOWLIST || environment.AUTH_REDIRECT_ALLOWLIST.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['AUTH_REDIRECT_ALLOWLIST'],
          message: 'must include at least one approved redirect URL in production',
        });
      }

      environment.FRONTEND_URL.forEach((origin, index) => {
        if (!origin.startsWith('https://')) {
          context.addIssue({
            code: 'custom',
            path: ['FRONTEND_URL', index],
            message: 'production origins must use HTTPS',
          });
        }
      });

      if (environment.GOOGLE_CALLBACK_URL && !environment.GOOGLE_CALLBACK_URL.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_CALLBACK_URL'],
          message: 'must use HTTPS in production',
        });
      }

      if (environment.POST_LOGIN_REDIRECT_URL && !environment.POST_LOGIN_REDIRECT_URL.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: ['POST_LOGIN_REDIRECT_URL'],
          message: 'must use HTTPS in production',
        });
      }

      if (environment.POST_LOGOUT_REDIRECT_URL && !environment.POST_LOGOUT_REDIRECT_URL.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: ['POST_LOGOUT_REDIRECT_URL'],
          message: 'must use HTTPS in production',
        });
      }

      const redirectAllowlist = environment.AUTH_REDIRECT_ALLOWLIST ?? [];
      redirectAllowlist.forEach((target, index) => {
        if (!target.startsWith('https://')) {
          context.addIssue({
            code: 'custom',
            path: ['AUTH_REDIRECT_ALLOWLIST', index],
            message: 'must use HTTPS in production',
          });
        }
      });
    }
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