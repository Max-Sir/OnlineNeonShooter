# ADR 0004: Scaling path

**Status:** proposed

## Current state

One server process holds all rooms in memory. A single room costs little CPU (see `neon_tick_ms_avg` /
`neon_tick_ms_max` in `/metrics`); measure with `make bots` before choosing limits.

## Plan

1. **Vertical first.** Raise `MAX_ROOMS` while tick time stays well under the 33 ms budget. Node is single
   threaded, so one process uses one core.
2. **Horizontal.** Run several server instances. A room is never shared between instances, so a small
   matchmaker service (or a load balancer with sticky routing by room id) assigns players to an instance.
   Rooms stay in-process; no shared state is required for gameplay.
3. **If one process becomes the limit:** move rooms into `worker_threads` (one room per thread) before
   adding infrastructure.
4. **Persistence and accounts** (stats, ranks) belong in a separate service with its own database, called
   asynchronously from the game server so gameplay never waits on I/O.

## Trade-offs

Keeping rooms in memory makes deploys disconnect players. Mitigation: readiness flips to 503 on SIGTERM so
new players are routed away while current matches finish within `stop_grace_period`.
