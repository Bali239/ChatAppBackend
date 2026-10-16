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
    GEMINI_API_KEY: z.string().min(1).optional(),
    FRONTEND_URL: frontendOriginsSchema,
    AUTH_TOKEN_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CALLBACK_URL: z.string().url().optional(),
    POST_LOGIN_REDIRECT_URL: z.string().url().optional(),
    POST_LOGOUT_REDIRECT_URL: z.string().url().optional(),
    AUTH_REDIRECT_ALLOWLIST: optionalUrlListSchema,
    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().min(1).optional(),
    CLOUDINARY_AVATAR_UPLOAD_PRESET: z.string().min(1).optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production') {
      const requiredValues = {
        AUTH_TOKEN_SECRET: environment.AUTH_TOKEN_SECRET,
        GOOGLE_CLIENT_ID: environment.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: environment.GOOGLE_CLIENT_SECRET,
        GOOGLE_CALLBACK_URL: environment.GOOGLE_CALLBACK_URL,
        POST_LOGIN_REDIRECT_URL: environment.POST_LOGIN_REDIRECT_URL,
        POST_LOGOUT_REDIRECT_URL: environment.POST_LOGOUT_REDIRECT_URL,
        CLOUDINARY_CLOUD_NAME: environment.CLOUDINARY_CLOUD_NAME,
        CLOUDINARY_API_KEY: environment.CLOUDINARY_API_KEY,
        CLOUDINARY_API_SECRET: environment.CLOUDINARY_API_SECRET,
        CLOUDINARY_AVATAR_UPLOAD_PRESET: environment.CLOUDINARY_AVATAR_UPLOAD_PRESET,
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
