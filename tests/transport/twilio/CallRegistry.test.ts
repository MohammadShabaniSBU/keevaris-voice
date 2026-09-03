import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InProcessCallRegistry } from '../../../src/transport/twilio/CallRegistry.js'

test('put/take round trip returns stored entry', () => {
  const registry = new InProcessCallRegistry(() => 1_000)
  const entry = {
    callSid: 'CA123',
    from: '+15555550100',
    to: '+15555550999',
    createdAt: 1_000
  }

  registry.put('nonce-1', entry, 60_000)

  assert.deepEqual(registry.take('nonce-1'), entry)
})

test('take is single-use', () => {
  const registry = new InProcessCallRegistry(() => 1_000)
  registry.put(
    'nonce-1',
    {
      callSid: 'CA123',
      from: '+15555550100',
      to: '+15555550999',
      createdAt: 1_000
    },
    60_000
  )

  assert.notEqual(registry.take('nonce-1'), undefined)
  assert.equal(registry.take('nonce-1'), undefined)
})

test('take returns undefined for expired nonce', () => {
  let now = 1_000
  const registry = new InProcessCallRegistry(() => now)
  registry.put(
    'nonce-1',
    {
      callSid: 'CA123',
      from: '+15555550100',
      to: '+15555550999',
      createdAt: 1_000
    },
    60_000
  )

  now = 61_001

  assert.equal(registry.take('nonce-1'), undefined)
})
