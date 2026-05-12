import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Environment schema — all third-party keys are optional in development.
 * The server will start and serve /test/chat and dashboard APIs even without
 * telephony/STT/TTS credentials configured.
 */
const envSchema = z.object({
  // Server
  PORT: z.string().default('3000').transform(Number),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_KEY: z.string().default('dev-api-key'),

  // Database — optional in dev (uses in-memory fallback)
  DATABASE_URL: z.string().default(''),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Twilio (optional — only needed for real calls)
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_PHONE_NUMBER: z.string().default(''),
  TWILIO_WEBHOOK_BASE_URL: z.string().default('http://localhost:3000'),

  // Deepgram (optional — only needed for voice pipeline)
  DEEPGRAM_API_KEY: z.string().default(''),

  // Google Cloud TTS (optional — only needed for voice pipeline)
  GOOGLE_APPLICATION_CREDENTIALS: z.string().default('./google-credentials.json'),
  GOOGLE_TTS_VOICE_NAME: z.string().default('en-IN-Neural2-A'),
  GOOGLE_TTS_LANGUAGE_CODE: z.string().default('en-IN'),

  // Groq (Primary AI Engine)
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('llama3-8b-8192'),

  // Voice Pipeline
  STT_CONFIDENCE_THRESHOLD: z.string().default('0.5').transform(Number),
  MAX_LOW_CONFIDENCE_COUNT: z.string().default('3').transform(Number),
  AI_RESPONSE_TIMEOUT_MS: z.string().default('2500').transform(Number),
  MAX_CALL_RETRY_COUNT: z.string().default('2').transform(Number),
  RETRY_DELAY_MINUTES: z.string().default('30').transform(Number),
  INTER_CALL_DELAY_MS: z.string().default('2000').transform(Number),

  // Calling Hours
  CALLING_HOURS_START: z.string().default('09:00'),
  CALLING_HOURS_END: z.string().default('20:00'),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;

/** Check if a specific service is configured */
export const isConfigured = {
  database: () => env.DATABASE_URL.length > 0,
  twilio: () => env.TWILIO_ACCOUNT_SID.length > 0 && env.TWILIO_AUTH_TOKEN.length > 0,
  deepgram: () => env.DEEPGRAM_API_KEY.length > 0,
  groq: () => env.GROQ_API_KEY.length > 0,
  googleTts: () => env.GOOGLE_APPLICATION_CREDENTIALS.length > 0,
};
