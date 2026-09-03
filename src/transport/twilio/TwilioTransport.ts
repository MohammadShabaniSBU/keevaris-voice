import type { IncomingMessage } from 'node:http'
import twilioSdk from 'twilio'
import { config } from '../../config.js'
import { ConnectionRejectedError } from '../../errors.js'
import { logger } from '../../logger.js'
import type { RawSocket } from '../RawSocket.js'
import type { AudioFormat, Transport, TransportCloseReason } from '../Transport.js'
import type { CallRegistry } from './CallRegistry.js'
import { buildDialTwiml } from './twiml.js'

const AUDIO_FORMAT: AudioFormat = { encoding: 'mulaw', sampleRate: 8000 }

interface TwilioStartPayload {
  callSid: string
  streamSid: string
  customParameters?: Record<string, string>
}

/**
 * One Twilio call's bidirectional Media Stream
 * (`<Connect><Stream url="wss://.../twilio/media">`). `callSid` is Twilio's
 * own stable call id — that becomes `sessionId` — and the caller number is
 * resolved from the single-use nonce minted at the signature-validated
 * `/twilio/voice` webhook, never from client-supplied frame fields.
 */
export class TwilioTransport implements Transport {
  readonly vendor = 'twilio'
  readonly audioInput = AUDIO_FORMAT
  readonly audioOutput = AUDIO_FORMAT

  private _sessionId = ''
  private _callerNumber: string | null = null
  private streamSid = ''
  private readonly audioHandlers: Array<(chunk: Buffer) => void> = []
  private readonly closeHandlers: Array<(reason: TransportCloseReason) => void> = []
  private closed = false
  private readonly log = logger.child({ component: 'twilio-transport' })
  private readonly readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void

  constructor(
    private readonly ws: RawSocket,
    private readonly request: IncomingMessage,
    private readonly callRegistry: CallRegistry
  ) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
      ws.on('message', (data: Buffer) => this.handleMessage(data))
      ws.on('close', () => this.emitClose('caller_hangup'))
      ws.on('error', (error: Error) => {
        this.log.error({ error: error.message }, 'twilio.ws_error')
        this.emitClose('error')
      })
    })
  }

  get sessionId(): string {
    return this._sessionId
  }

  get callerNumber(): string | null {
    return this._callerNumber
  }

  /** Resolves once the `start` event has populated sessionId/callerNumber. */
  async ready(): Promise<void> {
    return this.readyPromise
  }

  onAudio(handler: (chunk: Buffer) => void): void {
    this.audioHandlers.push(handler)
  }

  onClose(handler: (reason: TransportCloseReason) => void): void {
    this.closeHandlers.push(handler)
  }

  sendAudio(chunk: Buffer): void {
    if (this.ws.readyState !== 1 || this.streamSid === '') return

    this.ws.send(
      JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: { payload: chunk.toString('base64') }
      })
    )
  }

  clearAudio(): void {
    if (this.ws.readyState !== 1 || this.streamSid === '') return

    this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }))
  }

  async transfer(destinationNumber: string): Promise<void> {
    if (config.twilio.accountSid === '' || config.twilio.authToken === '') {
      this.log.warn({ sessionId: this._sessionId }, 'twilio.transfer_skipped_no_credentials')
      await this.close('error')

      return
    }

    const client = twilioSdk(config.twilio.accountSid, config.twilio.authToken)

    try {
      await client.calls(this._sessionId).update({ twiml: buildDialTwiml(destinationNumber) })
    } catch (error) {
      this.log.error(
        { sessionId: this._sessionId, error: (error as Error).message },
        'twilio.transfer_failed'
      )
    } finally {
      await this.close('transferred')
    }
  }

  async close(reason: TransportCloseReason): Promise<void> {
    this.emitClose(reason)
    if (this.ws.readyState === 1) {
      this.ws.close()
    }
  }

  private handleMessage(data: Buffer): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(data.toString('utf8')) as Record<string, unknown>
    } catch {
      return
    }

    switch (message.event) {
      case 'start': {
        const start = message.start as TwilioStartPayload
        const nonce = start.customParameters?.nonce
        const entry = nonce !== undefined && nonce !== '' ? this.callRegistry.take(nonce) : undefined

        if (entry === undefined || entry.callSid !== start.callSid) {
          this.log.warn(
            {
              claimedCallSid: start.callSid,
              sourceAddress: this.request.socket?.remoteAddress
            },
            'twilio.rejected_start_frame'
          )
          // This close fires ws.on('close') above, which latches caller_hangup — not a security reason.
          this.ws.close(1008, 'policy violation')
          this.rejectReady(new ConnectionRejectedError('invalid nonce'))

          return
        }

        this._sessionId = start.callSid
        this.streamSid = start.streamSid
        this._callerNumber = entry.from
        this.log.info(
          { sessionId: this._sessionId, callerNumber: this._callerNumber },
          'twilio.stream_started'
        )
        this.resolveReady()
        break
      }
      case 'media': {
        const media = message.media as { payload: string }
        const chunk = Buffer.from(media.payload, 'base64')
        for (const handler of this.audioHandlers) handler(chunk)
        break
      }
      case 'stop':
        this.emitClose('caller_hangup')
        break
      default:
        break
    }
  }

  private emitClose(reason: TransportCloseReason): void {
    if (this.closed) return
    this.closed = true
    for (const handler of this.closeHandlers) handler(reason)
  }
}

export const TWILIO_WS_PATH = '/twilio/media'

/**
 * Factory used by the transport registry. Waits for the `start` event so the
 * `Transport` it hands back always has `sessionId`/`callerNumber` populated.
 */
export async function createTwilioTransport(
  ws: RawSocket,
  request: IncomingMessage,
  callRegistry: CallRegistry
): Promise<TwilioTransport> {
  const transport = new TwilioTransport(ws, request, callRegistry)
  await transport.ready()

  return transport
}
