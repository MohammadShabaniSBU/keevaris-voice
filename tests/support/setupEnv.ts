/**
 * Loaded via `node --import ./tests/support/setupEnv.ts` before any test
 * file, so `src/config.ts` can parse env without throwing.
 *
 * TRANSFER_MAIN_LINE_NUMBER and TRANSFER_VOICEMAIL_NUMBER are load-bearing:
 * they default to '' in config.ts, and runTransfer short-circuits an empty
 * number to transport.close('error') instead of transport.transfer. Leaving
 * them unset would fail both transfer fixtures on missing config — and keep
 * failing that way even after V01-04 fixes the real bug.
 */
process.env.LOG_LEVEL ??= 'silent'
process.env.PUBLIC_BASE_URL ??= 'http://localhost:8787'
process.env.DEEPGRAM_API_KEY ??= 'test-deepgram-key'
process.env.KEEVARIS_API_URL ??= 'http://localhost:8000'
process.env.KEEVARIS_BRIDGE_TOKEN ??= 'test-bridge-token'
process.env.KEEVARIS_BRIDGE_SECRET ??= 'test-bridge-secret'
process.env.TRANSFER_MAIN_LINE_NUMBER ??= '+15550001000'
process.env.TRANSFER_VOICEMAIL_NUMBER ??= '+15550002000'
process.env.COMPANY_NAME ??= 'Keevaris'
process.env.WEB_TOKEN_SECRET ??= 'test-web-token-secret'
