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
