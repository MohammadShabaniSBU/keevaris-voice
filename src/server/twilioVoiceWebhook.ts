import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parse as parseFormBody } from 'node:querystring'
import { config, resolveBridgeCredentials } from '../config.js'
import { logger } from '../logger.js'
import type { CallRegistry } from '../transport/twilio/CallRegistry.js'
import { isValidTwilioSignature } from '../transport/twilio/signature.js'
import { TWILIO_WS_PATH } from '../transport/twilio/TwilioTransport.js'
import { buildStreamTwiml } from '../transport/twilio/twiml.js'

function toWebSocketUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws')
}

function normalizeFormParams(raw: ReturnType<typeof parseFormBody>): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      params[key] = value
    } else if (Array.isArray(value) && value.length > 0) {
      params[key] = value[value.length - 1] ?? ''
    }
  }

  return params
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Array<Buffer> = []
  for await (const chunk of request) {
    chunks.push(chunk as Buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

export async function handleTwilioVoiceWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  callRegistry: CallRegistry
): Promise<void> {
  const rawBody = await readBody(request)
  const params = normalizeFormParams(parseFormBody(rawBody))
  const signature = request.headers['x-twilio-signature']

  if (!isValidTwilioSignature(url.toString(), params, signature)) {
    logger.warn({ callSid: params.CallSid }, 'twilio.invalid_signature')
    response.writeHead(403, { 'Content-Type': 'text/plain' })
    response.end('Invalid signature')

    return
  }

  const credentials = resolveBridgeCredentials(params.To ?? '')
  if (credentials === undefined) {
    logger.warn({ to: params.To, callSid: params.CallSid }, 'twilio.unknown_number')
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('Not found')

    return
  }

  const nonce = randomBytes(32).toString('hex')
  callRegistry.put(
    nonce,
    {
      callSid: params.CallSid ?? '',
      from: params.From ?? '',
      to: params.To ?? '',
      bridgeToken: credentials.bridgeToken,
      bridgeSecret: credentials.bridgeSecret,
      createdAt: Date.now()
    },
    config.callRegistry.ttlMs
  )

  const streamUrl = `${toWebSocketUrl(config.publicBaseUrl)}${TWILIO_WS_PATH}`
  const twiml = buildStreamTwiml(streamUrl, { nonce })

  logger.info({ callSid: params.CallSid, from: params.From }, 'twilio.voice_webhook')
  response.writeHead(200, { 'Content-Type': 'text/xml' })
  response.end(twiml)
}
