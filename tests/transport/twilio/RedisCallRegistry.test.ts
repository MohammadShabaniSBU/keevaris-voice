/**
 * These tests use ioredis-mock rather than a real Redis instance.
 *
 * keevaris-voice has no docker-compose test profile and no CI Redis
 * service. ioredis-mock is in-process, implements GET/SET/PX/NX and
 * Lua EVAL (with caveats around dynamic key counts and EVALSHA), and
 * is enough to prove put/take, TTL, atomic single-use redemption, and
 * the GETDEL→Lua fallback. It is not a substitute for a real Redis
 * once a test harness exists — swap this file onto one then.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import type { CallRegistryEntry } from '../../../src/transport/twilio/CallRegistry.js'
import {
  RedisCallRegistry,
  type CallRegistryRedis
} from '../../../src/transport/twilio/RedisCallRegistry.js'

const require = createRequire(import.meta.url)
const RedisMock = require('ioredis-mock') as new () => CallRegistryRedis

const entry: CallRegistryEntry = {
  callSid: 'CA123',
  from: '+15555550100',
  to: '+15555550999',
  bridgeToken: 'test-bridge-token',
  bridgeSecret: 'test-bridge-secret',
  createdAt: 1_000
}

function createRegistry(): RedisCallRegistry {
  return new RedisCallRegistry(new RedisMock())
}

test('put/take round trip returns stored entry', async () => {
  const registry = createRegistry()

  await registry.put('nonce-1', entry, 60_000)

  assert.deepEqual(await registry.take('nonce-1'), entry)
})

test('take is single-use', async () => {
  const registry = createRegistry()
  await registry.put('nonce-1', entry, 60_000)

  assert.notEqual(await registry.take('nonce-1'), undefined)
  assert.equal(await registry.take('nonce-1'), undefined)
})

test('take returns undefined for expired nonce', async () => {
  const registry = createRegistry()
  await registry.put('nonce-1', entry, 30)

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 80)
  })

  assert.equal(await registry.take('nonce-1'), undefined)
})

test('concurrent take redeems a nonce exactly once', async () => {
  const registry = createRegistry()
  await registry.put('nonce-1', entry, 60_000)

  const [first, second] = await Promise.all([registry.take('nonce-1'), registry.take('nonce-1')])
  const hits = [first, second].filter((result) => result !== undefined)

  assert.equal(hits.length, 1)
  assert.deepEqual(hits[0], entry)
})

test('take falls back to Lua when GETDEL is unavailable', async () => {
  const inner = new RedisMock()
  const client: CallRegistryRedis = {
    set: inner.set.bind(inner),
    getdel: async () => {
      throw new Error("ERR unknown command 'GETDEL'")
    },
    eval: inner.eval.bind(inner)
  }
  const registry = new RedisCallRegistry(client)
  await registry.put('nonce-1', entry, 60_000)

  assert.deepEqual(await registry.take('nonce-1'), entry)
  assert.equal(await registry.take('nonce-1'), undefined)
})

test('take fails closed on a Redis error', async () => {
  const client: CallRegistryRedis = {
    async set() {
      throw new Error('ECONNREFUSED')
    },
    async getdel() {
      throw new Error('ECONNREFUSED')
    },
    async eval() {
      throw new Error('ECONNREFUSED')
    }
  }
  const registry = new RedisCallRegistry(client)

  assert.equal(await registry.take('nonce-1'), undefined)
})

test('put fails closed on a Redis error', async () => {
  const client: CallRegistryRedis = {
    async set() {
      throw new Error('ECONNREFUSED')
    },
    async getdel() {
      return null
    },
    async eval() {
      return null
    }
  }
  const registry = new RedisCallRegistry(client)

  await registry.put('nonce-1', entry, 60_000)
})
