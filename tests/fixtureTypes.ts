import { z } from 'zod'

const audioFormatSchema = z.object({
  encoding: z.enum(['mulaw', 'linear16']),
  sampleRate: z.number().int().positive()
})

const defaultAudio = {
  input: { encoding: 'mulaw' as const, sampleRate: 8000 },
  output: { encoding: 'mulaw' as const, sampleRate: 8000 }
}

const closeReasonSchema = z.enum([
  'caller_hangup',
  'transferred',
  'error',
  'server_shutdown',
  'duration_cap',
  'idle_timeout'
])

const logOnSchema = z.enum([
  'transport',
  'agentSocket',
  'session',
  'delegation',
  'bridgeConfig',
  'sessionLifecycle'
])

export const logMatcherSchema = z.object({
  on: logOnSchema,
  kind: z.string(),
  messageType: z.string().optional(),
  functionCallId: z.string().optional(),
  content: z.string().optional(),
  greeting: z.string().optional(),
  prompt: z.string().optional(),
  bytes: z.number().optional(),
  reason: z.string().optional(),
  destinationNumber: z.string().optional(),
  callerUtterance: z.string().nullable().optional(),
  callerNumber: z.string().nullable().optional(),
  bridgeSessionId: z.string().optional(),
  turnId: z.string().optional(),
  clientFallback: z.boolean().optional()
})

const contentGuardSchema = z.object({
  on: logOnSchema,
  kind: z.string(),
  messageType: z.string().optional(),
  functionCallId: z.string().optional(),
  notContaining: z.array(z.string()).min(1)
})

const callerEventSchema = z.object({
  at: z.number().nonnegative(),
  from: z.literal('caller'),
  kind: z.enum(['audio', 'close']),
  bytes: z.number().int().positive().optional(),
  reason: closeReasonSchema.optional()
})

const agentSocketEventSchema = z.object({
  at: z.number().nonnegative(),
  from: z.literal('agentSocket'),
  kind: z.enum(['open', 'control', 'audio', 'close', 'error']),
  message: z.record(z.unknown()).optional(),
  bytes: z.number().int().positive().optional(),
  code: z.number().int().optional(),
  reason: z.string().optional()
})

const clockEventSchema = z.object({
  at: z.number().nonnegative(),
  from: z.literal('clock'),
  kind: z.literal('advance')
})

const delegationResponseSchema = z.object({
  text: z.string(),
  transfer: z.boolean(),
  destination: z.string().optional()
})

const defaultBridgeCredentials = {
  bridgeToken: 'test-bridge-token',
  bridgeSecret: 'test-bridge-secret'
}

export const fixtureSchema = z.object({
  name: z.string(),
  vendor: z.enum(['twilio', 'web']).default('twilio'),
  callerNumber: z.string().nullable().default('+15555550100'),
  sessionId: z.string().default('sess_fixture'),
  bridgeCredentials: z
    .object({
      bridgeToken: z.string(),
      bridgeSecret: z.string()
    })
    .default(defaultBridgeCredentials),
  audio: z
    .object({
      input: audioFormatSchema,
      output: audioFormatSchema
    })
    .default(defaultAudio),
  delegation: z
    .object({
      delayMs: z.number().nonnegative().optional(),
      response: delegationResponseSchema.optional(),
      responses: z.array(delegationResponseSchema).optional(),
      reject: z.boolean().optional()
    })
    .default({}),
  bridgeConfig: z
    .object({
      response: z
        .object({
          companyName: z.string(),
          locale: z.string(),
          greeting: z.string(),
          filler: z.string(),
          promptAdditions: z.array(z.string()),
          transfer: z.object({
            mainLineNumber: z.string().nullable(),
            voicemailNumber: z.string().nullable()
          }),
          maxCallDurationMinutes: z.number()
        })
        .optional(),
      reject: z.boolean().optional()
    })
    .default({}),
  sessionLifecycle: z
    .object({
      reject: z.boolean().optional()
    })
    .default({}),
  note: z.string().optional(),
  preState: z
    .object({
      transportClosed: closeReasonSchema.optional()
    })
    .optional(),
  events: z.array(
    z.discriminatedUnion('from', [callerEventSchema, agentSocketEventSchema, clockEventSchema])
  ),
  expect: z.array(logMatcherSchema),
  forbid: z.array(logMatcherSchema.extend({ before: z.number().int().nonnegative() })).default([]),
  forbidContent: z.array(contentGuardSchema).default([]),
  count: z.array(logMatcherSchema.extend({ exactly: z.number().int().nonnegative() })).default([]),
  assertTimersClearAfter: z.boolean().default(false)
})

export type CallFixture = z.infer<typeof fixtureSchema>
export type LogMatcher = z.infer<typeof logMatcherSchema>
export type FixtureEvent = CallFixture['events'][number]

export function parseFixture(raw: unknown): CallFixture {
  return fixtureSchema.parse(raw)
}
