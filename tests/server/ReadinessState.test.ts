import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DependencyHealth } from '../../src/server/DependencyHealth.js'
import { ReadinessState } from '../../src/server/ReadinessState.js'

test('not draining and healthy is ready', () => {
  const health = new DependencyHealth(60_000, 5_000)
  const readiness = new ReadinessState(health)

  assert.equal(readiness.isReady(), true)
  assert.equal(readiness.isDraining(), false)
})

test('draining forces not-ready regardless of dependency health', () => {
  const health = new DependencyHealth(60_000, 5_000)
  health.report('deepgram', true)
  health.report('keevaris', true)
  const readiness = new ReadinessState(health)

  readiness.startDraining()
  assert.equal(readiness.isDraining(), true)
  assert.equal(readiness.isReady(), false)
})

test('not draining and unhealthy is not ready', () => {
  const health = new DependencyHealth(60_000, 5_000)
  health.report('keevaris', false)
  const readiness = new ReadinessState(health)

  assert.equal(readiness.isDraining(), false)
  assert.equal(readiness.isReady(), false)
})
