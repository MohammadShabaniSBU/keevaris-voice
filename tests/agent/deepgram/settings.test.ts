import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSettingsMessage } from '../../../src/agent/deepgram/settings.js'
import { config } from '../../../src/config.js'

const AUDIO = { encoding: 'mulaw' as const, sampleRate: 8000 }

test('Settings think provider sends temperature 0 by default', () => {
  const settings = buildSettingsMessage(AUDIO, AUDIO, {
    greeting: 'Hello.',
    promptAdditions: []
  })

  assert.equal(settings.agent.think.provider.temperature, 0)
  assert.equal(settings.agent.think.provider.temperature, config.deepgram.thinkTemperature)
  assert.equal(settings.agent.think.provider.type, config.deepgram.thinkProvider)
  assert.equal(settings.agent.think.provider.model, config.deepgram.thinkModel)
})
