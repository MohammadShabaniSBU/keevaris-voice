import type { Server } from 'node:http'
import { logger } from '../logger.js'
import type { ConnectionGate } from './ConnectionGate.js'
import type { ReadinessState } from './ReadinessState.js'

export interface GracefulShutdownDeps {
  server: Server
  connectionGate: ConnectionGate
  readiness: ReadinessState
  graceMs: number
  pollIntervalMs?: number
  exit?: (code: number) => void
  listen?: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * SIGTERM: flip readiness to 503, stop accepting new HTTP/upgrades, let
 * in-flight calls finish, then force-teardown leftovers with
 * `'server_shutdown'` so an armed transfer still completes.
 */
export function installGracefulShutdown(deps: GracefulShutdownDeps): () => Promise<void> {
  const exit = deps.exit ?? ((code: number) => process.exit(code))
  const pollIntervalMs = deps.pollIntervalMs ?? 250
  const listen = deps.listen !== false
  let shuttingDown = false

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    deps.readiness.startDraining()
    deps.server.close()

    const activeAtStart = deps.connectionGate.activeSessions.size
    logger.info({ activeSessions: activeAtStart, graceMs: deps.graceMs }, 'server.shutdown_started')

    if (activeAtStart === 0) {
      logger.info({}, 'server.shutdown_complete')
      exit(0)
      return
    }

    const deadline = Date.now() + deps.graceMs
    while (Date.now() < deadline && deps.connectionGate.activeSessions.size > 0) {
      await sleep(pollIntervalMs)
    }

    const remaining = [...deps.connectionGate.activeSessions]
    if (remaining.length > 0) {
      logger.info({ remaining: remaining.length }, 'server.shutdown_forcing_sessions')
      await Promise.allSettled(remaining.map((session) => session.teardown('server_shutdown')))
    }

    logger.info({}, 'server.shutdown_complete')
    exit(0)
  }

  if (listen) {
    process.on('SIGTERM', () => {
      void shutdown()
    })
  }

  return shutdown
}
