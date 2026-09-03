import { z } from 'zod'

/**
 * Every value the process needs, validated once at boot. Fail fast and loud
 * rather than discovering a missing secret mid-call.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_BASE_URL: z.string().url(),

  DEEPGRAM_API_KEY: z.string().min(1, 'DEEPGRAM_API_KEY is required'),
  DEEPGRAM_THINK_PROVIDER: z.string().default('open_ai'),
  DEEPGRAM_THINK_MODEL: z.string().default('gpt-4o-mini'),
  DEEPGRAM_LISTEN_MODEL: z.string().default('flux-general-en'),
  DEEPGRAM_SPEAK_MODEL: z.string().default('aura-2-thalia-en'),
  // 8s per https://developers.deepgram.com/docs/agent-keep-alive
  DEEPGRAM_KEEPALIVE_INTERVAL_MS: z.coerce.number().int().positive().default(8_000),

  KEEVARIS_API_URL: z.string().url(),
  KEEVARIS_BRIDGE_TOKEN: z.string().min(1, 'KEEVARIS_BRIDGE_TOKEN is required'),
  KEEVARIS_BRIDGE_SECRET: z.string().min(1, 'KEEVARIS_BRIDGE_SECRET is required'),
  KEEVARIS_BRIDGE_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),

  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_VALIDATE_SIGNATURE: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),

  TRANSFER_MAIN_LINE_NUMBER: z.string().default(''),
  TRANSFER_VOICEMAIL_NUMBER: z.string().default(''),

  // Placeholder until the greeting is served from unit-hq-api and can carry
  // the operator's real registered name per VoiceBridgeCustomerConfig.
  COMPANY_NAME: z.string().default('Keevaris'),

  ALLOW_DEV_PAGE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  WEB_TOKEN_SECRET: z.string().min(1, 'WEB_TOKEN_SECRET is required'),
  WEB_TOKEN_TTL_MS: z.coerce.number().int().positive().default(300_000),
  CALL_REGISTRY_TTL_MS: z.coerce.number().int().positive().default(60_000),
  MAX_CONCURRENT_SESSIONS: z.coerce.number().int().positive().default(20),
  MAX_CALL_SECONDS: z.coerce.number().int().positive().default(1800),
  IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300)
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  return parsed.data
}

export const env = loadEnv()

export const config = {
  port: env.PORT,
  publicBaseUrl: env.PUBLIC_BASE_URL,

  deepgram: {
    apiKey: env.DEEPGRAM_API_KEY,
    thinkProvider: env.DEEPGRAM_THINK_PROVIDER,
    thinkModel: env.DEEPGRAM_THINK_MODEL,
    listenModel: env.DEEPGRAM_LISTEN_MODEL,
    speakModel: env.DEEPGRAM_SPEAK_MODEL,
    // 8s per https://developers.deepgram.com/docs/agent-keep-alive
    keepAliveIntervalMs: env.DEEPGRAM_KEEPALIVE_INTERVAL_MS
  },

  keevaris: {
    apiUrl: env.KEEVARIS_API_URL,
    bridgeToken: env.KEEVARIS_BRIDGE_TOKEN,
    bridgeSecret: env.KEEVARIS_BRIDGE_SECRET,
    timeoutMs: env.KEEVARIS_BRIDGE_TIMEOUT_MS
  },

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    validateSignature: env.TWILIO_VALIDATE_SIGNATURE
  },

  transfer: {
    mainLineNumber: env.TRANSFER_MAIN_LINE_NUMBER,
    voicemailNumber: env.TRANSFER_VOICEMAIL_NUMBER
  },

  companyName: env.COMPANY_NAME,

  allowDevPage: env.ALLOW_DEV_PAGE,

  webToken: {
    secret: env.WEB_TOKEN_SECRET,
    ttlMs: env.WEB_TOKEN_TTL_MS
  },

  callRegistry: {
    ttlMs: env.CALL_REGISTRY_TTL_MS
  },

  maxConcurrentSessions: env.MAX_CONCURRENT_SESSIONS,

  session: {
    maxCallMs: env.MAX_CALL_SECONDS * 1000,
    idleTimeoutMs: env.IDLE_TIMEOUT_SECONDS * 1000
  }
} as const
