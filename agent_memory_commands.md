# pi-agent-memory — Command & Tool Reference

Complete surface of the `pi-agent-memory` extension: 15 slash commands, 7 tools.
Verified against `pi-agent-memory/index.ts` and the live extension inventory (pi v0.84.4).

Sibling extension `super-sessions` commands are listed at the end, since they are the
other half of the Zone C workflow.

---

## Zone model (recap)

| Zone | Location | Load policy |
|------|----------|-------------|
| A — Agent | `~/.pi/agents/<agent>/memory/` | `system/*.md` always in context; `knowledge/` on demand |
| B — Project | `<project>/.memory/` | Session-scoped, set by `/startwork` |
| C — Sessions | `.pi/sessions/` | Pi-managed; `memory_recall` + super-sessions |

Plus `~/.pi/org/` — shared agent registry + role library (orthogonal store, not "Zone D").

---

## Slash commands

### Session lifecycle (bare namespace)

| Command | What it does |
|---------|--------------|
| `/startwork [project-name \| path]` | Resolves project path, sets session memory root to `<project>/.memory/`, surfaces the handoff |
| `/endwork` | Commits project memory, verifies the session handoff exists, clears session root |
| `/remember` | Consolidates the current session into global memory (writes to `_meta/` paths) |

### Agent identity & registry (`agent:`)

| Command | What it does |
|---------|--------------|
| `/agent:init <name>` | Initialize a new agent with its own memory repo. Registers it in the org registry as `ephemeral` (on trial) |
| `/agent:promote <name>` | End a trial: flip `ephemeral → member` in the org registry. State flip only, no data migration. Ephemeral means a new team member under trial; promote once synergy is proven (SPEC_v4 §2.1) |
| `/agent:switch <name>` | Switch the active agent context. Note: the active agent is a single global value in `~/.pi/agents/active`, so a switch affects terminals started afterwards |
| `/agent:pull <uuid>` | Pull an agent's memory from the sync server by UUID |

**Agent membership lifecycle.** A new agent is registered `ephemeral`: a team member under trial. When synergy is proven, `/agent:promote <name>` flips the roster to `member`. Promotion is a state flip in `~/.pi/org/registry.json` plus a mirror in the agent's own `agent.json`; no data moves. The flag gates nothing in code. It is a roster label, and `/agent:promote` is the only consumer of it.

**Concurrency.** The active agent is a single global value in `~/.pi/agents/active`. Each pi process reads it once at session start and holds it in memory, so a running session is never re-pointed mid-flight. But the file is shared: whichever terminal ran `/agent:switch` last decides what the *next* terminal boots as. Parallel work is supported for projects (the Zone B session root is per-process via `/startwork`), not for agent identity. Two sessions on two different agents at the same time is not isolated today — the pathway decision is tracked in **#68**, with the binding primitive shared with **#14**.

### Sync

| Command | What it does |
|---------|--------------|
| `/agent:sync` | Manually sync the active memory root (`pull --rebase` then push) |
| `/memory:sync-config [server_url=… push_on_commit=… pull_on_start=…]` | View or set memory sync config |

### Browsing & health (`memory:`)

| Command | What it does |
|---------|--------------|
| `/memory:tree [path]` | Display the memory tree with descriptions, no file bodies |
| `/memory:read <path>` | Read a memory file and its `[[wiki-links]]` |
| `/memory:search <query>` | BM25-ranked full-text search across memory files |
| `/memory:recall <query>` | Search past Pi session history |
| `/memory:status [root] [--check-remote]` | Root, zone, soul registration, git state, last sync result |
| `/memory:init <path>` | Bootstrap a `.memory/` repo in a project directory |

---

## Tools (model-invoked, 7)

Every tool resolves its root via: optional `root` param → session root → agent root.

| Tool | Notes |
|------|-------|
| `memory_tree(path?)` | Directory listing with descriptions and star ratings. No bodies. |
| `memory_read(path)` | Full file plus extracted wiki-links. |
| `memory_write(path, content, description, tags?, importance?)` | Always an atomic git commit. Auto-inits git if absent. |
| `memory_search(query)` | BM25 ranked with importance/recency boosts. |
| `memory_recall(query)` | Scans session JSONL history across all projects. |
| `memory_sync_config(set?)` | Get/set `server_url`, `push_on_commit`, `pull_on_start`. |
| `memory_status(root?, checkRemote?)` | Health check. `checkRemote` pings the server (network). |

---

## Asymmetries worth knowing

- **`memory_write` has no command.** The agent can write directly; you cannot type a write.
  Your write paths are `/remember`, work under `/startwork`, and `/endwork`.
- **`/startwork`, `/endwork`, `/remember` have no tool.** Session framing stays with the human.

---

## Sync behavior (easy to get wrong)

- Only `memory_write` triggers the push. The repo has **no git remote configured** — the
  tool pushes, git does not.
- A plain `git commit` in bash (bulk `git mv`, scripted audit edit) lands locally and
  **silently never reaches the server**. `memory_status` still reports healthy.
- Always finish out-of-band commits with an explicit push, then verify on the box:

  ```bash
  git push ssh://mojah2/var/www/private/pi-agent-memory/<repo>.git master:master
  ssh mojah2 "git --git-dir=/var/www/private/pi-agent-memory/<repo>.git log --oneline -1 master"
  ```

- `pull failed; push ok` in `memory_status` is historically normal after a session with no
  memory writes. Repeated pull failures are worth investigating.

---

## Sibling extension — `super-sessions`

| Command | What it does |
|---------|--------------|
| `/super_sessions` | Regenerate project session exports (`sessions/`, `html/`, `index.md`) |
| `/super-sessions-tag` | Tag session `.md` files with frontmatter (project_relevant, topics, summary) via cheap LLM. Flags: `--force`, `--strip-noise` |
| `/super-sessions-retag` | Alias for tag; only sessions missing frontmatter |

Tools (also from `super-sessions`):

| Tool | Notes |
|------|-------|
| `super_sessions_analyze(topic, …)` | Per-session extraction → `analyses/<topic>/<session>.md`. Idempotent. |
| `super_sessions_synthesize(topic, …)` | Cross-session synthesis → `wisdom/<topic>.md` (SOTA model) |
