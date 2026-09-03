import type { TestContext } from 'node:test'
import { DeepgramVoiceAgent } from '../src/agent/deepgram/DeepgramVoiceAgent.js'
import { config } from '../src/config.js'
import { VoiceSession } from '../src/session/VoiceSession.js'
import type { EventLogEntry } from './support/EventLog.js'
import { EventLog } from './support/EventLog.js'
import { DeepgramSocketDouble } from './support/DeepgramSocketDouble.js'
import { FakeTransport } from './support/FakeTransport.js'
import { KeevarisClientStub } from './support/KeevarisClientStub.js'
import type { CallFixture, LogMatcher } from './fixtureTypes.js'

export function entryMatches(entry: EventLogEntry, matcher: LogMatcher): boolean {
  for (const [key, value] of Object.entries(matcher)) {
    if (key === 'before' || key === 'exactly') continue
    if (value === undefined) continue
    if (entry[key] !== value) return false
  }

  return true
}

export function assertFixtureLog(
  log: Array<EventLogEntry>,
  expect: CallFixture['expect'],
  forbid: CallFixture['forbid'],
  count: CallFixture['count']
): void {
  const observed = JSON.stringify(log, null, 2)
  const positions: Array<number> = []
  let from = 0

  for (const [index, matcher] of expect.entries()) {
    const idx = log.findIndex((entry, i) => i >= from && entryMatches(entry, matcher))
    if (idx === -1) {
      throw new Error(
        `expect[${index}] not found after index ${from}: ${JSON.stringify(matcher)}\nobserved:\n${observed}`
      )
    }
    positions.push(idx)
    from = idx + 1
  }

  for (const [index, forbidden] of forbid.entries()) {
    const beforeIndex = positions[forbidden.before]
    if (beforeIndex === undefined) {
      throw new Error(`forbid[${index}].before ${forbidden.before} is out of range for expect`)
    }
    const found = log.slice(0, beforeIndex).find((entry) => entryMatches(entry, forbidden))
    if (found !== undefined) {
      throw new Error(
        `forbid[${index}] matched before expect[${forbidden.before}]: ${JSON.stringify(forbidden)}\nobserved:\n${observed}`
      )
    }
  }

  for (const [index, counted] of count.entries()) {
    const n = log.filter((entry) => entryMatches(entry, counted)).length
    if (n !== counted.exactly) {
      throw new Error(
        `count[${index}] expected exactly ${counted.exactly}, found ${n}: ${JSON.stringify(counted)}\nobserved:\n${observed}`
      )
    }
  }
}

function drain(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

export async function runFixture(fixture: CallFixture, t: TestContext): Promise<void> {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })

  const log = new EventLog()
  const transport = new FakeTransport(log, {
    vendor: fixture.vendor,
    sessionId: fixture.sessionId,
    callerNumber: fixture.callerNumber,
    audioInput: fixture.audio.input,
    audioOutput: fixture.audio.output
  })

  let socket: DeepgramSocketDouble | undefined
  const keevaris = new KeevarisClientStub(fixture.delegation)

  if (fixture.preState?.transportClosed !== undefined) {
    transport.simulateClose(fixture.preState.transportClosed)
  }

  const agent = new DeepgramVoiceAgent(fixture.sessionId, config.companyName, () => {
    socket = new DeepgramSocketDouble(log)
    return socket
  })

  const session = new VoiceSession({
    transport,
    agent,
    keevaris,
    companyName: config.companyName
  })

  const sessionStartPromise = session.start()
  sessionStartPromise.catch(() => {})
  await drain()

  const events = [...fixture.events].sort((a, b) => a.at - b.at)
  let now = 0
  for (const event of events) {
    const gap = event.at - now
    if (gap > 0) {
      t.mock.timers.tick(gap)
    }
    now = event.at
    await drain()

    if (event.from === 'caller') {
      if (event.kind === 'audio') {
        transport.pushAudio(Buffer.alloc(event.bytes ?? 160))
      } else {
        transport.simulateClose(event.reason ?? 'caller_hangup')
      }
    } else {
      if (socket === undefined) {
        throw new Error(`agent socket not created before event at ${event.at}`)
      }
      switch (event.kind) {
        case 'open':
          socket.simulateOpen()
          break
        case 'control':
          socket.sendControl(event.message ?? {})
          break
        case 'audio':
          socket.sendAudioFrame(Buffer.alloc(event.bytes ?? 320))
          break
        case 'close':
          socket.simulateClose(event.code, event.reason)
          break
        case 'error':
          socket.simulateError(new Error(event.reason ?? 'socket error'))
          break
        default:
          break
      }
    }

    await drain()
  }

  await drain()

  assertFixtureLog(log.entries, fixture.expect, fixture.forbid, fixture.count)

  if (fixture.assertTimersClearAfter) {
    const before = log.entries.length
    t.mock.timers.tick(24 * 60 * 60 * 1000)
    await drain()
    if (log.entries.length !== before) {
      throw new Error(
        `timers still pending after teardown: log grew from ${before} to ${log.entries.length}`
      )
    }
  }
}
