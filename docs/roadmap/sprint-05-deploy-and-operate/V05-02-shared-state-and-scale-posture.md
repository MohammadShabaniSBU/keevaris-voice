# V05-02 — Shared state and scale posture

**Depends on:** V05-00
**Blocks:** V05-03
**Touches:** `keevaris-voice`

## Problem

`CallRegistry` (`src/transport/twilio/CallRegistry.ts`) is an interface
with exactly one implementation, `InProcessCallRegistry`, backed by a plain
`Map`. This was deliberately built as an interface back in V01-01 so this
moment — swapping the implementation without touching `TwilioTransport` —
would be a config change, not a rewrite. That promise hasn't been tested
until now.

The single-instance assumption this carries is real, not theoretical: the
nonce a Twilio webhook mints and the `start` frame that redeems it can, in
a multi-instance deployment, land on two different processes (whichever
one Traefik's load balancer happens to route the initial webhook POST to
versus whichever one accepts the subsequent WebSocket upgrade). An
in-process `Map` on process A is invisible to process B — every call would
fail nonce validation the moment more than one instance runs.

## What to build

### `RedisCallRegistry`

New implementation of `CallRegistry`, using Redis's `SET key value PX
<ttlMs> NX` for `put()` (atomic set-with-expiry, matching the interface's
existing TTL parameter exactly) and `GET` + `DEL` for `take()` — or, more
correctly, a single `GETDEL` (Redis 6.2+) to make the single-use
read-and-delete atomic, avoiding a race where two instances could both
successfully redeem the same nonce in the narrow window between a separate
`GET` and `DEL`. If `GETDEL` isn't available in the deployed Redis
version, a small Lua script (`EVAL`) doing get-then-delete atomically is
the correct fallback — don't implement it as two separate round trips.

Constructor takes a Redis client (whatever client library is chosen —
check if `unit-hq-api` already depends on a specific Redis client/service
for its own queues, and prefer consistency if there's a clear existing
choice; otherwise `ioredis` is the standard, well-maintained option for
Node).

### Config-driven selection

`config.ts` gains `CALL_REGISTRY_BACKEND` (`'memory' | 'redis'`, default
`'memory'`) and `REDIS_URL` (required only when the backend is `'redis'`).
`index.ts` constructs whichever implementation the config selects. The
default stays `'memory'` — this task makes multi-instance operation
*possible*, it doesn't force it; a deployment that's staying single-instance
for now shouldn't need to stand up Redis just to run.

### Connection lifecycle

The Redis client's own connection failures must not crash the process or
silently accept every nonce as valid (a fail-open bug here is an
authentication bypass). On a Redis error during `put()`/`take()`, log and
treat it as "nonce invalid" (fail closed) — a caller who hits this gets a
rejected connection and a real phone call retry, which is a far better
failure mode than every unauthenticated connection succeeding because
Redis happened to be unreachable for a few seconds.

### Tests

`tests/transport/twilio/RedisCallRegistry.test.ts`, against a real Redis
instance if the test environment has one available (docker-compose test
profile), or against `ioredis-mock`/similar if a real instance isn't
practical in CI — state the choice and why, don't silently pick the
lower-fidelity option without saying so. Cover: put/take round trip
(matching `CallRegistry.test.ts`'s existing coverage for the in-process
version), TTL expiry, the atomicity of single-use redemption under
concurrent `take()` calls for the same nonce (two simultaneous takes, only
one should succeed), and the fail-closed behavior on a simulated
connection error.

## Acceptance criteria

- [ ] `RedisCallRegistry implements CallRegistry` with no changes required
      to `TwilioTransport` or anything else that consumes the interface.
- [ ] Single-use redemption is atomic — no race window where two
      concurrent `take()` calls for the same nonce both succeed.
- [ ] A Redis connection failure fails closed (rejects the connection),
      never fails open.
- [ ] `CALL_REGISTRY_BACKEND=memory` (the default) requires no Redis and
      behaves exactly as today.
- [ ] `CALL_REGISTRY_BACKEND=redis` is exercised in at least one
      integration-level test against a real or high-fidelity Redis
      instance.

## Out of scope

- **Migrating any other in-memory state to Redis.** `CallRegistry` is the
  one piece with a genuine multi-instance correctness problem; other
  per-connection state (the `SpeechKind` queue, transcript buffers) lives
  and dies with its own WebSocket connection and has no cross-instance
  concern.
- **Actually running more than one instance in production.** This task
  makes it correct to; whether/when to actually do it is an operational
  decision for whoever owns capacity planning, informed by V04-02's p95
  numbers.
- **Redis high availability / clustering.** A single Redis instance is
  sufficient for this task's purpose (a short-TTL nonce store); HA is an
  infrastructure decision independent of this codebase.
