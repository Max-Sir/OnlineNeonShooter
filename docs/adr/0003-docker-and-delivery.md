# ADR 0003: Containers and delivery

**Status:** accepted

## Decision

- **Two images.** `server` (Node + one bundled file, no `node_modules`) and `web` (unprivileged nginx with
  static files). The browser only talks to nginx; `/ws` is proxied to the game server, so the client code
  always connects to its own origin (no CORS, one TLS endpoint).
- **Hardening.** Non-root users, read-only root filesystems, all capabilities dropped, `no-new-privileges`,
  resource limits, health checks, bounded logs.
- **Bundling the server** with tsup (workspace package included) keeps the runtime image small and removes
  the need for a package manager at runtime.
- **Pipelines.** CI (lint, types, tests, build, bot smoke test, compose smoke test) on every change. Publishing
  scans the image first and pushes only if the scan passes; images are multi-arch with SBOM and provenance.
- **pnpm workspace** for fast, strict installs and a single lockfile.

## Trade-offs

- nginx resolves `server` through Docker's embedded DNS (`127.0.0.11`). Other orchestrators need their own
  resolver or upstream definition in `deploy/nginx.conf`.
- Trivy blocks only fixable HIGH/CRITICAL findings, to keep the pipeline actionable. Tighten when the
  project matures.
