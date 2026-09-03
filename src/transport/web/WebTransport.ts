import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { WebSocket } from 'ws'
import { logger } from '../../logger.js'
import type { AudioFormat, Transport, TransportCloseReason } from '../Transport.js'

const AUDIO_INPUT: AudioFormat = { encoding: 'linear16', sampleRate: 16000 }
const AUDIO_OUTPUT: AudioFormat = { encoding: 'linear16', sampleRate: 24000 }

/**
 * Browser mic session (panel copilot, or `public/dev.html` for local
 * testing). No phone system in the middle, so there is no caller number and
 * no separate "ringing" webhook step — the session id is minted the moment
 * the socket connects, and the connection carries raw PCM16 audio directly.
 *
 * Wire protocol on this socket:
 *  - binary frames: PCM16 audio (mic in from the browser, agent audio out)
 *  - text frames: JSON control messages, currently only `{"type":"clear"}`
 *    sent server -> client on barge-in, to flush queued playback.
 */
export class WebTransport implements Transport {
  readonly vendor = 'web'
  readonly audioInput = AUDIO_INPUT
  readonly audioOutput = AUDIO_OUTPUT
  readonly sessionId: string
  readonly callerNumber: string | null = null

  private readonly audioHandlers: Array<(chunk: Buffer) => void> = []
  private readonly closeHandlers: Array<(reason: TransportCloseReason) => void> = []
  private closed = false
  private readonly log

  constructor(private readonly ws: WebSocket, _request: IncomingMessage) {
    this.sessionId = randomUUID()
    this.log = logger.child({ component: 'web-transport', sessionId: this.sessionId })

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        for (const handler of this.audioHandlers) handler(data)
      }
      // Text frames from the browser are reserved for future control
      // messages (e.g. mic mute); there are none to handle yet.
    })

    ws.on('close', () => this.emitClose('caller_hangup'))
    ws.on('error', (error: Error) => {
      this.log.error({ error: error.message }, 'web.ws_error')
      this.emitClose('error')
    })
  }

  onAudio(handler: (chunk: Buffer) => void): void {
    this.audioHandlers.push(handler)
  }

  onClose(handler: (reason: TransportCloseReason) => void): void {
    this.closeHandlers.push(handler)
  }

  sendAudio(chunk: Buffer): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk)
    }
  }

  clearAudio(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'clear' }))
    }
  }

  /**
   * There is no telephony leg to redirect — "transfer" for the web
   * transport just means ending the session; a human handoff on this
   * surface is a panel/inbox concern, not a media-layer one.
   */
  async transfer(_destinationNumber: string): Promise<void> {
    await this.close('transferred')
  }

  async close(reason: TransportCloseReason): Promise<void> {
    this.emitClose(reason)
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close()
    }
  }

  private emitClose(reason: TransportCloseReason): void {
    if (this.closed) return
    this.closed = true
    for (const handler of this.closeHandlers) handler(reason)
  }
}

export const WEB_WS_PATH = '/web/media'

export async function createWebTransport(ws: WebSocket, request: IncomingMessage): Promise<WebTransport> {
  return new WebTransport(ws, request)
}
