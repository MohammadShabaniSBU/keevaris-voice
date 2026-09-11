import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ASK_KEEVARIS_DESCRIPTION, ASK_KEEVARIS_FUNCTION_NAME, buildSystemPrompt } from '../../src/agent/prompt.js'
import { FALLBACK_PROMPT_ADDITIONS } from '../../src/config/BridgeConfigClient.js'

const DO_NOT_REPEAT = /do not repeat its content\. Do not summarize, rephrase/

test('function description is a short trigger with query shape and do-not-repeat', () => {
  assert.match(ASK_KEEVARIS_DESCRIPTION, /Call this function when the caller needs a company fact or an action/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /Do not answer those yourself/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, /plus any size, name, phone, or email already given/)
  assert.match(ASK_KEEVARIS_DESCRIPTION, DO_NOT_REPEAT)
  assert.doesNotMatch(ASK_KEEVARIS_DESCRIPTION, /sales operator/)
  assert.doesNotMatch(ASK_KEEVARIS_DESCRIPTION, /Always delegate/)
  assert.doesNotMatch(ASK_KEEVARIS_DESCRIPTION, /Speak the returned text back/)
})

test('think prompt carries the sales-operator policy from prompt additions', () => {
  const prompt = buildSystemPrompt(FALLBACK_PROMPT_ADDITIONS)

  assert.match(prompt, /sales operator/)
  assert.match(prompt, /chit-chat/)
  assert.match(prompt, /price or availability/)
  assert.match(prompt, /Always ask the other agent for facts/)
  assert.match(prompt, /sizes, unit types/)
  assert.match(prompt, /Always ask the other agent to do any action/)
  assert.match(prompt, /send a quote, text, SMS, email/)
  assert.match(prompt, /book, schedule, or confirm a site visit/)
  assert.match(prompt, /take a first or last name to create or update a contact/)
  assert.match(prompt, /never ask for a phone number or email address/)
  assert.match(prompt, /Never ask the caller for their phone number or email address/)
  assert.match(prompt, /Never say a quote was sent/)
  assert.match(prompt, /Never invent a time or a full phone number/)
  assert.match(prompt, /do not paraphrase a remembered answer/i)
  assert.match(prompt, /continue, switch, or answer in a language/)
  assert.doesNotMatch(prompt, /anything you are not certain about/)
})

test('do-not-repeat wording is on both the think prompt and the function description', () => {
  const prompt = buildSystemPrompt(FALLBACK_PROMPT_ADDITIONS)

  assert.match(prompt, DO_NOT_REPEAT)
  assert.match(ASK_KEEVARIS_DESCRIPTION, DO_NOT_REPEAT)
})

test('system prompt tells the think model not to call ask_keevaris on a language switch', () => {
  const prompt = buildSystemPrompt(['Never invent a site name.'])

  assert.match(prompt, new RegExp(`do not call ${ASK_KEEVARIS_FUNCTION_NAME}`))
  assert.match(prompt, /switch or continue in a language/)
  assert.match(prompt, /Never invent a site name/)
})
