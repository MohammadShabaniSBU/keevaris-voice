import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { parseVoiceBridgeNumbers } from '../../src/config.js'
import { logger } from '../../src/logger.js'
import { handleTwilioVoiceWebhook } from '../../src/server/twilioVoiceWebhook.js'
import { InProcessCallRegistry } from '../../src/transport/twilio/CallRegistry.js'

const KNOWN_TO = '+15555550100'
const UNKNOWN_TO = '+15555550999'

function encodeForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

function buildRequest(params: Record<string, string>): IncomingMessage {
  const request = Readable.from([Buffer.from(encodeForm(params), 'utf8')]) as IncomingMessage
  request.headers = {}
  request.method = 'POST'

  return request
}

interface CapturedResponse {
  statusCode: number
  headers: Record<string, string | Array<string> | undefined>
  body: string
}

function buildResponse(): { response: ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 0, headers: {}, body: '' }
  const response = {
    writeHead(status: number, headers?: Record<string, string | Array<string> | undefined>) {
      captured.statusCode = status
      captured.headers = headers ?? {}
      return this
    },
    end(chunk?: string) {
      captured.body = chunk ?? ''
      return this
    }
  }

  return { response: response as unknown as ServerResponse, captured }
}

function webhookUrl(): URL {
  return new URL('/twilio/voice', 'http://localhost:8787')
}

function nonceFromTwiml(twiml: string): string {
  const match = /<Parameter name="nonce" value="([^"]+)" \/>/.exec(twiml)
  assert.notEqual(match, null, `nonce parameter missing from TwiML:\n${twiml}`)

  return match?.[1] ?? ''
}

test('known To resolves credentials onto the call registry', async () => {
  const registry = new InProcessCallRegistry()
  const { response, captured } = buildResponse()

  await handleTwilioVoiceWebhook(
    buildRequest({
      CallSid: 'CA123',
      From: '+15555550111',
      To: KNOWN_TO
    }),
    response,
    webhookUrl(),
    registry
  )

  assert.equal(captured.statusCode, 200)
  assert.equal(captured.headers['Content-Type'], 'text/xml')

  const nonce = nonceFromTwiml(captured.body)
  const entry = registry.take(nonce)
  assert.notEqual(entry, undefined)
  assert.equal(entry?.callSid, 'CA123')
  assert.equal(entry?.from, '+15555550111')
  assert.equal(entry?.to, KNOWN_TO)
  assert.equal(entry?.bridgeToken, 'test-bridge-token')
  assert.equal(entry?.bridgeSecret, 'test-bridge-secret')
})

test('unknown To returns 404 and logs twilio.unknown_number', async (t) => {
  const warnMock = t.mock.method(logger, 'warn')
  const registry = new InProcessCallRegistry()
  const { response, captured } = buildResponse()

  await handleTwilioVoiceWebhook(
    buildRequest({
      CallSid: 'CA999',
      From: '+15555550111',
      To: UNKNOWN_TO
    }),
    response,
    webhookUrl(),
    registry
  )

  assert.equal(captured.statusCode, 404)
  assert.equal(captured.body, 'Not found')

  const tagged = warnMock.mock.calls.filter((call) => call.arguments[1] === 'twilio.unknown_number')
  assert.equal(tagged.length, 1)
})

test('parseVoiceBridgeNumbers rejects empty array', () => {
  assert.throws(() => parseVoiceBridgeNumbers('[]'), /at least one entry/)
})

test('parseVoiceBridgeNumbers rejects malformed JSON', () => {
  assert.throws(() => parseVoiceBridgeNumbers('not-json'), /valid JSON/)
})

test('parseVoiceBridgeNumbers rejects duplicate phoneNumber', () => {
  const raw = JSON.stringify([
    { phoneNumber: '+15555550100', bridgeToken: 'tok_a', bridgeSecret: 'sec_a' },
    { phoneNumber: '+15555550100', bridgeToken: 'tok_b', bridgeSecret: 'sec_b' }
  ])

  assert.throws(() => parseVoiceBridgeNumbers(raw), /duplicate phoneNumber/)
})
