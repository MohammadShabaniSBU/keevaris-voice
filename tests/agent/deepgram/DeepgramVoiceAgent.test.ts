import assert from 'node:assert/strict'
import { test } from 'node:test'
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
