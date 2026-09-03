import pino from 'pino'

/**
 * Redact anything that could leak a secret into logs: bridge secret, Deepgram
 * key, Twilio auth token, and any header/field literally named that way.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'KEEVARIS_BRIDGE_SECRET',
      'apiKey',
      'authToken',
      'bridgeSecret',
      '*.apiKey',
      '*.authToken',
      '*.bridgeSecret',
      'headers["x-voice-bridge-secret"]',
      'headers.authorization'
    ],
    censor: '[redacted]'
  }
})

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings)
}
