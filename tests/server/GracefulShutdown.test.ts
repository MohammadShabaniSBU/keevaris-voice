import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { test } from 'node:test'
import type { TransportCloseReason } from '../../src/transport/Transport.js'
import { ConnectionGate } from '../../src/server/ConnectionGate.js'
import { DependencyHealth } from '../../src/server/DependencyHealth.js'
import { installGracefulShutdown } from '../../src/server/GracefulShutdown.js'
import { ReadinessState } from '../../src/server/ReadinessState.js'

function drain(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function stubServer(): { server: Server; closed: { value: boolean } } {
  const closed = { value: false }
  const server = {
    close() {
      closed.value = true
    }
  } as unknown as Server

  return { server, closed }
}

test('zero active sessions exits immediately without teardown', async () => {
  const health = new DependencyHealth(60_000, 5_000)
  const readiness = new ReadinessState(health)
  const gate = new ConnectionGate(2)
  const { server, closed } = stubServer()
  const exits: Array<number> = []

  const shutdown = installGracefulShutdown({
    server,
    connectionGate: gate,
    readiness,
    graceMs: 5_000,
    listen: false,
    exit: (code) => {
      exits.push(code)
    }
  })

  await shutdown()

  assert.equal(readiness.isDraining(), true)
  assert.equal(closed.value, true)
  assert.deepEqual(exits, [0])
})

test('sessions that end naturally before grace are not force-torn down', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })

  const health = new DependencyHealth(60_000, 5_000)
  const readiness = new ReadinessState(health)
  const gate = new ConnectionGate(2)
  const { server } = stubServer()
  const teardowns: Array<TransportCloseReason> = []
  const session = {
    teardown: async (reason: TransportCloseReason) => {
      teardowns.push(reason)
    }
  }
  gate.registerSession(session)
  const exits: Array<number> = []

  const shutdown = installGracefulShutdown({
    server,
    connectionGate: gate,
    readiness,
    graceMs: 5_000,
    pollIntervalMs: 250,
    listen: false,
    exit: (code) => {
      exits.push(code)
    }
  })

  const pending = shutdown()
  await drain()
  gate.unregisterSession(session)
  t.mock.timers.tick(250)
  await drain()
  await pending

  assert.deepEqual(teardowns, [])
  assert.deepEqual(exits, [0])
})

test('sessions still active at grace expiry are torn down with server_shutdown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })

  const health = new DependencyHealth(60_000, 5_000)
  const readiness = new ReadinessState(health)
  const gate = new ConnectionGate(2)
  const { server } = stubServer()
  const teardowns: Array<TransportCloseReason> = []
  const first = {
    teardown: async (reason: TransportCloseReason) => {
      teardowns.push(reason)
    }
  }
  const second = {
    teardown: async (reason: TransportCloseReason) => {
      teardowns.push(reason)
    }
  }
  gate.registerSession(first)
  gate.registerSession(second)
  const exits: Array<number> = []

  const shutdown = installGracefulShutdown({
    server,
    connectionGate: gate,
    readiness,
    graceMs: 1_000,
    pollIntervalMs: 250,
    listen: false,
    exit: (code) => {
      exits.push(code)
    }
  })

  const pending = shutdown()
  let elapsed = 0
  while (elapsed < 1_000) {
    t.mock.timers.tick(250)
    await drain()
    elapsed += 250
  }
  await pending

  assert.deepEqual(teardowns, ['server_shutdown', 'server_shutdown'])
  assert.deepEqual(exits, [0])
})
