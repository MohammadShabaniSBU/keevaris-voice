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

export const logMatcherSchema = z.object({
  on: z.enum(['transport', 'agentSocket']),
  kind: z.string(),
  messageType: z.string().optional(),
  bytes: z.number().optional(),
  reason: z.string().optional(),
  destinationNumber: z.string().optional()
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

export const fixtureSchema = z.object({
  name: z.string(),
  vendor: z.enum(['twilio', 'web']).default('twilio'),
  callerNumber: z.string().nullable().default('+15555550100'),
  sessionId: z.string().default('sess_fixture'),
  audio: z
    .object({
      input: audioFormatSchema,
      output: audioFormatSchema
    })
    .default(defaultAudio),
  delegation: z
    .object({
      delayMs: z.number().nonnegative().optional(),
      response: z
        .object({
          text: z.string(),
          transfer: z.boolean(),
          destination: z.string().optional()
        })
        .optional(),
      reject: z.boolean().optional()
    })
    .default({}),
  note: z.string().optional(),
  preState: z
    .object({
      transportClosed: closeReasonSchema.optional()
    })
    .optional(),
  events: z.array(z.discriminatedUnion('from', [callerEventSchema, agentSocketEventSchema])),
  expect: z.array(logMatcherSchema),
  forbid: z.array(logMatcherSchema.extend({ before: z.number().int().nonnegative() })).default([]),
  count: z.array(logMatcherSchema.extend({ exactly: z.number().int().nonnegative() })).default([]),
  assertTimersClearAfter: z.boolean().default(false)
})

export type CallFixture = z.infer<typeof fixtureSchema>
export type LogMatcher = z.infer<typeof logMatcherSchema>
export type FixtureEvent = CallFixture['events'][number]

export function parseFixture(raw: unknown): CallFixture {
  return fixtureSchema.parse(raw)
}
