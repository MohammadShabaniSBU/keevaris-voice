import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionRejectedError } from '../../../src/errors.js'
import {
  InProcessCallRegistry,
  type CallRegistry,
  type CallRegistryEntry
} from '../../../src/transport/twilio/CallRegistry.js'
import { TwilioTransport } from '../../../src/transport/twilio/TwilioTransport.js'
import { FakeRawSocket } from '../../support/FakeRawSocket.js'

const storedEntry: CallRegistryEntry = {
  callSid: 'CA123',
  from: '+15555550100',
  to: '+15555550999',
  bridgeToken: 'test-bridge-token',
  bridgeSecret: 'test-bridge-secret',
  createdAt: 1_000
}

class DelayedCallRegistry implements CallRegistry {
  private resolveTake: ((entry: CallRegistryEntry | undefined) => void) | undefined
  private released: CallRegistryEntry | undefined
  private releasedFlag = false

  async put(): Promise<void> {}

  async take(): Promise<CallRegistryEntry | undefined> {
    if (this.releasedFlag) {
      return this.released
    }

    return new Promise((resolve) => {
      this.resolveTake = resolve
    })
  }

  release(entry: CallRegistryEntry = storedEntry): void {
    this.releasedFlag = true
    this.released = entry
    this.resolveTake?.(entry)
  }
}

function buildMediaFrame(payload = 'AAAA'): Buffer {
  return Buffer.from(
    JSON.stringify({
      event: 'media',
      media: { payload }
    })
  )
}

function buildStartFrame(options: {
  callSid?: string
  nonce?: string
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      event: 'start',
      start: {
        callSid: options.callSid ?? 'CA123',
        streamSid: 'MZ123',
        customParameters: options.nonce === undefined ? {} : { nonce: options.nonce }
      }
    })
  )
}

function buildRequest(): import('node:http').IncomingMessage {
  return {
    socket: { remoteAddress: '127.0.0.1' }
  } as import('node:http').IncomingMessage
}

test('forged start frame rejects unknown nonce', async () => {
  const ws = new FakeRawSocket()
  const registry = new InProcessCallRegistry()
  const transport = new TwilioTransport(ws, buildRequest(), registry)
  const readyPromise = transport.ready()

  ws.emitMessage(buildStartFrame({ nonce: 'missing-nonce' }))

  await assert.rejects(readyPromise, ConnectionRejectedError)
  assert.equal(ws.closeCalls.length, 1)
  assert.equal(ws.closeCalls[0]?.code, 1008)
  assert.equal(ws.closeCalls[0]?.reason, 'policy violation')
})

test('replayed nonce rejects second start frame', async () => {
  const ws = new FakeRawSocket()
  const registry = new InProcessCallRegistry(() => 1_000)
  await registry.put('nonce-1', storedEntry, 60_000)

  const firstTransport = new TwilioTransport(ws, buildRequest(), registry)
  const firstReady = firstTransport.ready()
  ws.emitMessage(buildStartFrame({ callSid: 'CA123', nonce: 'nonce-1' }))
  await firstReady

  assert.equal(firstTransport.callerNumber, '+15555550100')

  const replayWs = new FakeRawSocket()
  const replayTransport = new TwilioTransport(replayWs, buildRequest(), registry)
  const replayReady = replayTransport.ready()
  replayWs.emitMessage(buildStartFrame({ callSid: 'CA123', nonce: 'nonce-1' }))

  await assert.rejects(replayReady, ConnectionRejectedError)
  assert.equal(replayWs.closeCalls.length, 1)
})

test('CallSid mismatch rejects valid nonce', async () => {
  const ws = new FakeRawSocket()
  const registry = new InProcessCallRegistry(() => 1_000)
  await registry.put('nonce-1', storedEntry, 60_000)

  const transport = new TwilioTransport(ws, buildRequest(), registry)
  const readyPromise = transport.ready()
  ws.emitMessage(buildStartFrame({ callSid: 'CA999', nonce: 'nonce-1' }))

  await assert.rejects(readyPromise, ConnectionRejectedError)
  assert.equal(ws.closeCalls.length, 1)
})

