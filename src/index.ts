import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { parse as parseFormBody } from 'node:querystring'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { DeepgramVoiceAgent } from './agent/deepgram/DeepgramVoiceAgent.js'
import { config } from './config.js'
import { KeevarisClient } from './delegation/KeevarisClient.js'
import { ConnectionRejectedError } from './errors.js'
import { logger } from './logger.js'
import { ConnectionGate } from './server/ConnectionGate.js'
import { VoiceSession } from './session/VoiceSession.js'
import { registerTransport, resolveTransportModule, type TransportModule } from './transport/registry.js'
import { InProcessCallRegistry } from './transport/twilio/CallRegistry.js'
import { createTwilioTransport, TWILIO_WS_PATH } from './transport/twilio/TwilioTransport.js'
import { isValidTwilioSignature } from './transport/twilio/signature.js'
import { buildStreamTwiml } from './transport/twilio/twiml.js'
import { WebTokenService } from './transport/web/WebToken.js'
import { createWebTransport, WEB_WS_PATH } from './transport/web/WebTransport.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(currentDir, '..', 'public')

const callRegistry = new InProcessCallRegistry()
const webTokenService = new WebTokenService(config.webToken.secret)
const connectionGate = new ConnectionGate(config.maxConcurrentSessions)

registerTransport({
  vendor: 'twilio',
  wsPath: TWILIO_WS_PATH,
  createTransport: (ws, request) => createTwilioTransport(ws, request, callRegistry)
})
registerTransport({
  vendor: 'web',
  wsPath: WEB_WS_PATH,
  createTransport: (ws, request) => createWebTransport(ws, request, webTokenService)
})

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

async function handleTwilioVoiceWebhook(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const rawBody = await readBody(request)
  const params = normalizeFormParams(parseFormBody(rawBody))
  const signature = request.headers['x-twilio-signature']

  if (!isValidTwilioSignature(url.toString(), params, signature)) {
    logger.warn({ callSid: params.CallSid }, 'twilio.invalid_signature')
    response.writeHead(403, { 'Content-Type': 'text/plain' })
    response.end('Invalid signature')

    return
  }

  const nonce = randomBytes(32).toString('hex')
  callRegistry.put(
    nonce,
    {
      callSid: params.CallSid ?? '',
      from: params.From ?? '',
      to: params.To ?? '',
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

async function handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', config.publicBaseUrl)

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok' }))

      return
    }

    if (config.allowDevPage && request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dev.html')) {
      const html = await readFile(path.join(publicDir, 'dev.html'), 'utf8')
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(html)

      return
    }

    if (config.allowDevPage && request.method === 'GET' && url.pathname === '/dev/token') {
      const minted = webTokenService.mint('dev-page', config.webToken.ttlMs)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(minted))

      return
    }

    if (request.method === 'POST' && url.pathname === '/twilio/voice') {
      await handleTwilioVoiceWebhook(request, response, url)

      return
    }

    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('Not found')
  } catch (error) {
    logger.error({ error: (error as Error).message, path: url.pathname }, 'http.request_failed')
    response.writeHead(500, { 'Content-Type': 'text/plain' })
    response.end('Internal error')
  }
}

async function handleTransportConnection(module: TransportModule, ws: WebSocket, request: IncomingMessage): Promise<void> {
  const connectionId = randomUUID()

  try {
    const transport = await module.createTransport(ws, request)
    const agent = new DeepgramVoiceAgent(transport.sessionId, config.companyName)
    const keevaris = new KeevarisClient()

    const session = new VoiceSession({ transport, agent, keevaris, companyName: config.companyName })
    await session.start()
  } catch (error) {
    if (!(error instanceof ConnectionRejectedError)) {
      logger.error(
        { connectionId, vendor: module.vendor, error: (error as Error).message },
        'transport.connection_failed'
      )
    }
    ws.close()
  }
}

const server = createServer((request, response) => {
  void handleHttpRequest(request, response)
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', config.publicBaseUrl).pathname
  const module = resolveTransportModule(pathname)

  if (module === undefined) {
    socket.destroy()

    return
  }

  if (!connectionGate.tryAcquire()) {
    logger.warn(
      {
        active: connectionGate.activeCount,
        limit: config.maxConcurrentSessions,
        pathname
      },
      'server.concurrency_ceiling_reached'
    )
    socket.destroy()

    return
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.on('close', () => connectionGate.release())
    void handleTransportConnection(module, ws, request)
  })
})

server.listen(config.port, () => {
  logger.info({ port: config.port, publicBaseUrl: config.publicBaseUrl }, 'keevaris-voice.listening')
})
