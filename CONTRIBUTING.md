# Contributing

## Setup

```bash
corepack enable && pnpm install
pnpm dev
```

## Before you open a PR

```bash
pnpm check   # prettier, eslint, tsc, vitest in every package
```

CI runs the same checks plus a bot smoke test and a Docker smoke test.

## Rules of thumb

- **Gameplay rules live in `packages/shared`** and must stay deterministic and free of DOM/Node APIs, so the
  server and the client's prediction always agree. Add a test for every rule you change.
- **Never trust the client.** Every new client message needs a zod schema in `packages/shared/src/protocol.ts`
  and a server-side test for the invalid cases.
- **Protocol changes** touch both sides in the same PR.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:` ...).
- Record significant decisions as a short ADR in `docs/adr/`.
