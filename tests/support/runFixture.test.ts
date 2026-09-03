import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertFixtureLog } from '../runFixture.js'
import type { EventLogEntry } from './EventLog.js'

const log: Array<EventLogEntry> = [
  { t: 0, on: 'agentSocket', kind: 'send', messageType: 'InjectAgentMessage' },
  { t: 1, on: 'agentSocket', kind: 'send', messageType: 'FunctionCallResponse' },
  { t: 2, on: 'transport', kind: 'sendAudio', bytes: 320 },
  { t: 3, on: 'transport', kind: 'transfer', destinationNumber: '+15550001000' }
]

test('ordered expect passes', () => {
  assertFixtureLog(
    log,
    [
      { on: 'transport', kind: 'sendAudio' },
      { on: 'transport', kind: 'transfer' }
    ],
    [],
    [],
    []
  )
})

test('swapped expect fails', () => {
  assert.throws(
    () =>
      assertFixtureLog(
        log,
        [
          { on: 'transport', kind: 'transfer' },
          { on: 'transport', kind: 'sendAudio' }
        ],
        [],
        [],
        []
      ),
    /expect\[1\] not found/
  )
})

test('forbid violation fails', () => {
  const transferFirst: Array<EventLogEntry> = [
    { t: 0, on: 'transport', kind: 'transfer', destinationNumber: '+15550001000' },
    { t: 1, on: 'transport', kind: 'sendAudio', bytes: 320 }
  ]
  assert.throws(
    () =>
      assertFixtureLog(
        transferFirst,
        [{ on: 'transport', kind: 'sendAudio' }],
        [{ on: 'transport', kind: 'transfer', before: 0 }],
        [],
        []
      ),
    /forbid\[0\] matched/
  )
})

test('count violation fails', () => {
  const doubled: Array<EventLogEntry> = [
    ...log,
    { t: 4, on: 'agentSocket', kind: 'send', messageType: 'InjectAgentMessage' }
  ]
  assert.throws(
    () =>
      assertFixtureLog(
        doubled,
        [{ on: 'agentSocket', kind: 'send', messageType: 'InjectAgentMessage' }],
        [],
        [{ on: 'agentSocket', kind: 'send', messageType: 'InjectAgentMessage', exactly: 1 }],
        []
      ),
    /count\[0\] expected exactly 1, found 2/
  )
})

test('forbidContent with no matching entries fails', () => {
  assert.throws(
    () =>
      assertFixtureLog(
        log,
        [{ on: 'agentSocket', kind: 'send', messageType: 'InjectAgentMessage' }],
        [],
        [],
        [
          {
            on: 'agentSocket',
            kind: 'send',
            messageType: 'DoesNotExist',
            notContaining: ['8am']
          }
        ]
      ),
    /forbidContent\[0\] matched no log entries/
  )
})
