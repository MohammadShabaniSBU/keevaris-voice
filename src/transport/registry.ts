import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import type { Transport } from './Transport.js'

/**
 * What a vendor plugs in to be usable by `VoiceSession`: a WS upgrade path
 * for its media stream, and a factory that turns the raw connection into a
 * `Transport`. Adding a new call vendor (Telnyx, LiveKit, ...) means writing
 * one module like this and calling `registerTransport` once at boot —
 * nothing else in the app needs to change.
 */
export interface TransportModule {
  vendor: string
  /** WS upgrade path this vendor's media stream connects on, e.g. `/twilio/media`. */
  wsPath: string
  createTransport(ws: WebSocket, request: IncomingMessage): Transport | Promise<Transport>
}

const modulesByPath = new Map<string, TransportModule>()

export function registerTransport(module: TransportModule): void {
  modulesByPath.set(module.wsPath, module)
}

export function resolveTransportModule(pathname: string): TransportModule | undefined {
  return modulesByPath.get(pathname)
}

export function registeredTransports(): Array<TransportModule> {
  return Array.from(modulesByPath.values())
}
