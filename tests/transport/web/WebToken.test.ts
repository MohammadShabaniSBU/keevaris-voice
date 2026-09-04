import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebTokenService } from '../../../src/transport/web/WebToken.js'

const SECRET = 'test-web-token-secret'

test('mint/verify round trip returns claims', () => {
  const now = 1_000
  const service = new WebTokenService(SECRET, () => now)
  const minted = service.mint('dev-page', 60_000, '+15555550100')

  const claims = service.verify(minted.token)

  assert.notEqual(claims, null)
  assert.equal(claims?.sessionId, minted.sessionId)
  assert.equal(claims?.purpose, 'dev-page')
  assert.equal(claims?.phoneNumber, '+15555550100')
  assert.equal(claims?.expiresAt, minted.expiresAt)
})

test('expired token returns null', () => {
  let now = 1_000
  const service = new WebTokenService(SECRET, () => now)
  const minted = service.mint('dev-page', 60_000, '+15555550100')

  now = 61_001

  assert.equal(service.verify(minted.token), null)
})

test('tampered signature returns null', () => {
  const service = new WebTokenService(SECRET)
  const minted = service.mint('dev-page', 60_000, '+15555550100')
  const tampered = `${minted.token.slice(0, -1)}x`

  assert.equal(service.verify(tampered), null)
})

test('replay returns null on second verify', () => {
  const service = new WebTokenService(SECRET)
  const minted = service.mint('dev-page', 60_000, '+15555550100')

  assert.notEqual(service.verify(minted.token), null)
  assert.equal(service.verify(minted.token), null)
})

test('token missing phoneNumber returns null', () => {
  const service = new WebTokenService(SECRET)
  const claims = {
    sessionId: 'sess_missing_phone',
    purpose: 'dev-page',
    expiresAt: Date.now() + 60_000
  }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = createHmac('sha256', SECRET).update(payload).digest('base64url')

  assert.equal(service.verify(`${payload}.${signature}`), null)
})

test('non-32-byte signature segment returns null without throwing', () => {
  const service = new WebTokenService(SECRET)
  const minted = service.mint('dev-page', 60_000, '+15555550100')
  const separatorIndex = minted.token.lastIndexOf('.')
  const payload = minted.token.slice(0, separatorIndex)
  const malformed = `${payload}.abc`

  assert.doesNotThrow(() => {
    assert.equal(service.verify(malformed), null)
  })
})
