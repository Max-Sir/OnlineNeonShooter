# ADR 0002: Shared simulation, client prediction, entity interpolation

**Status:** accepted

## Context

Waiting for the server round trip before the local player moves makes controls feel laggy.
Rendering remote players from raw snapshots looks jittery.

## Decision

- Movement and collision code lives in `packages/shared` and is used by both sides.
- The client sends one input per simulation tick (same rate as the server), applies it locally at once, and
  keeps unacknowledged inputs. On each snapshot it snaps to the server state and replays pending inputs
  (reconciliation).
- Remote players and bullets are rendered ~100 ms in the past, interpolated between buffered snapshots.
- Bullet hits use swept segment tests, so they do not depend on tick rate or bullet speed.

## Trade-offs

- Fixed-rate inputs keep prediction exactly in sync with the server, but a client whose timer jitters can
  have inputs dropped when the server queue is capped (4). That is deliberate: it prevents speed hacks.
- No lag compensation for shooting yet: you must lead targets by the render delay plus latency. Server-side
  rewind of hit detection is the next planned improvement.
