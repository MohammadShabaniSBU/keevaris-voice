import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionRejectedError } from '../../../src/errors.js'
import { createWebTransport, WebTransport } from '../../../src/transport/web/WebTransport.js'
import { WebTokenService } from '../../../src/transport/web/WebToken.js'
import { FakeRawSocket } from '../../support/FakeRawSocket.js'

const SECRET = 'test-web-token-secret'

function buildRequest(token: string | null): import('node:http').IncomingMessage {
  const query = token === null ? '' : `?token=${encodeURIComponent(token)}`

  return {
    url: `/web/media${query}`,
    socket: { remoteAddress: '127.0.0.1' }
  } as import('node:http').IncomingMessage
}

test('createWebTransport rejects missing token', async () => {
  const ws = new FakeRawSocket()
  const service = new WebTokenService(SECRET)

  await assert.rejects(createWebTransport(ws, buildRequest(null), service), ConnectionRejectedError)
  assert.equal(ws.closeCalls.length, 1)
  assert.equal(ws.closeCalls[0]?.code, 1008)
})

test('createWebTransport rejects expired token', async () => {
  let now = 1_000
  const ws = new FakeRawSocket()
  const service = new WebTokenService(SECRET, () => now)
  const minted = service.mint('dev-page', 60_000)

  now = 61_001

  await assert.rejects(createWebTransport(ws, buildRequest(minted.token), service), ConnectionRejectedError)
})

test('onClose registered after close fires immediately, exactly once', async () => {
  const ws = new FakeRawSocket()
  const transport = new WebTransport(ws, 'sess_late_close')

  ws.emitClose()

  const reasons: Array<string> = []
  transport.onClose((reason) => {
    reasons.push(reason)
  })

  await transport.close('error')

  assert.deepEqual(reasons, ['caller_hangup'])
})

test('createWebTransport accepts valid token and uses sessionId from claims', async () => {
  const ws = new FakeRawSocket()
  const service = new WebTokenService(SECRET)
  const minted = service.mint('dev-page', 60_000)

  const transport = await createWebTransport(ws, buildRequest(minted.token), service)

  assert.equal(transport.sessionId, minted.sessionId)
  assert.equal(transport.callerNumber, null)
})

test('clearAudio sends a JSON clear text frame', () => {
  const ws = new FakeRawSocket()
  const transport = new WebTransport(ws, 'sess_clear')

  transport.clearAudio()

  assert.equal(ws.sent.length, 1)
  assert.deepEqual(JSON.parse(ws.sent[0] as string), { type: 'clear' })
})
