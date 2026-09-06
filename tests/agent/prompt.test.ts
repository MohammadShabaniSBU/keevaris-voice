import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ASK_KEEVARIS_DESCRIPTION, ASK_KEEVARIS_FUNCTION_NAME, buildSystemPrompt } from '../../src/agent/prompt.js'

test('function description forbids delegating a language switch', () => {
  assert.match(ASK_KEEVARIS_DESCRIPTION, /Never delegate/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /continue, switch, or answer in a language/)
  assert.doesNotMatch(ASK_KEEVARIS_DESCRIPTION, /anything you are not certain about/)
})

test('system prompt tells the think model not to call ask_keevaris on a language switch', () => {
  const prompt = buildSystemPrompt(['Never invent a site name.'])

  assert.match(prompt, new RegExp(`do not call ${ASK_KEEVARIS_FUNCTION_NAME}`))
  assert.match(prompt, /switch or continue in a language/)
  assert.match(prompt, /Never invent a site name/)
})
