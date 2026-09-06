import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Redis } from 'ioredis'
import { WebSocket, WebSocketServer } from 'ws'
import { DeepgramVoiceAgent } from './agent/deepgram/DeepgramVoiceAgent.js'
import { config, defaultVoiceBridgePhoneNumber } from './config.js'
import { BridgeConfigClient } from './config/BridgeConfigClient.js'
import { KeevarisClient } from './delegation/KeevarisClient.js'
import { ConnectionRejectedError } from './errors.js'
import { logger } from './logger.js'
import { ConnectionGate } from './server/ConnectionGate.js'
import { DependencyHealth } from './server/DependencyHealth.js'
import { installGracefulShutdown } from './server/GracefulShutdown.js'
import { ReadinessState } from './server/ReadinessState.js'
import { handleTwilioVoiceWebhook } from './server/twilioVoiceWebhook.js'
import { SessionLifecycleClient } from './session/SessionLifecycleClient.js'
import { TranscriptClient } from './session/TranscriptClient.js'
import { VoiceSession } from './session/VoiceSession.js'
import { registerTransport, resolveTransportModule, type TransportModule } from './transport/registry.js'
import { InProcessCallRegistry, type CallRegistry } from './transport/twilio/CallRegistry.js'
import { RedisCallRegistry } from './transport/twilio/RedisCallRegistry.js'
import { createTwilioTransport, TWILIO_WS_PATH } from './transport/twilio/TwilioTransport.js'
import { WebTokenService } from './transport/web/WebToken.js'
import { createWebTransport, WEB_WS_PATH } from './transport/web/WebTransport.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(currentDir, '..', 'public')

function createCallRegistry(): CallRegistry {
  if (config.callRegistry.backend !== 'redis') {
    return new InProcessCallRegistry()
  }

  const redis = new Redis(config.callRegistry.redisUrl as string)
  redis.on('error', (error: Error) => {
    logger.error({ error: error.message }, 'redis.client_error')
  })

  return new RedisCallRegistry(redis)
}

const callRegistry = createCallRegistry()
const webTokenService = new WebTokenService(config.webToken.secret)
const connectionGate = new ConnectionGate(config.maxConcurrentSessions)
const dependencyHealth = new DependencyHealth(
  config.dependencyHealth.staleAfterMs,
  config.dependencyHealth.sweepIntervalMs
)
dependencyHealth.startSweeping()
const readiness = new ReadinessState(dependencyHealth)

function writeLive(response: ServerResponse): void {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ status: 'ok' }))
}

function writeReady(response: ServerResponse): void {
  if (readiness.isReady()) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok' }))
    return
  }

  response.writeHead(503, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ status: 'not_ready' }))
}

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
    if (request.method === 'GET' && url.pathname === '/health/ready') {
      writeReady(response)
      return
    }

    if (
      request.method === 'GET' &&
      (url.pathname === '/health' || url.pathname === '/health/live')
    ) {
      writeLive(response)
      return
    }

    if (config.allowDevPage && request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dev.html')) {
      const html = await readFile(path.join(publicDir, 'dev.html'), 'utf8')
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(html)

      return
    }

    if (config.allowDevPage && request.method === 'GET' && url.pathname === '/dev/token') {
      const raw = url.searchParams.get('caller_number')
      const callerNumber = raw !== null && raw.trim() !== '' ? raw.trim() : null
      const minted = webTokenService.mint(
        'dev-page',
        config.webToken.ttlMs,
        defaultVoiceBridgePhoneNumber,
        callerNumber
      )
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

async function handleTransportConnection(
  module: TransportModule,
  ws: WebSocket,
  request: IncomingMessage
): Promise<VoiceSession | undefined> {
  const connectionId = randomUUID()

  try {
    const transport = await module.createTransport(ws, request)
    const sessionLifecycle = new SessionLifecycleClient(transport.bridgeCredentials)
    const transcript = new TranscriptClient(transport.bridgeCredentials)
    const [bridgeConfig] = await Promise.all([
      new BridgeConfigClient(transport.bridgeCredentials, dependencyHealth).fetchConfig(),
      sessionLifecycle.open(transport.sessionId, transport.callerNumber)
    ])
    const agent = new DeepgramVoiceAgent(
      transport.sessionId,
      {
        greeting: bridgeConfig.greeting,
        promptAdditions: bridgeConfig.promptAdditions
      },
      undefined,
      dependencyHealth
    )
    const keevaris = new KeevarisClient(transport.bridgeCredentials, dependencyHealth)

    const session = new VoiceSession({
      transport,
      agent,
      keevaris,
      sessionLifecycle,
      transcript,
      filler: bridgeConfig.filler,
      transfer: bridgeConfig.transfer
    })
    await session.start()
    return session
  } catch (error) {
    if (!(error instanceof ConnectionRejectedError)) {
      logger.error(
        { connectionId, vendor: module.vendor, error: (error as Error).message },
        'transport.connection_failed'
      )
    }
    ws.close()
    return undefined
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
    let closed = false
    let session: VoiceSession | undefined

    ws.on('close', () => {
      closed = true
      connectionGate.release()
      if (session !== undefined) {
        connectionGate.unregisterSession(session)
      }
    })

    void handleTransportConnection(module, ws, request).then((created) => {
      if (created === undefined) {
        return
      }

      session = created
      if (!closed) {
        connectionGate.registerSession(created)
      }
    })
  })
})

installGracefulShutdown({
  server,
  connectionGate,
  readiness,
  graceMs: config.shutdown.graceMs
})

server.listen(config.port, () => {
  logger.info({ port: config.port, publicBaseUrl: config.publicBaseUrl }, 'keevaris-voice.listening')
})
