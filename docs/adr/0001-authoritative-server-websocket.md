# ADR 0001: Authoritative server over WebSocket (TypeScript)

**Status:** accepted

## Context

An online shooter needs low latency, resistance to cheating, and a browser client that works everywhere
without plugins. A small team must be able to build and run it.

## Options

1. **Authoritative server over WebSocket**, TypeScript on Node.js.
2. Peer-to-peer over WebRTC data channels.
3. Dedicated engine (Unity/Godot) with a native netcode library.
4. WebTransport/UDP-like datagrams.

## Decision

Option 1. The server owns the simulation; clients send inputs and render snapshots.

## Trade-offs

- WebSocket runs on TCP, so head-of-line blocking can add latency spikes on lossy networks. At 15 snapshots/s
  and small messages this is acceptable for a casual shooter, and the protocol is isolated in
  `packages/shared`, so moving to WebTransport later only touches the transport layer.
- P2P would reduce server cost but makes cheating trivial and NAT traversal painful.
- Sharing TypeScript between server and client lets us run the exact same movement code for prediction.
- JSON is verbose, but readable and fast to iterate on. Messages are tiny; a binary encoding is a measurable
  optimisation to do later, not a premature one to do now.
