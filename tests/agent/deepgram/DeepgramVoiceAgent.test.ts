import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentEvent } from '../../../src/agent/AgentProvider.js'
import { DeepgramVoiceAgent } from '../../../src/agent/deepgram/DeepgramVoiceAgent.js'
import { EventLog } from '../../support/EventLog.js'
import { DeepgramSocketDouble } from '../../support/DeepgramSocketDouble.js'

const AUDIO = { encoding: 'mulaw' as const, sampleRate: 8000 }

function drain(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

test('close during CONNECTING closes the socket when it opens and start() rejects', async () => {
  const log = new EventLog()
  let socket: DeepgramSocketDouble | undefined

  const agent = new DeepgramVoiceAgent('sess_connecting', 'Keevaris', () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const startPromise = agent.start(AUDIO, AUDIO)
  startPromise.catch(() => {})
  await drain()

  assert.ok(socket)
  await agent.close()

  socket.simulateOpen()
  await drain()

  await assert.rejects(startPromise)
  assert.equal(log.entries.some((entry) => entry.kind === 'closed'), true)
  assert.equal(
    log.entries.some((entry) => entry.kind === 'send' && entry.messageType === 'Settings'),
    false
  )
})

test('audio arriving before SettingsApplied is buffered and not sent', async () => {
  const log = new EventLog()
  let socket: DeepgramSocketDouble | undefined

  const agent = new DeepgramVoiceAgent('sess_prebuffer', 'Keevaris', () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const startPromise = agent.start(AUDIO, AUDIO)
  startPromise.catch(() => {})
  await drain()

  assert.ok(socket)
  agent.sendAudio(Buffer.from([0x01, 0x02]))
  agent.sendAudio(Buffer.from([0x03, 0x04]))

  socket.simulateOpen()
  await drain()

  assert.equal(
    log.entries.some((entry) => entry.kind === 'sendAudio'),
    false
  )
  assert.equal(socket.sentAudioChunks.length, 0)

  socket.sendControl({ type: 'Welcome', request_id: 'req_1' })
  await drain()
  assert.equal(socket.sentAudioChunks.length, 0)

  await agent.close()
})

test('SettingsApplied flushes buffered audio in order and byte-identical', async () => {
  const log = new EventLog()
  let socket: DeepgramSocketDouble | undefined

  const agent = new DeepgramVoiceAgent('sess_flush', 'Keevaris', () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const startPromise = agent.start(AUDIO, AUDIO)
  startPromise.catch(() => {})
  await drain()

  assert.ok(socket)
  const first = Buffer.from([0xaa, 0xbb, 0xcc])
  const second = Buffer.from([0x11, 0x22])
  agent.sendAudio(first)
  agent.sendAudio(second)

  socket.simulateOpen()
  socket.sendControl({ type: 'SettingsApplied' })
  await drain()
  await startPromise

  assert.deepEqual(socket.sentAudioChunks, [first, second])
  assert.equal(socket.sentAudioChunks[0], first)
  assert.equal(socket.sentAudioChunks[1], second)
  await agent.close()
})

test('prebuffer overflow drops the oldest chunk and keeps the most recent', async () => {
  const log = new EventLog()
  let socket: DeepgramSocketDouble | undefined

  const agent = new DeepgramVoiceAgent('sess_overflow', 'Keevaris', () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const startPromise = agent.start(AUDIO, AUDIO)
  startPromise.catch(() => {})
  await drain()

  assert.ok(socket)
  // mulaw 8 kHz * 2 s = 16_000-byte cap. Three 8_000-byte chunks overflow by one.
  const oldest = Buffer.alloc(8_000, 0x01)
  const keptA = Buffer.alloc(8_000, 0x02)
  const keptB = Buffer.alloc(8_000, 0x03)
  agent.sendAudio(oldest)
  agent.sendAudio(keptA)
  agent.sendAudio(keptB)

  socket.simulateOpen()
  socket.sendControl({ type: 'SettingsApplied' })
  await drain()
  await startPromise

  assert.deepEqual(socket.sentAudioChunks, [keptA, keptB])
  const flushedBytes = socket.sentAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  assert.equal(flushedBytes, 16_000)
  assert.equal(socket.sentAudioChunks.includes(oldest), false)
  await agent.close()
})

test('sendAudio after SettingsApplied is sent live, not re-queued', async () => {
  const log = new EventLog()
  let socket: DeepgramSocketDouble | undefined

  const agent = new DeepgramVoiceAgent('sess_live', 'Keevaris', () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const startPromise = agent.start(AUDIO, AUDIO)
  startPromise.catch(() => {})
  await drain()

  assert.ok(socket)
  socket.simulateOpen()
  socket.sendControl({ type: 'SettingsApplied' })
  await drain()
  await startPromise

  const live = Buffer.from([0xde, 0xad, 0xbe, 0xef])
  agent.sendAudio(live)

  assert.deepEqual(socket.sentAudioChunks, [live])
  assert.equal(socket.sentAudioChunks[0], live)
  await agent.close()
})

test('onEvent registered after closed fires immediately, exactly once', async () => {
  const log = new EventLog()
  let socket: DeepgramSocketDouble | undefined

  const agent = new DeepgramVoiceAgent('sess_late_closed', 'Keevaris', () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const startPromise = agent.start(AUDIO, AUDIO)
  startPromise.catch(() => {})
  await drain()

  assert.ok(socket)
  socket.simulateOpen()
  socket.simulateClose(1000, 'gone')
  await drain()

  const reasons: Array<string> = []
  agent.onEvent((event) => {
    if (event.type === 'closed') {
      reasons.push(event.reason)
    }
  })
  agent.onEvent((event) => {
    if (event.type === 'closed') {
      reasons.push(event.reason)
    }
  })

  assert.deepEqual(reasons, ['gone', 'gone'])
})

test('one FunctionCallRequest with two entries emits one functionCalls event', async () => {
  const log = new EventLog()
  let socket: DeepgramSocketDouble | undefined

  const agent = new DeepgramVoiceAgent('sess_two_calls', 'Keevaris', () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const startPromise = agent.start(AUDIO, AUDIO)
  startPromise.catch(() => {})
  await drain()

  assert.ok(socket)
  socket.simulateOpen()
  socket.sendControl({ type: 'SettingsApplied' })
  await drain()
  await startPromise

  const received: Array<AgentEvent> = []
  agent.onEvent((event) => {
    received.push(event)
  })

  socket.sendControl({
    type: 'FunctionCallRequest',
    functions: [
      { id: 'fc_1', name: 'ask_keevaris', arguments: '{"query":"a"}', client_side: true },
      { id: 'fc_2', name: 'ask_keevaris', arguments: '{"query":"b"}', client_side: true }
    ]
  })
  await drain()

  const functionCalls = received.filter((event) => event.type === 'functionCalls')
  assert.equal(functionCalls.length, 1)
  assert.deepEqual(functionCalls[0], {
    type: 'functionCalls',
    calls: [
      { id: 'fc_1', name: 'ask_keevaris', arguments: '{"query":"a"}' },
      { id: 'fc_2', name: 'ask_keevaris', arguments: '{"query":"b"}' }
    ]
  })
  await agent.close()
})

test('injectAgentMessage sends queue behavior and the message field', async () => {
  const log = new EventLog()
  let socket: DeepgramSocketDouble | undefined

  const agent = new DeepgramVoiceAgent('sess_inject_wire', 'Keevaris', () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const startPromise = agent.start(AUDIO, AUDIO)
  startPromise.catch(() => {})
  await drain()

  assert.ok(socket)
  socket.simulateOpen()
  socket.sendControl({ type: 'SettingsApplied' })
  await drain()
  await startPromise

  agent.injectAgentMessage('some text')
  const last = socket.sentTextFrames[socket.sentTextFrames.length - 1]
  assert.equal(typeof last, 'string')
  assert.deepEqual(JSON.parse(last as string), {
    type: 'InjectAgentMessage',
    behavior: 'queue',
    message: 'some text'
  })
  await agent.close()
})

test('InjectionRefused does not emit an AgentEvent', async () => {
  const log = new EventLog()
  let socket: DeepgramSocketDouble | undefined

  const agent = new DeepgramVoiceAgent('sess_injection_refused', 'Keevaris', () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const startPromise = agent.start(AUDIO, AUDIO)
  startPromise.catch(() => {})
  await drain()

  assert.ok(socket)
  socket.simulateOpen()
  socket.sendControl({ type: 'SettingsApplied' })
  await drain()
  await startPromise

  const received: Array<AgentEvent> = []
  agent.onEvent((event) => {
    received.push(event)
  })

  socket.sendControl({ type: 'InjectionRefused' })
  await drain()

  assert.deepEqual(received, [])
  await agent.close()
})
