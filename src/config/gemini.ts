import { GoogleGenAI } from '@google/genai';

export const GEMINI_MODEL = 'gemini-3.8-flash';

export const GEMINI_GENERATION_CONFIG = {
  temperature: 0.5,
  maxOutputTokens: 1_024,
} as const;

let cachedApiKey: string | null = null;
let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(apiKey: string): GoogleGenAI {
  if (cachedClient && cachedApiKey === apiKey) return cachedClient;

  cachedApiKey = apiKey;
  cachedClient = new GoogleGenAI({
    vertexai: false,
    apiKey,
    httpOptions: {
      timeout: 30_000,
      retryOptions: {
        attempts: 2,
        initialDelay: 0.5,
        maxDelay: 3,
        httpStatusCodes: [429, 500, 502, 503, 504],
      },
    },
  });

  return cachedClient;
}
