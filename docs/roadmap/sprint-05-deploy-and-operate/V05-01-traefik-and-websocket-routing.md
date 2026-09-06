# V05-01 — Traefik and WebSocket routing

**Depends on:** V05-00
**Blocks:** V05-03
**Touches:** `keevaris-voice`, operational DNS/Traefik config (outside either repo)

## Problem

No routing exists for this service at all. The one plausible-looking
existing router — `ws.test2.keevaris.local` on `unit-hq-api`'s
`docker-compose.yml`, port 8080 — is **not available for reuse**. I checked
what's actually behind it: `unit-hq-api`'s own supervisord config states
directly, *"Voice is php-fpm (POST /api/voice/bridge), never this
worker,"* confirming every voice bridge endpoint runs synchronously on the
main app port. Port 8080 belongs to a different, unrelated Laravel feature
— almost certainly broadcasting for the panel's own real-time UI, nothing
to do with `keevaris-voice`. Treat this as confirmed, not assumed: don't
route `keevaris-voice` through that subdomain, and don't repurpose it.

## What to build

### A dedicated subdomain

`keevaris-voice` gets its own Traefik router — e.g.
`voice.test2.keevaris.local`, matching the naming pattern of
`test2.keevaris.local` / `ws.test2.keevaris.local` without colliding with
either:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.keevaris-voice.rule=Host(`voice.test2.keevaris.local`)"
  - "traefik.http.routers.keevaris-voice.service=keevaris-voice"
  - "traefik.http.services.keevaris-voice.loadbalancer.server.port=<port>"
  - "traefik.docker.network=traefik-network"
```

Add to the `docker-compose.yml` V05-00 created.

### WebSocket upgrade support

Twilio's `<Stream>` and the browser client both connect via `wss://`.
Confirm (don't assume) that this Traefik instance passes
`Upgrade`/`Connection` headers through by default — recent Traefik
versions do this natively for HTTP routers without special configuration,
but the actual instance in front of `unit-hq-api` may have middleware or
timeout settings that weren't tuned with a long-lived WebSocket connection
in mind (an aggressive `idleTimeout` written for short HTTP requests would
silently kill an in-progress call).

Two settings to verify explicitly against Traefik's static/dynamic config,
not assume are fine by default: the read/write/idle timeouts on the
entrypoint serving this router (must exceed `MAX_CALL_SECONDS`,
comfortably — see V01-02), and whether any request-body-size or timeout
middleware chain applies to this router that was written for the API's
short-lived JSON requests.

### TLS

Whatever certificate mechanism issues certs for `test2.keevaris.local` and
`ws.test2.keevaris.local` today should cover the new subdomain the same
way (wildcard cert, or an additional SAN/entry in whatever ACME
configuration exists) — this is operational config, not code, but it's a
real prerequisite for `wss://` to work at all and belongs on this task's
checklist so it isn't discovered missing during the first real call.

### Update `.env.example`

`PUBLIC_BASE_URL` (used to build the `<Stream>` webhook URL Twilio calls
back into) needs to point at the new subdomain in any deployed environment
— confirm this is set correctly per-environment, not left pointing at
`localhost` past this task.

## Acceptance criteria

- [x] `keevaris-voice` has its own Traefik router, on its own subdomain,
      not sharing or repurposing `ws.test2.keevaris.local`.
      Labels live on the `voice` service in `docker-compose.yml`,
      host `voice.test2.keevaris.local`, port 8787.
- [ ] A `wss://` connection to the new subdomain completes the WebSocket
      upgrade successfully through Traefik (verified with a real
      connection, not just `curl`). Operational — live Traefik; handed
      to V05-04's runbook.
- [ ] Entrypoint timeouts on this router are confirmed to exceed
      `MAX_CALL_SECONDS`, not just assumed to. Operational — live
      Traefik static/dynamic config; handed to V05-04's runbook.
- [ ] TLS is issued and valid for the new subdomain. Operational —
      ACME/wildcard/SAN on the existing cert mechanism; handed to
      V05-04's runbook.
- [x] `PUBLIC_BASE_URL` in the deployed environment's config points at the
      new subdomain. Dev default stays `http://localhost:8787`;
      `.env.example` now names the deployed value
      `https://voice.test2.keevaris.local`. Setting the live `.env` is
      operational and is listed in V05-04.

## Out of scope

- **Sticky sessions / session affinity.** Not needed while `keevaris-voice`
  runs as a single instance (today's reality, and V05-02's starting point
  even after a Redis-backed registry lands — a WebSocket connection is
  inherently sticky to whichever process accepted it; affinity only
  matters for *new* connection routing across multiple instances, which
  isn't attempted in this sprint).
- **A CDN or edge layer in front of Traefik.** Not part of the existing
  stack for `unit-hq-api`; not introduced here either.