test('onClose registered after close fires immediately, exactly once', async () => {
  const ws = new FakeRawSocket()
  const registry = new InProcessCallRegistry()
  const transport = new TwilioTransport(ws, buildRequest(), registry)

  ws.emitClose()

  const reasons: Array<string> = []
  transport.onClose((reason) => {
    reasons.push(reason)
  })
  transport.onClose((reason) => {
    reasons.push(reason)
  })

  await transport.close('error')

  assert.deepEqual(reasons, ['caller_hangup', 'caller_hangup'])
})

test('valid nonce resolves callerNumber from registry', async () => {
  const ws = new FakeRawSocket()
  const registry = new InProcessCallRegistry(() => 1_000)
  await registry.put('nonce-1', storedEntry, 60_000)

  const transport = new TwilioTransport(ws, buildRequest(), registry)
  const readyPromise = transport.ready()
  ws.emitMessage(buildStartFrame({ callSid: 'CA123', nonce: 'nonce-1' }))
  await readyPromise

  assert.equal(transport.sessionId, 'CA123')
  assert.equal(transport.callerNumber, '+15555550100')
  assert.deepEqual(transport.bridgeCredentials, {
    bridgeToken: 'test-bridge-token',
    bridgeSecret: 'test-bridge-secret'
  })
})

test('clearAudio sends a Twilio clear event with the streamSid', async () => {
  const ws = new FakeRawSocket()
  const registry = new InProcessCallRegistry(() => 1_000)
  await registry.put('nonce-1', storedEntry, 60_000)

  const transport = new TwilioTransport(ws, buildRequest(), registry)
  const readyPromise = transport.ready()
  ws.emitMessage(buildStartFrame({ callSid: 'CA123', nonce: 'nonce-1' }))
  await readyPromise

  transport.clearAudio()

  assert.equal(ws.sent.length, 1)
  assert.deepEqual(JSON.parse(ws.sent[0] as string), {
    event: 'clear',
    streamSid: 'MZ123'
  })
})

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

test('media arriving while take() is pending waits for start to finish', async () => {
  const ws = new FakeRawSocket()
  const registry = new DelayedCallRegistry()
  const transport = new TwilioTransport(ws, buildRequest(), registry)
  const events: Array<string> = []
  transport.onAudio(() => {
    events.push(`media:${transport.sessionId}`)
  })

  const readyPromise = transport.ready()
  ws.emitMessage(buildStartFrame({ callSid: 'CA123', nonce: 'nonce-1' }))
  await nextTurn()
  ws.emitMessage(buildMediaFrame())

  assert.deepEqual(events, [])
  assert.equal(transport.sessionId, '')

  registry.release()
  await readyPromise
  await nextTurn()

  assert.equal(transport.sessionId, 'CA123')
  assert.deepEqual(events, ['media:CA123'])
})

test('hangup during nonce redemption does not resolve ready', async () => {
  const ws = new FakeRawSocket()
  const registry = new DelayedCallRegistry()
  const transport = new TwilioTransport(ws, buildRequest(), registry)
  const reasons: Array<string> = []
  transport.onClose((reason) => {
    reasons.push(reason)
  })

  const readyPromise = transport.ready()
  ws.emitMessage(buildStartFrame({ callSid: 'CA123', nonce: 'nonce-1' }))
  await nextTurn()
  ws.emitClose()

  assert.deepEqual(reasons, ['caller_hangup'])
  assert.equal(transport.sessionId, '')
  assert.equal(transport.callerNumber, null)

  registry.release()
  await assert.rejects(readyPromise, ConnectionRejectedError)
  await nextTurn()

  assert.equal(transport.sessionId, '')
  assert.equal(transport.callerNumber, null)
})
