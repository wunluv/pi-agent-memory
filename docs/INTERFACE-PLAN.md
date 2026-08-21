# pi-agent-memory — Interface Design Plan

> **Gate 2 deliverable.** Interface contracts for Phase 2 features.
> Built on the Gate 1 Data Model. Defines every new tool, command, and
> interface modification before any implementation code is written.
>
> **Superseded (2026-08-20):** the sync interface below describes an earlier
> design (`.sync-policy.json` per agent, `push_on_write` default false). #8 was
> built differently — config at `~/.pi/memory-sync.json` (mode 600), `push_on_commit`
> default true, single `server_url`. See SPEC_v4 §2.2 for the canonical sync spec.
> The Agent Identity and Auto-Discover sections remain current.

---

## Scope — Phase 2

Phase 2 adds two capability bundles:

| Bundle | New Tools | New Commands | Interface Mods |
|--------|-----------|-------------|----------------|
| Memory Server Sync | 1 | 1 | 2 |
| Agent Identity | 0 | 0 | 1 |
| Auto-Discover Org Memory | 0 | 0 | 1 |

**Total: 1 new tool, 1 new command, 4 interface modifications.**

Nothing is removed or broken. Phase 1 tools and commands are unchanged.

### What moved to Phase 3

- **Archival search** (`memory_archive_*`) — deferred. Important to our work, needs sentence-transformers + SQLite, fully decoupled so it ships independently.
- **Hook system** (`after_memory_write`, `before_session_start`) — good architecture, kept in VMA backlog. Ships when there's a concrete consumer. Auto-push implemented directly in `memory_write`, not via hook.

---

## Interface Catalog

### 1. `memory_sync_config`

```
Get or set sync behavior for the agent. Controls whether writes auto-push
to the server and whether session start auto-pulls. The server URL is
configured globally in ~/.pi/agent/config.json — this tool only manages
the on/off toggles.
```

| Property | Type | Description |
|----------|------|-------------|
| **inputs** | | |
| `push_on_write` | `boolean?` (optional) | Push after every memory_write? Default: false. |
| `pull_on_start` | `boolean?` (optional) | Pull on session start? Default: true. |
| `root` | `string?` (optional) | Memory root override. Defaults to agent root. Zone B roots never push regardless of config. |
| **outputs** | | |
| get (no params) | `{ push_on_write: boolean, pull_on_start: boolean, zone: "A" | "B" }` | Current config with defaults filled |
| set (with params) | `{ status: "updated", push_on_write: boolean, pull_on_start: boolean }` | Only provided fields change — omitted retain current |
| **errors** | | |
| `NO_ROOT` | `No active agent and no session root` | Standard no-root error |
| **config persistence** | `<agent-root>/.sync-policy.json` — `{ "push_on_write": false, "pull_on_start": true }`. Missing file → defaults. Zone B roots: config stored but push is silently skipped. |
| **lifecycle** | Read/write at any time. Policy takes effect immediately. |
| **version** | v1 |
| **TypeBox schema** | `{ push_on_write: Type.Optional(Type.Boolean()), pull_on_start: Type.Optional(Type.Boolean()), root: Type.Optional(Type.String()) }` |

---

### 2. `/agent:pull` — Bootstrap Command

```
One-time command to clone agent memory from a server onto a new device.
Either lists available agents on the server, or accepts an agent UUID and
clones it to ~/.pi/agents/<name>/memory/.
```

| Property | Type | Description |
|----------|------|-------------|
| **inputs** | | |
| `args` | `string` (optional) | Agent UUID (8+ chars prefix accepted) to clone. Empty = list available agents. |
| **behavior — list mode** | `agent:pull` | Queries server `/v1/agents` endpoint. Shows table: UUID prefix, agent name, last_push date. Prompts user to select one. |
| **behavior — clone mode** | `agent:pull <uuid>` | Clones `http://<server>/v1/git/<uuid>/state.git` into `~/.pi/agents/<name>/memory/`. Infers agent name from server response. |
| **server URL** | Read from `~/.pi/agent/config.json` (global, not per-agent). Set at extension install time or via `agent:pull --server <url>`. |
| **outputs** | | |
| list success | Table of agents on server, prompting selection | |
| clone success | `Agent "alph" cloned to ~/.pi/agents/alph/memory/. Run /agent:switch alph.` | |
| **errors** | | |
| `NO_SERVER` | `No server configured. Set server URL first.` | Config missing |
| `SERVER_UNREACHABLE` | `Cannot reach server at <url>. Check network.` | Connection timeout (5s) |
| `AGENT_EXISTS` | `Agent "<name>" already exists locally. Delete ~/.pi/agents/<name>/ to re-clone.` | Local agent with same name |
| `UUID_NOT_FOUND` | `Agent <uuid> not found on server.` | Invalid UUID |
| **lifecycle** | One-time bootstrap. Not called during normal operation. `pull_on_start` handles ongoing sync. |

