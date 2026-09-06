import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DependencyHealth } from '../../src/server/DependencyHealth.js'

test('no reports is healthy — a quiet process is ready', () => {
  const health = new DependencyHealth(60_000, 5_000)

  assert.equal(health.isHealthy(), true)
})

test('isHealthy reflects the latest report per dependency', () => {
  const health = new DependencyHealth(60_000, 5_000)

  health.report('deepgram', true)
  health.report('keevaris', false)
  assert.equal(health.isHealthy(), false)

  health.report('keevaris', true)
  assert.equal(health.isHealthy(), true)

  health.report('deepgram', false)
  assert.equal(health.isHealthy(), false)
})

test('one dependency down does not mask the other', () => {
  const health = new DependencyHealth(60_000, 5_000)

  health.report('deepgram', false)
  health.report('keevaris', true)
  assert.equal(health.isHealthy(), false)

  health.report('deepgram', true)
  health.report('keevaris', false)
  assert.equal(health.isHealthy(), false)
})

test('sweep expires a stale failure back to healthy', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const health = new DependencyHealth(60_000, 5_000)

  health.report('deepgram', false)
  assert.equal(health.isHealthy(), false)

  t.mock.timers.tick(59_999)
  health.sweep()
  assert.equal(health.isHealthy(), false)

  t.mock.timers.tick(1)
  health.sweep()
  assert.equal(health.isHealthy(), true)
})
