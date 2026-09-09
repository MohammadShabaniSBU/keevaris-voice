import { readFileSync } from 'node:fs'
import type { Transport } from '../transport/Transport.js'

const FRAME_MS = 20

const CLIPS: Record<Transport['audioOutput']['encoding'], Buffer> = {
  mulaw: readFileSync(new URL('../assets/filler/typing.mulaw', import.meta.url)),
  linear16: readFileSync(new URL('../assets/filler/typing.linear16', import.meta.url))
}

function bytesPerFrame(format: Transport['audioOutput']): number {
  const bytesPerSample = format.encoding === 'linear16' ? 2 : 1
  return Math.round((format.sampleRate * bytesPerSample * FRAME_MS) / 1000)
}

/**
 * Loops a pre-encoded, transport-matched clip onto `transport.sendAudio`
 * until `stop()` is called. Never resamples; picks the clip that already
 * matches `transport.audioOutput`.
 */
export class FillerSound {
  private timer: ReturnType<typeof setInterval> | undefined
  private offset = 0

  start(transport: Transport): void {
    if (this.timer !== undefined) return

    const clip = CLIPS[transport.audioOutput.encoding]
    const frameBytes = bytesPerFrame(transport.audioOutput)
    this.offset = 0

    this.timer = setInterval(() => {
      const end = Math.min(this.offset + frameBytes, clip.length)
      transport.sendAudio(clip.subarray(this.offset, end))
      this.offset = end >= clip.length ? 0 : end
    }, FRAME_MS)
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.offset = 0
  }

  get isPlaying(): boolean {
    return this.timer !== undefined
  }
}
