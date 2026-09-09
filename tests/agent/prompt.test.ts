import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ASK_KEEVARIS_DESCRIPTION, ASK_KEEVARIS_FUNCTION_NAME, buildSystemPrompt } from '../../src/agent/prompt.js'

test('function description forbids delegating a language switch', () => {
  assert.match(ASK_KEEVARIS_DESCRIPTION, /Never delegate/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /continue, switch, or answer in a language/)
  assert.doesNotMatch(ASK_KEEVARIS_DESCRIPTION, /anything you are not certain about/)
})

test('function description is a sales operator that keeps chit-chat and delegates price and availability', () => {
  assert.match(ASK_KEEVARIS_DESCRIPTION, /sales operator/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /chit-chat/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /price or availability/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /spoken for you/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /do not summarize, rephrase, or add a follow-up/i)
  assert.doesNotMatch(ASK_KEEVARIS_DESCRIPTION, /Speak the returned text back/)
})

test('function description delegates writes and forbids inventing them', () => {
  assert.match(ASK_KEEVARIS_DESCRIPTION, /Always delegate actions/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /send a quote, text, SMS, email/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /book, schedule, or confirm a site visit/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /take a name to create a contact/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /never ask for a phone number or email address/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /Never ask the caller for their phone number or email address/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /Never say a quote was sent/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /Never invent a time or a full phone number/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /plus any size, name, phone, or email already given/)
})

test('system prompt tells the think model not to call ask_keevaris on a language switch', () => {
  const prompt = buildSystemPrompt(['Never invent a site name.'])

  assert.match(prompt, new RegExp(`do not call ${ASK_KEEVARIS_FUNCTION_NAME}`))
  assert.match(prompt, /switch or continue in a language/)
  assert.match(prompt, /Never invent a site name/)
})