---

### 3. Interface Modifications

#### `memory_write` — Post-Commit Push

```
Current: git commit → return to agent.
New: git commit → check SyncPolicy → conditionally push → return to agent.
```

| Aspect | Detail |
|--------|--------|
| **trigger** | After successful git commit, read `.sync-policy.json`. If `push_on_write=true` AND `server_url` is set AND root is Zone A → `git push origin <server_url>` |
| **Zone B behavior** | Zone B roots never push. Push is silently skipped regardless of config. |
| **error handling** | Push is best-effort. Write always reports success. Push failure is logged: `✅ Written. Push failed: network timeout — 3 unpushed commits.` |
| **timeout** | Push timeout 5 seconds. Prevents blocking agent response on network issues. |
| **migration** | Default config has `push_on_write=false` — zero behavior change. Only agents that opt in via `memory_sync_config` get auto-push. |
| **output shape** | Unchanged. Push status is informational text appended to the write result, not a structural change to the response. |

#### Agent Identity in Commits and Frontmatter

```
Current: commits use generic "Agent Memory <agent-memory@pi>".
         Frontmatter has no agent attribution.
New: commits use agent UUID. Frontmatter auto-includes agent_id.
```

| Aspect | Detail |
|--------|--------|
| **UUID origin** | Generated at `/agent:init`. Stored in `<agent-dir>/agent.json`: `{ "id": "<uuid-v4>", "name": "alph" }`. Persistent, immutable. |
| **commit author** | `git config user.name "agent-<short-uuid>"` and `user.email "agent-<short-uuid>@pi"` on repo init. Short UUID = first 8 chars. Commit messages unchanged (still `<path>: <description>`). |
| **frontmatter** | `memory_write` auto-adds `agent_id: "<full-uuid>"` to generated frontmatter. Immutable — set on first write, preserved on subsequent writes to same file. |
| **runtime tracking** | Extension loads agent UUID on startup from `agent.json`. Falls back to "unknown" for agents created before this change. |
| **migration** | Existing agents (no `agent.json`) get `agent_id: "unknown"` in frontmatter. New commits still use old author until agent is re-initialized. Non-breaking — just less specific. |
| **multi-agent visibility** | `memory_read` exposes `agent_id` from frontmatter. `git log` shows which agent committed. The building block for audit, routing, and handoff in Phase 3. |

#### `session_start` hook — Auto-Pull

```
Current: sessionMemoryRoot = null.
New: sessionMemoryRoot = null → check SyncPolicy → conditionally pull → continue.
```

| Aspect | Detail |
|--------|--------|
| **trigger** | On session start, after `sessionMemoryRoot = null`, read agent root's `.sync-policy.json`. If `pull_on_start=true` AND `server_url` is set AND agent root exists → `git pull origin <server_url>` |
| **error handling** | Pull is best-effort. Server unreachable → agent continues with local state. Network timeout 5 seconds. `CONFLICT` → `git merge --abort`, surface for human resolution on next turn. |
| **performance** | When no new commits on server: ~200ms (git fetch + fast-forward check). When server unreachable: ~5s timeout. When new commits to pull: ~500ms (small markdown files). |
| **migration** | Default config has `pull_on_start=true` — agents with a server configured will auto-sync on startup. Agents without a server see zero change. |



#### `resolveMemoryRoot` — Auto-Discover Org Memory

```
Current: sessionMemoryRoot → agentRoot → null.
New: sessionMemoryRoot → walk-up cwd → agentRoot → null.
Default: ON. Opt-out via config.
```

| Aspect | Detail |
|--------|--------|
| **behavior** | When sessionMemoryRoot is null AND no explicit root param: walk up from `process.cwd()` looking for `.memory/` directories. Stop at filesystem root or `~/.pi` boundary. First `.memory/` found wins. |
| **config** | `~/.pi/agent/config.json`: `{ "memory": { "auto_discover": true } }`. Set to false to disable. |
| **discovery order** | 1. Explicit root param → 2. sessionMemoryRoot → 3. Auto-discover (nearest `.memory/` walking up) → 4. Agent root |
| **zone** | Discovered roots are Zone B (project memory). Agent root is always the Zone A fallback. |
| **migration** | On by default. Users who never `cd` into a project with `.memory/` see zero behavior change. Users who `cd` into HeavenCRM get project memory without `/startwork`. |

---

## What the Agent Sees (Interface Surface)

From the agent's perspective, Phase 2 adds:

