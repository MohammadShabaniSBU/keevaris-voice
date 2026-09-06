import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InProcessCallRegistry } from '../../../src/transport/twilio/CallRegistry.js'

test('put/take round trip returns stored entry', async () => {
  const registry = new InProcessCallRegistry(() => 1_000)
  const entry = {
    callSid: 'CA123',
    from: '+15555550100',
    to: '+15555550999',
    bridgeToken: 'test-bridge-token',
    bridgeSecret: 'test-bridge-secret',
    createdAt: 1_000
  }

  await registry.put('nonce-1', entry, 60_000)

  assert.deepEqual(await registry.take('nonce-1'), entry)
})

test('take is single-use', async () => {
  const registry = new InProcessCallRegistry(() => 1_000)
  await registry.put(
    'nonce-1',
    {
      callSid: 'CA123',
      from: '+15555550100',
      to: '+15555550999',
      bridgeToken: 'test-bridge-token',
      bridgeSecret: 'test-bridge-secret',
      createdAt: 1_000
    },
    60_000
  )

  assert.notEqual(await registry.take('nonce-1'), undefined)
  assert.equal(await registry.take('nonce-1'), undefined)
})

test('take returns undefined for expired nonce', async () => {
  let now = 1_000
  const registry = new InProcessCallRegistry(() => now)
  await registry.put(
    'nonce-1',
    {
      callSid: 'CA123',
      from: '+15555550100',
      to: '+15555550999',
      bridgeToken: 'test-bridge-token',
      bridgeSecret: 'test-bridge-secret',
      createdAt: 1_000
    },
    60_000
  )

  now = 61_001

  assert.equal(await registry.take('nonce-1'), undefined)
})
