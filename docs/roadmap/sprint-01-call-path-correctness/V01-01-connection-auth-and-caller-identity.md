# V01-01 — Connection authentication and the caller-number trust boundary

**Depends on:** V01-00
**Blocks:** nothing in this sprint; blocks launch
**Touches:** `keevaris-voice`

## Problem

Two separate holes that happen to share a socket.

**Anyone can open a session.** `server.on('upgrade')` resolves a transport module by
pathname and hands the socket straight to `wss.handleUpgrade`. No credential is checked on
`/twilio/media` or on `/web/media`. Anyone who can reach the process gets a live Deepgram
agent on our spend and a live delegation channel into `unit-hq-api`. The bridge secret
protects the HTTP hop to the API; it protects nothing here.

**The caller number is client-supplied.** `TwilioTransport` reads `From` out of
`start.customParameters` and stores it as `callerNumber`. That value is sent to the bridge
endpoint, where `VoiceCallerIdentity::resolve()` matches it to a contact, and
`VoiceBridgeTurn::audienceAllows` uses the resulting `contactId` to decide whether a
`KnownContacts` or `ExistingTenants` binding may answer at all.

So: connect to `/twilio/media`, send a `start` frame naming any phone number, and you are
that tenant as far as the audience gate is concerned. The parameter round-trips through
Twilio in the legitimate case, but nothing verifies the connection came from Twilio, which
makes the round trip decorative.

S28 accepted `channel_asserted` as the ceiling for voice because caller ID is spoofable at
the telephony layer. That was a reasoned position about a hard problem. This is a different
thing: an unauthenticated HTTP endpoint that accepts an identity claim as a JSON field.

## What to build

### A call registry, and a nonce instead of a phone number

`/twilio/voice` is already signature-validated, and it is the only place where Twilio's
claims about a call are trustworthy. Use it as the source:

1. On the webhook, after signature validation, mint a single-use nonce (`randomUUID` or 32
   bytes of `randomBytes`, hex).
2. Store `{ callSid, from, to, createdAt }` against that nonce with a short TTL (60s is
   generous — Twilio connects the stream immediately).
3. Emit **only** the nonce as a `<Parameter>`. Stop putting `From` in the TwiML.
4. On the `start` frame, read the nonce, look it up, and delete it. Reject the socket if the
   nonce is unknown, expired, already consumed, or if `start.callSid` does not equal the
   stored `callSid`.
5. Populate `callerNumber` from the registry, never from the frame.

Define this as a `CallRegistry` interface with `put` / `take` and an in-process `Map`
implementation. One instance is the current deployment reality; a Redis implementation is
V05-02 and must not require touching the transport.

Rejections close with a policy-violation code and log the claimed `CallSid` and the source
address at `warn`. Do not log the nonce.

### A minted token for `/web/media`

The web transport stays live through launch, so it needs the same treatment. It has no
webhook to anchor to, so use a signed token:

- A token is `{ sessionId, expiresAt, purpose }` with an HMAC-SHA256 signature over a shared
  secret (`WEB_TOKEN_SECRET`), passed as a query parameter on the upgrade. Short expiry,
  measured in minutes.
- The socket is refused if the signature fails, the token is expired, or `sessionId` has
  already been used.
- `WebTransport.sessionId` comes from the token, not from `randomUUID()` inside the
  constructor. The minter decides the session id; that is what lets the API correlate the
  session later.

The production minter is `unit-hq-api` — the same secret, a new endpoint — but that endpoint
is V08's work, when the panel copilot actually moves onto this transport. For this sprint,
`public/dev.html` gets its token from a local `GET /dev/token` route that is **registered
only when `ALLOW_DEV_PAGE` is true**, and that flag defaults to false. Nothing about the dev
page may exist in a production process.

### A concurrency ceiling

Independent of authentication: cap concurrent sessions (`MAX_CONCURRENT_SESSIONS`, default
low enough to be a real limit) and refuse the upgrade past it with a logged counter. A bug
that opens sockets in a loop should cost a log line and a refused connection, not a Deepgram
bill.

## Acceptance criteria

- [ ] `/twilio/voice` mints a nonce, stores it against `CallSid`/`From`/`To`, and the TwiML
      no longer carries `From`.
- [ ] A `start` frame with an unknown, expired, reused, or `CallSid`-mismatched nonce closes
      the socket and logs at `warn`.
- [ ] `TwilioTransport.callerNumber` reads only from the registry.
- [ ] `/web/media` refuses a connection without a valid unexpired token; `sessionId` comes
      from the token.
- [ ] `GET /dev/token` is not registered unless `ALLOW_DEV_PAGE=true`, and the default is
      false.
- [ ] `MAX_CONCURRENT_SESSIONS` is enforced at upgrade.
- [ ] `CallRegistry` is an interface; the in-process implementation is the only one shipped
      and nothing outside it assumes a `Map`.
- [ ] Harness fixtures cover: forged `start` frame, replayed nonce, `CallSid` mismatch,
      expired web token, concurrency ceiling.

## Out of scope

- **Redis-backed registry and multi-instance operation.** V05-02. Until then the service
  runs as one process and the deploy must say so.
- **The API-side web token endpoint.** V08.
- **An IP allowlist for Twilio egress.** Worth having as defence in depth, and it is
  operational configuration rather than code. Record it in the V05 runbook.
- **Raising the verification ceiling above `channel_asserted`.** This task closes an
  authentication hole; it does not make caller ID trustworthy. Account questions remain
  transfers.
