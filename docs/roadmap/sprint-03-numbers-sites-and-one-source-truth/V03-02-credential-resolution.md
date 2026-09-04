# V03-02 — Multi-number credential resolution

**Depends on:** V03-00
**Blocks:** V03-03
**Touches:** `keevaris-voice`

## Problem

`config.keevaris.bridgeToken`/`bridgeSecret` are read once at boot from
`KEEVARIS_BRIDGE_TOKEN`/`KEEVARIS_BRIDGE_SECRET` and used globally —
`KeevarisClient` builds its request URL from `config.keevaris.bridgeToken`
directly (`bridgeUrl()` in `src/delegation/KeevarisClient.ts`), and
`handleTransportConnection` in `src/index.ts` constructs one
`KeevarisClient` per connection with no per-call parameter at all. There is
exactly one credential this whole process can ever authenticate as.

This can't be fixed by fetching per-site credentials from the API at call
time — `VoiceBridgeAuth::authenticate()` requires the secret already, so
asking the API "what's the secret for this number" would need its own
credential to ask with, which is the same problem one level up. The set of
`(phone_number, bridge_token, bridge_secret)` tuples this service can act as
has to be configured into it directly, the same trust boundary
`KEEVARIS_BRIDGE_SECRET` already sits behind.

What moves to being API-sourced in this sprint is the *content* a resolved
token unlocks — greeting, prompt, transfer numbers, company name (V03-03).
The credential itself stays local configuration, for the structural reason
above, not because it's an oversight.

## What to build

### Multi-number credentials in env

Replace the three single-value vars with one JSON array:

```
VOICE_BRIDGE_NUMBERS=[{"phoneNumber":"+15555550100","bridgeToken":"tok_a","bridgeSecret":"sec_a"},{"phoneNumber":"+15555550199","bridgeToken":"tok_b","bridgeSecret":"sec_b"}]
```

`src/config.ts`: parse and validate with zod
(`z.array(z.object({ phoneNumber: z.string(), bridgeToken: z.string(),
bridgeSecret: z.string() }))`), reject at boot (same fail-fast pattern every
other env var already follows) if the array is empty, has a duplicate
`phoneNumber`, or fails to parse as JSON. `KEEVARIS_BRIDGE_TOKEN`/
`KEEVARIS_BRIDGE_SECRET` are removed — not kept as a fallback, since a
silent single-number fallback is exactly the kind of implicit behavior this
sprint exists to eliminate. `.env.example` gets one commented example entry.

Build a lookup at boot: `Map<phoneNumber, { bridgeToken, bridgeSecret }>`,
exposed as `config.voiceBridgeNumbers` (the map) plus a
`resolveBridgeCredentials(phoneNumber: string)` helper returning `undefined`
on no match.

### Resolve at the webhook, store in the call registry

`handleTwilioVoiceWebhook` (`src/index.ts`) currently ignores `params.To`
entirely. Add resolution immediately after signature validation:

```ts
const credentials = resolveBridgeCredentials(params.To ?? '')
if (credentials === undefined) {
  logger.warn({ to: params.To, callSid: params.CallSid }, 'twilio.unknown_number')
  response.writeHead(404, { 'Content-Type': 'text/plain' })
  response.end('Not found')
  return
}
```

`CallRegistryEntry` (`src/transport/twilio/CallRegistry.ts`) gains
`bridgeToken: string` and `bridgeSecret: string` alongside `callSid`/`from`/
`to`. `TwilioTransport`'s `'start'` handler already reads the registry entry
by nonce (V01-01) — extend it to also expose the resolved credentials on the
`Transport`, not just `callerNumber`.

### Thread the credential through instead of reading global config

`Transport` (`src/transport/Transport.ts`) gains a readonly
`bridgeCredentials: { bridgeToken: string; bridgeSecret: string }` alongside
`sessionId`/`callerNumber`. `WebTransport` needs a value too — see below.

`KeevarisClient` stops reading `config.keevaris.bridgeToken`/`bridgeSecret`
from the global config object. Constructor takes them instead:
`new KeevarisClient(transport.bridgeCredentials)`. `handleTransportConnection`
in `index.ts` passes `transport.bridgeCredentials` at construction time,
after `transport` exists — this is why `KeevarisClient` is currently built
inside `handleTransportConnection` rather than earlier; that ordering
doesn't change.

`config.keevaris.apiUrl` and `config.keevaris.timeoutMs` stay global — the
API base URL and request timeout are deployment-wide operational settings,
not per-site content, and splitting them per number would be structure
without a reason.

### `/web/media`: which credential does a browser session get?

`WebTransport` has no `To` number — nothing in a browser connection
identifies which site it's for. For this task, mint the web token
(`WebTokenService.mint`) with the target `phoneNumber` as an additional
claim, and have the panel's copilot caller (V08's eventual concern, not this
task) pass which number/site it wants when requesting a token. Until V08
wires up a real caller, `/dev/token` defaults to the *first* entry in
`VOICE_BRIDGE_NUMBERS` — document this default explicitly in
`WebToken.ts`'s comment and in `.env.example`, since it's a placeholder
decision, not a considered one.

### Fixtures

`FakeTransport` gains a `bridgeCredentials` field, defaulted in
`fixtureTypes.ts` the same way `sessionId` and `callerNumber` already are.
New fixture `multi-number-resolves-correct-credentials.json` isn't
expressible as a call-scripted fixture in the existing sense (it's about
webhook behavior before any transport exists) — write it as a plain
`node:test` file, `tests/index/webhookNumberResolution.test.ts`, following
the same "plain `node:test` for pre-transport behavior" pattern V01-01
established for connection auth. Cover: known `To` resolves the right
token/secret; unknown `To` returns 404 and logs `twilio.unknown_number`;
duplicate `phoneNumber` in config rejects at boot.

## Acceptance criteria

- [ ] `VOICE_BRIDGE_NUMBERS` replaces `KEEVARIS_BRIDGE_TOKEN`/
      `KEEVARIS_BRIDGE_SECRET`; boot fails loudly on empty array, duplicate
      number, or malformed JSON.
- [ ] `handleTwilioVoiceWebhook` resolves `params.To`, 404s on no match,
      stores resolved credentials in the `CallRegistry` entry.
- [ ] `Transport.bridgeCredentials` is populated from the registry
      (Twilio) or the token claim (web), never from global config.
- [ ] `KeevarisClient` takes credentials at construction; nothing in it
      reads `config.keevaris.bridgeToken`/`bridgeSecret`.
- [ ] Two fixtures/tests prove two different numbers reach
      `keevaris.ask()` with two different credentials in the same test run.
- [ ] All Sprint 1/2 fixtures stay green, updated only to supply a
      `bridgeCredentials` default where the schema now requires one.

## Out of scope

- **Fetching or applying the config a resolved token unlocks.** V03-03.
- **A real per-number web-token minting flow.** V08. This task's `/dev/token`
  default-to-first-entry behavior is an explicitly temporary placeholder.
- **Hot-reloading `VOICE_BRIDGE_NUMBERS` without a restart.** A new number
  requires a redeploy, same as every other env var today.
- **Rate-limiting or per-number quotas.** Not asked for.