```
TOOLS (1 new):
  memory_sync_config   Get/set sync policy. server_url, push_on_write, pull_on_start.

COMMANDS (1 new):
  /agent:pull [uuid]   Clone agent memory from server. No arg = list available agents.

BEHAVIOR CHANGES (invisible to agent):
  - memory_write may push after commit (if configured)
  - Session start may pull from server (if configured)
  - All commits tagged with agent UUID (author + frontmatter)
  - memory_tree/read/write/search auto-discover .memory/ when cwd is in a project
```

Everything else is unchanged. Phase 1 tools and commands work identically.

---

## Dependency Graph

```
memory_sync_config ──reads/writes──▶ .sync-policy.json
memory_write ──reads──▶ .sync-policy.json (check push_on_write)
memory_write ──uses──▶ git push (if configured)
session_start ──reads──▶ .sync-policy.json (check pull_on_start)
session_start ──uses──▶ git pull (if configured)
resolveMemoryRoot ──reads──▶ ~/.pi/agent/config.json (auto_discover)
resolveMemoryRoot ──walks──▶ process.cwd() → parent directories
/agent:pull ──reads──▶ ~/.pi/agent/config.json (server URL)
/agent:pull ──calls──▶ git clone
```

No new dependencies between tools. Everything depends on config files or existing internals (git helpers, resolveMemoryRoot).

---

## Config Files

| File | Scope | What |
|------|-------|------|
| `~/.pi/agent/config.json` | Global | `{ "memory": { "server_url": "http://...", "auto_discover": true } }` |
| `<agent-root>/.sync-policy.json` | Per-agent | `{ "push_on_write": false, "pull_on_start": true }` |

**Server URL** is global — set once, all agents use it. If not set, sync is silently disabled (no push, no pull).

**Sync policy** is per-agent — each agent can independently decide whether to auto-push or auto-pull. Zone B roots store the config but never push.

**Flow:**
1. `/agent:pull` reads global config for server URL
2. `memory_sync_config` reads/writes per-agent `.sync-policy.json` (policy toggles only)
3. `memory_write` auto-push checks global `server_url` + per-agent `push_on_write`
4. `session_start` auto-pull checks global `server_url` + per-agent `pull_on_start`

---

## What Does NOT Change

| Entity | Why unchanged |
|--------|---------------|
| `memory_read` | Pure read. No sync implications. |
| `memory_tree` | Pure browse. Gains auto-discover behavior (see resolveMemoryRoot mod). |
| `memory_search` | Full-text search. Independent. |
| `memory_recall` | Session search. Zone C. Independent. |
| All existing commands | No command signatures change. `/startwork` still works — just less necessary with auto-discover. |
| `buildSystemContext` | Injects system/ files. Unchanged. |

---

## Human Review Checklist (Gate 2 — Trimmed)

- [ ] 1 tool + 1 command + 4 mods — right surface area?
- [ ] `memory_sync_config` handles both get and set in one tool — too clever or clean?
- [ ] `/agent:pull` list mode (query server for available agents) — does `pi-agent-memory-server` have a `/v1/agents` endpoint yet, or does this create a dependency?
- [ ] Auto-discover on by default — correct call?
- [ ] Server URL in global config, policy in per-agent `.sync-policy.json` — clean separation?
- [ ] 5-second timeouts (push + pull) — right balance for reliability vs responsiveness?

---

## Implementation Order

| # | What | Effort |
|---|------|--------|
| 1 | Agent UUID: `/agent:init` generates + persists `agent.json` | Tiny |
| 2 | Agent UUID: runtime loads UUID, uses in git config + frontmatter | Tiny |
| 3 | `.sync-policy.json` read/write helper | Tiny |
| 4 | `memory_sync_config` tool | Small |
| 4 | Agent UUID in commits and frontmatter | Small |
| 5 | `memory_write` post-commit push | Small |
| 6 | `session_start` auto-pull | Small |
| 7 | `resolveMemoryRoot` auto-discover | Small |
| 8 | `/agent:pull` command | Medium (server API dependency) |

Items 1-7 can ship as a unit. Item 8 depends on `pi-agent-memory-server` having a list endpoint, but can be built simultaneously.

---

## Phase 3 (VMA Backlog)

Deferred from Gate 2 with clear rationale:

| Feature | Why deferred | When it ships |
|---------|-------------|---------------|
| Archival search (`memory_archive_*`) | Largest lift, fully decoupled, no active consumer demand | When San says "I need to search my memory semantically" |
| Hook system (`after_memory_write`, `before_session_start`) | No concrete consumers yet | When an extension or consumer needs to hook into memory events |
| `resolveMemoryRoot` plugin registry | Walk-up covers the Phase 2 need | When someone writes a custom discovery plugin |
| Archival embedder config | Single hardcoded default works | When we have usage data suggesting a different embedder |
