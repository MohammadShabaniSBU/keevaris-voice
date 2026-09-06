# V05-00 — Container and compose

**Depends on:** nothing — first task of the sprint
**Blocks:** V05-01, V05-02
**Touches:** `keevaris-voice`

## Problem

There is no `Dockerfile`, no compose file, nothing. `package.json` already
has the scripts a container needs (`build` → `tsc`, `start` → `node
dist/index.js`), and `devEngines.packageManager` pins pnpm `^11.10.0` — the
pieces are there, just never assembled into something deployable.

## What to build

### Multi-stage `Dockerfile`

Two stages: build (install all deps including dev, `pnpm run build`), then
runtime (production deps only, copy `dist/`, copy `public/` only if
`ALLOW_DEV_PAGE` builds ever need it — see the note below). Base image:
plain `node:22-alpine`, not `webdevops/php-nginx` — that image is
`unit-hq-api`'s PHP/nginx stack and has nothing to offer a Node service;
matching conventions means matching the *deployment* pattern (networks,
labels, logging), not the base image.

Runtime stage runs as a non-root user (`node` user, already present in the
official image) — this service terminates the Twilio/browser WebSocket
directly and holds bridge secrets in memory; running as root buys nothing
and widens the blast radius of any future RCE.

`public/dev.html` should **not** ship in the production image. It's
already gated behind `ALLOW_DEV_PAGE=false` by default (V01-01), but
"disabled by config" and "absent from the image" are different guarantees
— the safer one costs nothing extra here. Exclude `public/` from the
runtime stage's `COPY`; anyone who needs the dev page runs from source
locally, which is what it was built for anyway.

### `docker-compose.yml`

Match `unit-hq-api`'s conventions, checked directly rather than guessed:

```yaml
services:
  voice:
    build: .
    container_name: keevaris-voice
    networks:
      - traefik-network
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"
```

No `postgres-network` — this service has no database of its own; every
piece of durable state it needs goes through `unit-hq-api`. Traefik labels
are V05-01's job, not duplicated here.

### `.dockerignore`

`node_modules`, `.git`, `tests/`, `docs/`, `*.md` except a top-level
`README.md` if the image should carry one. Keeps build context small and
keeps `tests/fixtures/` (which will grow) from ever accidentally leaking
into a build layer.

## Acceptance criteria

- [ ] `docker build .` succeeds and produces a runtime image without dev
      dependencies.
- [ ] The running container is non-root.
- [ ] `public/dev.html` is not present in the built image
      (`docker run --rm <image> ls public` fails or shows nothing).
- [ ] `docker compose up` starts the service, and `curl localhost:<port>/health`
      returns 200 from inside the compose network.
- [ ] Image size is checked and sane for a Node service (a bloated image
      here usually means the build stage's `node_modules` leaked into
      runtime — verify it didn't).

## Out of scope

- **Traefik labels and subdomain routing.** V05-01.
- **Health check semantics beyond "the process is up."** V05-03 makes
  `/health` mean something; this task just makes sure a container exists
  for it to run in.
- **CI building and pushing this image.** Whether/how this plugs into a
  registry or CI pipeline is an operational decision outside this sprint's
  code changes — note it in V05-04's runbook instead.
