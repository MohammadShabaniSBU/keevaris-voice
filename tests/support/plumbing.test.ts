import assert from 'node:assert/strict'
import { test } from 'node:test'

test('setupEnv --import reaches the test worker', () => {
  assert.equal(process.env.DEEPGRAM_API_KEY, 'test-deepgram-key')
  assert.equal(process.env.LOG_LEVEL, 'silent')
  assert.equal(process.env.TRANSFER_MAIN_LINE_NUMBER, '+15550001000')
})

test('t.mock.timers is on the test context', (t) => {
  assert.equal(typeof t.mock.timers.enable, 'function')
  assert.equal(typeof t.mock.timers.tick, 'function')
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const started = Date.now()
  let fired = false
  setTimeout(() => {
    fired = true
  }, 1_000)
  t.mock.timers.tick(1_000)
  assert.equal(fired, true)
  assert.equal(Date.now() - started, 1_000)
})
