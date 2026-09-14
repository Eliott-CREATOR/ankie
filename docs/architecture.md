# Ankie — architecture index

This is a map, not a second design doc — the point is navigation. For the actual design, follow
the links below rather than expecting this file to stay in sync with them on its own.

```
   Claude conversation  (claude.ai · desktop · Cowork · Code)
              │
              │  MCP — ankie_add_words(...)
              ▼
   ┌────────────────────────────────────────┐
   │  Cloudflare Worker      (free tier)    │
   │  · remote MCP server (createMcpHandler)│
   │  · REST API for the PWA                │
   │  · behind Cloudflare Access            │
   └───────────────┬────────────────────────┘
                   │  D1 (SQLite)
                   ▼
   ┌────────────────────────────────────────┐
   │  Cloudflare Pages — the PWA            │
   │  · Dexie / IndexedDB mirror            │
   │  · ts-fsrs              (scheduling)   │
   │  · fsrs-browser WASM    (optimizer)    │
   │  · speechSynthesis      (audio)        │
   │  · sync on foreground                  │
   └────────────────────────────────────────┘
```

In practice this runs as **one Worker, one origin**, not the two-box split the diagram above
suggests — `apps/worker` serves both the REST/MCP API and `apps/web`'s static build, and
`apps/web` is never deployed standalone. Same-origin avoids a cross-origin auth flow redirecting
into a login page instead of returning a clean API response to `fetch()`, which is what a
two-origin split would hit as soon as the Worker sits behind auth. See AGENTS.md, "Deployment
architecture," for the full reasoning and the build-order coupling this shape introduces.

- **Full design** — `docs/spec.md`.
- **Build order and gates** — `docs/roadmap.md`.
- **Current state** — `docs/agent-handoff.md`.
