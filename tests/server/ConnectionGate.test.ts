import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionGate } from '../../src/server/ConnectionGate.js'

test('tryAcquire allows up to the configured limit', () => {
  const gate = new ConnectionGate(2)

  assert.equal(gate.tryAcquire(), true)
  assert.equal(gate.tryAcquire(), true)
  assert.equal(gate.tryAcquire(), false)
  assert.equal(gate.activeCount, 2)
})

test('release frees a slot', () => {
  const gate = new ConnectionGate(1)

  assert.equal(gate.tryAcquire(), true)
  assert.equal(gate.tryAcquire(), false)

  gate.release()

  assert.equal(gate.tryAcquire(), true)
  assert.equal(gate.activeCount, 1)
})

test('registerSession and unregisterSession track active sessions', () => {
  const gate = new ConnectionGate(2)
  const first = { teardown: async () => {} }
  const second = { teardown: async () => {} }

  gate.registerSession(first)
  gate.registerSession(second)
  assert.equal(gate.activeSessions.size, 2)
  assert.equal(gate.activeSessions.has(first), true)
  assert.equal(gate.activeSessions.has(second), true)

  gate.unregisterSession(first)
  assert.equal(gate.activeSessions.size, 1)
  assert.equal(gate.activeSessions.has(first), false)
  assert.equal(gate.activeSessions.has(second), true)

  gate.unregisterSession(first)
  assert.equal(gate.activeSessions.size, 1)
})
