import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { DeepgramVoiceAgent } from './agent/deepgram/DeepgramVoiceAgent.js'
import { config, defaultVoiceBridgePhoneNumber } from './config.js'
import { BridgeConfigClient } from './config/BridgeConfigClient.js'
import { KeevarisClient } from './delegation/KeevarisClient.js'
import { ConnectionRejectedError } from './errors.js'
import { logger } from './logger.js'
import { ConnectionGate } from './server/ConnectionGate.js'
import { handleTwilioVoiceWebhook } from './server/twilioVoiceWebhook.js'
import { VoiceSession } from './session/VoiceSession.js'
import { registerTransport, resolveTransportModule, type TransportModule } from './transport/registry.js'
import { InProcessCallRegistry } from './transport/twilio/CallRegistry.js'
import { createTwilioTransport, TWILIO_WS_PATH } from './transport/twilio/TwilioTransport.js'
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
      const minted = webTokenService.mint('dev-page', config.webToken.ttlMs, defaultVoiceBridgePhoneNumber)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(minted))

      return
    }

    if (request.method === 'POST' && url.pathname === '/twilio/voice') {
      await handleTwilioVoiceWebhook(request, response, url, callRegistry)

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
    const bridgeConfig = await new BridgeConfigClient(transport.bridgeCredentials).fetchConfig()
    const agent = new DeepgramVoiceAgent(transport.sessionId, {
      greeting: bridgeConfig.greeting,
      promptAdditions: bridgeConfig.promptAdditions
    })
    const keevaris = new KeevarisClient(transport.bridgeCredentials)

    const session = new VoiceSession({
      transport,
      agent,
      keevaris,
      filler: bridgeConfig.filler,
      transfer: bridgeConfig.transfer
    })
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
