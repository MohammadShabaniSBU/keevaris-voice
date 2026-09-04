import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { z } from 'zod'
import { KeevarisClient } from '../src/delegation/KeevarisClient.js'
import { config } from '../src/config.js'
import { logger } from '../src/logger.js'

const FALLBACK = {
  text: 'Let me put you through to someone who can help.',
  transfer: true,
  destination: 'main_line',
  clientFallback: true
} as const

const requestSchema = z.object({
  query: z.string(),
  turn_id: z.string(),
  session_id: z.string(),
  caller_number: z.string().nullable(),
  caller_utterance: z.string().nullable()
})

const request = {
  query: 'what are your hours?',
  turn_id: 'fc_1',
  session_id: 'sess_contract',
  caller_number: '+15555550100',
  caller_utterance: 'what are your hours, like, today?'
}

const TEST_CREDENTIALS = {
  bridgeToken: 'test-bridge-token',
  bridgeSecret: 'test-bridge-secret'
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(impl: typeof fetch): void {
  globalThis.fetch = impl
}

function drain(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function fallbackEngagedCalls(errorMock: { mock: { calls: Array<{ arguments: Array<unknown> }> } }): number {
  return errorMock.mock.calls.filter((call) => call.arguments[1] === 'delegation.fallback_engaged').length
}

test('well-formed backend response is returned as-is', async () => {
  mockFetch(async (url, init) => {
    assert.equal(String(url), `${config.keevaris.apiUrl}/api/voice/bridge/${TEST_CREDENTIALS.bridgeToken}`)
    assert.equal(init?.method, 'POST')
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('Content-Type'), 'application/json')
    assert.equal(headers.get('Accept'), 'application/json')
    assert.equal(headers.get('X-Voice-Bridge-Secret'), TEST_CREDENTIALS.bridgeSecret)
    const body = requestSchema.parse(JSON.parse(String(init?.body)))
    assert.deepEqual(body, request)

    return new Response(JSON.stringify({ text: 'We close at 6.', transfer: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  })

  const result = await new KeevarisClient(TEST_CREDENTIALS).ask(request)
  assert.deepEqual(result, { text: 'We close at 6.', transfer: false, destination: undefined })
})

test('response missing text falls back', async (t) => {
  const errorMock = t.mock.method(logger, 'error')
  mockFetch(async () => {
    return new Response(JSON.stringify({ transfer: true, destination: 'main_line' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  })

  const result = await new KeevarisClient(TEST_CREDENTIALS).ask(request)
  assert.deepEqual(result, { ...FALLBACK })
  assert.equal(fallbackEngagedCalls(errorMock), 1)
})

test('non-2xx status falls back', async (t) => {
  const errorMock = t.mock.method(logger, 'error')
  mockFetch(async () => {
    return new Response('nope', { status: 503 })
  })

  const result = await new KeevarisClient(TEST_CREDENTIALS).ask(request)
  assert.deepEqual(result, { ...FALLBACK })
  assert.equal(fallbackEngagedCalls(errorMock), 1)
})

test('AbortController timeout falls back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const errorMock = t.mock.method(logger, 'error')

  mockFetch(async (_url, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })
  })

  const pending = new KeevarisClient(TEST_CREDENTIALS).ask(request)
  t.mock.timers.tick(config.keevaris.timeoutMs)
  await drain()
  const result = await pending
  assert.deepEqual(result, { ...FALLBACK })
  assert.equal(fallbackEngagedCalls(errorMock), 1)
})

test('two clients in one run send two different credentials', async () => {
  const seen: Array<{ url: string; secret: string | null }> = []
  mockFetch(async (url, init) => {
    const headers = new Headers(init?.headers)
    seen.push({ url: String(url), secret: headers.get('X-Voice-Bridge-Secret') })

    return new Response(JSON.stringify({ text: 'ok', transfer: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  })

  await new KeevarisClient({ bridgeToken: 'tok_a', bridgeSecret: 'sec_a' }).ask(request)
  await new KeevarisClient({ bridgeToken: 'tok_b', bridgeSecret: 'sec_b' }).ask(request)

  assert.deepEqual(seen, [
    { url: `${config.keevaris.apiUrl}/api/voice/bridge/tok_a`, secret: 'sec_a' },
    { url: `${config.keevaris.apiUrl}/api/voice/bridge/tok_b`, secret: 'sec_b' }
  ])
})
