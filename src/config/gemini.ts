import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';

export const GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.6-flash';

export const GEMINI_GENERATION_CONFIG = {
  temperature: 0.5,
  maxOutputTokens: 1_024,
} as const;

let cachedApiKey: string | null = null;
let cachedClient: GoogleGenAI | null = null;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export function getGeminiClient(apiKey: string): GoogleGenAI {
  if (cachedClient && cachedApiKey === apiKey) return cachedClient;

  cachedApiKey = apiKey;
  cachedClient = new GoogleGenAI({
    vertexai: false,
    apiKey,
    httpOptions: {
      timeout: 20_000,
      retryOptions: {
        attempts: 3,
        initialDelay: 1,
        maxDelay: 8,
        expBase: 2,
        jitter: 1,
        httpStatusCodes: [...RETRYABLE_STATUS_CODES],
      },
    },
  });

  return cachedClient;
}

function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = 'status' in error ? error.status : 'statusCode' in error ? error.statusCode : undefined;
  return typeof status === 'number' ? status : undefined;
}

type GeminiGenerationInput = Omit<GenerateContentParameters, 'model'>;

export async function generateGeminiContent(
  apiKey: string,
  input: GeminiGenerationInput,
) {
  const client = getGeminiClient(apiKey);
  try {
    return await client.models.generateContent({ ...input, model: GEMINI_MODEL });
  } catch (error) {
    const status = getHttpStatus(error);
    if (status === undefined || !RETRYABLE_STATUS_CODES.has(status)) throw error;

    console.warn('Primary Gemini model remained unavailable; trying fallback model', {
      primaryModel: GEMINI_MODEL,
      fallbackModel: GEMINI_FALLBACK_MODEL,
      status,
    });
    return client.models.generateContent({ ...input, model: GEMINI_FALLBACK_MODEL });
  }
}
