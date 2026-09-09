import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FillerSound } from '../../src/session/FillerSound.js'
import type { AudioFormat } from '../../src/transport/Transport.js'
import { EventLog } from '../support/EventLog.js'
import { FakeTransport } from '../support/FakeTransport.js'

const FRAME_MS = 20

const MULAW: AudioFormat = { encoding: 'mulaw', sampleRate: 8000 }
const LINEAR16: AudioFormat = { encoding: 'linear16', sampleRate: 24000 }

function bytesPerFrame(format: AudioFormat): number {
  const bytesPerSample = format.encoding === 'linear16' ? 2 : 1
  return Math.round((format.sampleRate * bytesPerSample * FRAME_MS) / 1000)
}

function transportFor(output: AudioFormat): { log: EventLog; transport: FakeTransport } {
  const log = new EventLog()
  const transport = new FakeTransport(log, {
    vendor: output.encoding === 'mulaw' ? 'twilio' : 'web',
    sessionId: 'sess_filler',
    callerNumber: '+15555550100',
    bridgeCredentials: { bridgeToken: 't', bridgeSecret: 's' },
    audioInput: output,
    audioOutput: output
  })
  return { log, transport }
}

function sendAudioBytes(log: EventLog): Array<number> {
  return log.entries.filter((entry) => entry.kind === 'sendAudio').map((entry) => entry.bytes as number)
}

test('mulaw 8 kHz sends 160-byte frames on a 20 ms cadence', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const { log, transport } = transportFor(MULAW)
  const player = new FillerSound()

  player.start(transport)
  assert.equal(player.isPlaying, true)
  assert.equal(sendAudioBytes(log).length, 0)

  t.mock.timers.tick(FRAME_MS)
  assert.deepEqual(sendAudioBytes(log), [bytesPerFrame(MULAW)])

  t.mock.timers.tick(FRAME_MS * 4)
  assert.equal(sendAudioBytes(log).length, 5)
  assert.ok(sendAudioBytes(log).every((bytes) => bytes === bytesPerFrame(MULAW)))

  player.stop()
})

test('linear16 24 kHz sends 960-byte frames on a 20 ms cadence', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const { log, transport } = transportFor(LINEAR16)
  const player = new FillerSound()

  player.start(transport)
  t.mock.timers.tick(FRAME_MS * 3)
  assert.deepEqual(sendAudioBytes(log), [
    bytesPerFrame(LINEAR16),
    bytesPerFrame(LINEAR16),
    bytesPerFrame(LINEAR16)
  ])

  player.stop()
})

test('loops back to the start of the clip when it is exhausted', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const { log, transport } = transportFor(MULAW)
  const player = new FillerSound()
  const frame = bytesPerFrame(MULAW)
  const clipLength = 78848
  const framesToWrap = Math.ceil(clipLength / frame)

  player.start(transport)
  t.mock.timers.tick(FRAME_MS * framesToWrap)
  const beforeWrap = sendAudioBytes(log)
  assert.equal(beforeWrap.length, framesToWrap)
  assert.equal(beforeWrap[beforeWrap.length - 1], clipLength % frame)

  t.mock.timers.tick(FRAME_MS)
  const afterWrap = sendAudioBytes(log)
  assert.equal(afterWrap.length, framesToWrap + 1)
  assert.equal(afterWrap[afterWrap.length - 1], frame)

  player.stop()
})

test('stop() halts further sendAudio calls', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const { log, transport } = transportFor(MULAW)
  const player = new FillerSound()

  player.start(transport)
  t.mock.timers.tick(FRAME_MS * 2)
  assert.equal(sendAudioBytes(log).length, 2)

  player.stop()
  assert.equal(player.isPlaying, false)
  t.mock.timers.tick(FRAME_MS * 10)
  assert.equal(sendAudioBytes(log).length, 2)
})

test('start() while already playing does not stack intervals', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const { log, transport } = transportFor(MULAW)
  const player = new FillerSound()

  player.start(transport)
  player.start(transport)
  t.mock.timers.tick(FRAME_MS)
  assert.equal(sendAudioBytes(log).length, 1)

  player.stop()
})
