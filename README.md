# Neon Arena

A browser-based, real-time multiplayer top-down shooter. Authoritative Node.js game server, Canvas 2D
client with client-side prediction and entity interpolation, TypeScript end to end, Docker-ready, with CI/CD
pipelines. It runs on desktop and mobile browsers (keyboard + mouse, or dual-stick touch controls).

## Quick start

**Docker (everything, production-like):**

```bash
cp .env.example .env      # optional
docker compose up --build # or: make up
# open http://localhost:8080 in two browser tabs
```

**Local development (hot reload):**

```bash
corepack enable           # provides the pinned pnpm version
pnpm install
pnpm dev                  # server on :8080, client on http://localhost:5173
```

Requires Node.js 22+ (`.nvmrc` pins the version used in CI and Docker).

## Commands

| Command                 | What it does                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `make help`             | List all make targets                                         |
| `pnpm check`            | Format check + lint + typecheck + all tests (run before a PR) |
| `pnpm test:coverage`    | Tests with coverage in every package                          |
| `pnpm build`            | Production build (server bundle + static client)              |
| `make up` / `make down` | Start / stop the Docker stack                                 |
| `make bots`             | Connect 16 bots to a running server (smoke and load test)     |
| `make docker-test`      | Start the stack, run bots through nginx, tear down            |

## Repository layout

```
apps/
  server/      Authoritative WebSocket game server (ws + zod), rooms, rate limiting, health/metrics
  client/      Vite + TypeScript Canvas client: input, prediction, interpolation, HUD, touch controls
packages/
  shared/      Game simulation, constants and wire protocol used by BOTH server and client
deploy/        Dockerfiles and nginx config
docs/adr/      Architecture decision records
.github/       CI, image publishing, CodeQL, Dependabot
```

## How it works

- **Server authority.** Clients send only inputs (`mx, my, angle, shoot`). The server runs the simulation at
  30 Hz, validates every message with zod, and broadcasts snapshots at 15 Hz. Clients cannot set positions,
  health or damage.
- **One simulation, two places.** Movement and collision live in `packages/shared`. The client runs the same
  `movePlayer` function for prediction, so the local player feels instant and corrections are invisible when
  client and server agree. Bullets are swept (segment vs. shape) so fast bullets never tunnel through players.
- **Smooth remote players.** The client renders other players 100 ms in the past, interpolating between
  buffered snapshots.
- **Rooms.** Players are placed in the fullest room that has space. Rooms are created on demand and removed
  when empty (`MAX_ROOMS`, `MAX_PLAYERS_PER_ROOM`).

### Operational endpoints (game server)

| Path       | Purpose                                                     |
| ---------- | ----------------------------------------------------------- |
| `/healthz` | Liveness (also exposed through nginx)                       |
| `/readyz`  | Readiness; returns 503 while shutting down (also via nginx) |
| `/metrics` | Prometheus text format (**not** exposed through nginx)      |

### Security measures

Strict message validation and size limit (2 KB), token-bucket rate limiting per connection, input-queue cap
(no speed-hacking by bursting), per-IP connection limit, optional Origin allow-list, text-only frames,
heartbeat to drop dead sockets, backpressure handling for slow clients, graceful shutdown on SIGTERM.
Containers run as non-root with read-only filesystems and all capabilities dropped; nginx sends a strict CSP.

## Configuration

All settings are environment variables, validated at startup (see [`.env.example`](.env.example) and
`apps/server/src/config.ts`). **Set `ALLOWED_ORIGINS` to your real site origin in production.**

## CI/CD

| Workflow                 | Trigger              | What it does                                                                                                   |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                 | push, pull request   | Format, lint, typecheck, tests + coverage, build, bot smoke test, Docker compose smoke test, dependency review |
| `docker-publish.yml`     | push to `main`, tags | Build, Trivy scan (blocks on fixable HIGH/CRITICAL), multi-arch push to GHCR, SBOM + provenance                |
| `codeql.yml`             | push, PR, weekly     | Static security analysis                                                                                       |
| `.github/dependabot.yml` | weekly               | Dependency, Docker and Actions updates                                                                         |

Release: push a tag like `v0.1.0` to publish versioned images.

## Deploying

Run the two images (`ghcr.io/<owner>/<repo>/server` and `/web`) behind TLS (any reverse proxy, load balancer
or platform that supports WebSockets). The web image expects the game server to be reachable as `server:8080`
(Docker DNS name); override `deploy/nginx.conf` for other orchestrators. A room lives in one server process,
so scale out by running more server instances behind a matchmaker; see
[`docs/adr/0004-scaling.md`](docs/adr/0004-scaling.md).

## Status and known limits

This is a solid foundation, not a finished game. Intentionally not included yet: accounts and persistence,
matchmaking across multiple server instances, lag-compensated hit detection, anti-cheat beyond server
authority, audio, and art assets. See the ADRs for the planned path.
