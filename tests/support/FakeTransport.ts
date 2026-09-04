import type { BridgeCredentials } from '../../src/config.js'
import type { AudioFormat, Transport, TransportCloseReason } from '../../src/transport/Transport.js'
import type { EventLog } from './EventLog.js'

export interface FakeTransportOptions {
  vendor: string
  sessionId: string
  callerNumber: string | null
  bridgeCredentials: BridgeCredentials
  audioInput: AudioFormat
  audioOutput: AudioFormat
}

/**
 * Transport double driven by the fixture runner. Records outbound calls
 * even after close so an ordering bug is a failed assertion, not a throw.
 */
export class FakeTransport implements Transport {
  readonly vendor: string
  readonly sessionId: string
  readonly callerNumber: string | null
  readonly bridgeCredentials: BridgeCredentials
  readonly audioInput: AudioFormat
  readonly audioOutput: AudioFormat

  private readonly audioHandlers: Array<(chunk: Buffer) => void> = []
  private readonly closeHandlers: Array<(reason: TransportCloseReason) => void> = []
  private closedReason: TransportCloseReason | undefined

  constructor(
    private readonly log: EventLog,
    options: FakeTransportOptions
  ) {
    this.vendor = options.vendor
    this.sessionId = options.sessionId
    this.callerNumber = options.callerNumber
    this.bridgeCredentials = options.bridgeCredentials
    this.audioInput = options.audioInput
    this.audioOutput = options.audioOutput
  }

  onAudio(handler: (chunk: Buffer) => void): void {
    this.audioHandlers.push(handler)
  }

  onClose(handler: (reason: TransportCloseReason) => void): void {
    this.closeHandlers.push(handler)
    if (this.closedReason !== undefined) {
      handler(this.closedReason)
    }
  }

  sendAudio(chunk: Buffer): void {
    this.log.push({ on: 'transport', kind: 'sendAudio', bytes: chunk.length })
  }

  clearAudio(): void {
    this.log.push({ on: 'transport', kind: 'clearAudio' })
  }

  async transfer(destinationNumber: string): Promise<void> {
    this.log.push({ on: 'transport', kind: 'transfer', destinationNumber })
    await this.close('transferred')
  }

  async close(reason: TransportCloseReason): Promise<void> {
    if (this.closedReason !== undefined) {
      return
    }

    this.log.push({ on: 'transport', kind: 'close', reason })
    this.emitClose(reason)
  }

  pushAudio(chunk: Buffer): void {
    for (const handler of this.audioHandlers) {
      handler(chunk)
    }
  }

  simulateClose(reason: TransportCloseReason): void {
    this.emitClose(reason)
  }

  private emitClose(reason: TransportCloseReason): void {
    if (this.closedReason !== undefined) return
    this.closedReason = reason
    for (const handler of this.closeHandlers) {
      handler(reason)
    }
  }
}
