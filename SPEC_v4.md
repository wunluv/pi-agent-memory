# Pi Agent Memory System — SPEC v4

A lightweight memory system for pi agents. Two-tier git-backed markdown files with progressive disclosure. On-demand project memory browsing. Multi-root architecture: global agent memory + project-local `.memory/` directories. ~800 tokens cold start.

## Why This Exists

Letta Code's memory model works: two-tier git-backed markdown with frontmatter, only `system/` files in context, everything else loaded on demand. But its cold start is ~14K tokens. Pi agents cold start at ~200 tokens. This replicates Letta's memory architecture as a single pi extension: **same model, 17× lighter, no external server.**

v4 adds multi-root support — agents can work across projects without mixing project memory into their global identity store. Each project gets its own `.memory/` directory. A session-scoped root lets agents pivot between projects cleanly.

## Architecture: Three Zones

```
ZONE A — Agent Memory (global, one per agent)     ~/.pi/agents/<agent>/memory/
ZONE B — Project Memory (local, one per project)  ~/DEV/<project>/.memory/
ZONE C — Session Archive (Pi-managed)             .pi/sessions/
```

| Zone | Location | Git? | Contains | Loaded when |
|------|----------|------|----------|-------------|
| A — Agent | `~/.pi/agents/<agent>/memory/` | Local git, server-sync optional | Persona, human identity, thin project index, infrastructure | Always (injected into system prompt) |
| B — Project | `<project>/.memory/` | Local git + optional private remote (mem server). Never the project's public code repo. | Strategy, per-project status, decisions, observations, project_insights | `/startwork` pivots here |
| C — Sessions | `.pi/sessions/` | Pi-managed | Raw conversation logs | `memory_recall()`, super_sessions pipeline |

### Zone A: Agent Memory (Physical Layout)

```
~/.pi/agents/<agent-name>/
└── memory/                          ← git repo (one per agent)
    │
    ├── system/                      ← PINNED: always in context
    │   ├── persona.md               # Identity, beliefs, relationship, language discipline
    │   ├── human/                   # What the agent knows about the user
    │   │   ├── identity.md          # Background, motivations, drives
    │   │   └── preferences.md       # Communication style, work patterns
    │   ├── projects.md              # Lightweight index: project name → path ([[links]])
    │   └── infrastructure.md        # Servers, services, tooling
    │
    ├── knowledge/                   ← LAZY: general/personal knowledge (renamed from reference/, 2026-08)
    │   └── ...                      # philosophy, skills, tooling, general notes — project knowledge lives in Zone B
    │
    └── _meta/                       ← LAZY: cross-project concerns (folds into knowledge/ on migration)
        ├── observations/
        ├── feedback/
        └── decisions/
```

Zone A stays unchanged from v3. Lightweight, stable, always in context.

### Zone B: Project Memory (Physical Layout)

Two patterns depending on the project type:

**Standalone project** (single repo, e.g. BTTN, EOS Club):

```
~/Projects/BTTN/
  .memory/                          ← local git + optional private remote (mem server)
    reference/
      index.md                      ← project eagle eye
      status.md                     ← operational logbook
      strategy.md                   ← roadmap, dependencies
      decisions/
      observations/
    project_insights/               ← super_sessions output
      analyses/
      wisdom/
  src/                              ← project code (separate git repo, GitHub)
  README.md, AGENTS.md, ARCHITECTURE.md, STATUS.md
```

**Organisation** (multiple sub-projects under one umbrella, e.g. Heavenletters):

```
~/DEV/Heaven/                       ← NOT a git repo, just a directory
  .memory/                          ← local git + optional private remote (mem server)
    reference/
      index.md                      ← eagle eye across ALL sub-projects
      strategy.md                   ← cross-project POA, dependency map
      daily_hl/
        status.md                   ← sub-project status lives HERE
        decisions/
        observations/
      heavencrm/
        status.md
        decisions/
      heaven-search/
        status.md
      ...
    project_insights/               ← super_sessions output
      analyses/
      wisdom/
  daily_hl/                         ← sub-project (separate git repo, GitHub)
    README.md, AGENTS.md, ARCHITECTURE.md, STATUS.md
  heavencrm/                        ← sub-project (separate git repo, GitHub)
    README.md, AGENTS.md, ARCHITECTURE.md, STATUS.md
```

In the organisation pattern, sub-projects do NOT have their own `.memory/`. All project memory lives in the org's `.memory/reference/{sub-project}/`. This gives agents a single root to load, Obsidian one vault to search, and prevents private docs from leaking into GitHub repos.

### Zone C: Session Archive

Managed by Pi. Raw JSONL session logs live at `.pi/sessions/{cwd-hash}/`. The `super_sessions` extension reads from here, strips tool calls and thinking blocks, and writes extracted insights into `.memory/project_insights/`.

Data flow:
```
Zone C (raw sessions)
    → super_sessions_analyze
    → .memory/project_insights/analyses/{topic}/
    → super_sessions_synthesize
    → .memory/project_insights/wisdom/{topic}.md
    → agent reviews → updates .memory/reference/ (status, strategy)
```

## Public vs Private Documentation

Every project (standalone or sub-project) follows these conventions:

| File | Location | Git Remote? | Audience | Author |
|------|----------|-------------|----------|--------|
| `README.md` | Repo root | GitHub | Humans | Human + contributors |
| `AGENTS.md` | Repo root | GitHub | Agents (public) | Human + agent (`/memory:init`) |
| `ARCHITECTURE.md` | Repo root | GitHub | Humans + agents | Human + agent |
| `STATUS.md` | Repo root | GitHub | Maintainers | Lightweight (version + issues link) |
| `.memory/reference/status.md` | `.memory/` | Local only | Agents | Agent (`/endwork`) |
| `.memory/reference/strategy.md` | `.memory/` | Local only | Human + agent | Human + agent |

**`AGENTS.md`** is a terse operational map for agents: stack, entry points, key files, conventions, gotchas. Sub-500 words. An agent loads it and knows the terrain without reading source code.

**Repo `STATUS.md`** is a signpost: version, deployed status, link to open issues. One paragraph.

**`.memory` `status.md`** is the operational logbook: `## Current` (what's happening now), `## Plan` (next steps, dependencies), `## History` (milestones, decisions, session log). Agents write `## Current` at `/endwork`. Humans review periodically.

## Memory File Format

Every file uses YAML frontmatter + markdown body:

```markdown
---
description: "Chose middleware over guard-based auth. Reasoning: composability, testability."
importance: 5
tags: [auth, middleware, architecture]
created: 2026-04-20
updated: 2026-04-22
---

# Auth Strategy Decision

## Context
Refactoring auth module. Two approaches evaluated.

## Decision
Middleware-based pipeline chosen over per-route guard functions.
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | Single sentence. Appears in `memory_tree()` listings. |
| `importance` | No | 1–5. Controls star rating. Default 3. |
| `tags` | No | Array of lowercase strings. Used in search and filtering. |
| `created` | Auto | ISO date. Set automatically on first write. |
| `updated` | Auto | ISO date. Updated on edit. |

### `[[path]]` Wiki-Links

Files reference each other using `[[path/relative/to/memory/root]]`:

```markdown
## See Also
- [[reference/heavencrm/status.md]]
- [[system/infrastructure.md]]
```

Rendered as navigable links in `memory_tree()` output. Extracted by `memory_read()` for traversal.

## Context Loading

### Zone A: Auto-injected

On every turn, the extension reads all `system/*.md` files recursively from the agent's global memory root and appends them to the system prompt. Nothing from Zone B is auto-injected.

Token budget:

| Component | Tokens | What |
|-----------|--------|------|
| Pi's base system prompt | ~200 | Tools, capabilities, guidelines |
| Memory tool descriptions | ~150 | Six tools, one-line each |
| `system/persona.md` | ~150 | Identity, discipline, relationship |
| `system/human/identity.md` | ~80 | User background, drives |
| `system/human/preferences.md` | ~100 | Communication style, work patterns |
| `system/projects.md` | ~60 | Lightweight project index with paths |
| `system/infrastructure.md` | ~80 | Servers, services, tooling |
| Memory header/footer | ~30 | Section markers |
| **Total cold start** | **~850** | |

### Zone B: Loaded on Demand

The agent accesses project memory exclusively through tool calls. Nothing is auto-injected. The agent knows nothing about project memory contents until it asks.

### Loading Protocol: Progressive Disclosure

```
Tier 0 — Eagle Eye (~1K tokens)
  memory_tree("reference/", root=<project>)
  → List of sub-projects with one-line statuses. No file bodies.

Tier 1 — Project Status (~2-3K tokens)
  memory_read("reference/{sub}/status.md", root=<project>)
  → ## Current section: what's live, blocked, next action.

Tier 2 — Deep Dive (unbounded)
  Full status.md (## History, ## Plan), strategy.md, architecture docs.
  Only loaded when doing actual work.
```

## Session Memory Root

A session-scoped variable set by `/startwork` and used by all file-based memory tools. Removes the need for agents to track which project directory they're working in.

```
Session start:
  /startwork Heavenletters
  → Session root = ~/DEV/Heaven/.memory

All subsequent memory calls:
  memory_read("reference/heavencrm/status.md")    ← resolves against session root
  memory_tree("reference/")                       ← same root
  memory_write("reference/daily_hl/status.md", ...) ← same root

Session end:
  /endwork
  → Commits, updates status docs, clears session root
```

When no session root is set (no `/startwork` called), tools default to the global agent memory root (Zone A).

## Tools

### Six tools

| Tool | Description |
|------|-------------|
| `memory_tree(path?, root?)` | List directory with descriptions and star ratings. No file bodies loaded. |
| `memory_read(path, root?)` | Read full content of a memory file. Extracts [[wiki-links]]. |
| `memory_write(path, content, description, tags?, importance?, root?)` | Write/edit with auto-frontmatter and git commit. |
| `memory_search(query, root?)` | Full-text search across memory repo. |
| `memory_recall(query)` | Search Pi session JSONL history for past conversations. |
| `super_sessions_analyze(topic, ...)` | Extract topic-specific observations from sessions. |
| `super_sessions_synthesize(topic, ...)` | Synthesize per-session analyses into wisdom doc. |

### The `root` Parameter

All file-based tools (`memory_tree`, `memory_read`, `memory_write`, `memory_search`) accept an optional `root` parameter:

- **Omitted**: Uses session memory root if set (from `/startwork`), otherwise falls back to global agent memory root (Zone A).
- **Provided**: Overrides session root. Use when explicitly working across projects.

`memory_recall` does not accept a `root` parameter — it searches Pi session history, not memory files.

### Tool Behaviors

**`memory_tree(path?, root?)`**
- Recursively lists directories and `.md` files under `path`
- Extracts `description` and `importance` from frontmatter
- Returns formatted tree with star ratings
- Default path: memory root of the resolved zone

**`memory_read(path, root?)`**
- Path relative to resolved memory root
- Returns full markdown content including frontmatter
- Extracts and lists `[[links]]` found in the body

**`memory_write(path, content, description, tags?, importance?, root?)`**
- Path relative to resolved memory root
- Creates directories as needed
- Generates frontmatter from description/tags/importance
- Auto-commits: `git add <file> && git commit -m "<description>"`
- If the resolved root has no git repo, auto-initializes one
- If path exists, edits file — previous version preserved in git

**`memory_search(query, root?)`**
- Full-text search across all `.md` files under resolved memory root
- Returns matched lines with file paths
- Limited to 10 matches

**`memory_recall(query)`**
- Searches Pi session JSONL files across all projects
- Returns matching message excerpts with session identifiers

## Commands

| Command | Namespace | Description |
|---------|-----------|-------------|
| `/agent:init <name>` | `agent:` | Set up new agent with global memory repo |
| `/agent:switch <name>` | `agent:` | Switch active agent context |
| `/remember` | (bare) | Consolidate current session into memory |
| `/startwork [project]` | (bare) | Start work session, set session memory root, load eagle eye |
| `/endwork` | (bare) | End session: update status docs, commit, clear session root |
| `/memory:tree [path]` | `memory:` | Display memory tree |
| `/memory:read <path>` | `memory:` | Read a memory file |
| `/memory:search <query>` | `memory:` | Full-text search |
| `/memory:recall <query>` | `memory:` | Search session history |
| `/memory:init <path>` | `memory:` | Bootstrap `.memory/` in a project directory |

### Command Naming Convention

Three categories:

- **Bare names** for user workflow actions: `/remember`, `/startwork`, `/endwork`
- **`agent:` namespace** for agent lifecycle: `/agent:init`, `/agent:switch`
- **`memory:` namespace** for memory operations: `/memory:tree`, `/memory:read`, `/memory:search`, `/memory:recall`, `/memory:init`

No new namespaces. Backward compatible with v3.

### `/agent:init <name>`

Interactive setup that creates the agent's global memory repo (Zone A):

1. Creates `~/.pi/agents/<name>/memory/` as a git repo
2. Prompts for persona, human identity/preferences, project list
3. Writes template `system/` files
4. Initial commit

### `/memory:init <path>`

Bootstraps project memory (Zone B) in the given directory:

1. Creates `<path>/.memory/` directory structure
2. `git init` inside `.memory/`
3. Detects project type (standalone vs organisation) by scanning for sub-directories with `package.json` / git repos
4. Creates `reference/index.md` (eagle eye stub)
5. For organisations: creates per-sub-project `status.md` stubs
6. Scans for existing docs (README.md, package.json, existing status files) to pre-populate
7. Generates `AGENTS.md` stub in the project root if one doesn't exist
8. Does NOT push to any remote
9. Does NOT delete or modify existing files

### `/startwork [project]`

Start of session ritual:

1. If project name provided, looks up path from Zone A `system/projects.md`
2. If no project provided, prompts user to select
3. Sets session memory root to `<project-path>/.memory/`
4. Loads `memory_tree("reference/")` against session root → eagle eye
5. Loads `memory_read("reference/index.md")` for full index
6. Checks git log for recent changes
7. Presents: "Project. Last changes: <date>. Priority stack: <top 3>. What are we working on today?"

### `/endwork`

End of session ritual:

1. Summarizes: decisions made, files changed, discoveries
2. Identifies which `status.md` files need `## Current` updates
3. Updates each affected status.md via `memory_write()`
4. Appends milestone entries to `## History` where warranted
5. Git commit in `.memory/` with session summary
6. Presents: "Updated: <files changed>. Next session: <top priority>."
7. Clears session memory root

### `/remember`

Legacy session consolidation (v3 behavior, retained). The agent reviews conversation and writes observations to `_meta/` in global memory. For project-specific consolidation, use `/endwork`.

## Two Memory Patterns

### Pattern A: Standalone Project

Used when a project is a single repo with no sub-projects.

```
/startwork BTTN
→ Session root = ~/Projects/BTTN/.memory
→ memory_tree("reference/") shows project-level index
→ memory_read("reference/status.md") loads project status
```

### Pattern B: Organisation

Used when a directory contains multiple related sub-projects.

```
/startwork Heavenletters
→ Session root = ~/DEV/Heaven/.memory
→ memory_tree("reference/") shows all sub-projects
→ memory_read("reference/heavencrm/status.md") loads sub-project status
→ memory_read("reference/strategy.md") loads cross-project strategy
```

The agent does not need to know which pattern is active. The tools resolve correctly against the session root.

## Workflow Cadence

| Frequency | Action | What happens |
|-----------|--------|-------------|
| Per session | `/startwork` | Sets session root, loads index, presents priority stack |
| Per session | `/endwork` | Updates status.md, commits .memory/ |
| Weekly | Consolidation | Review `## Current` across status files, archive to `## History`, update strategy.md |
| Weekly | super_sessions | `super_sessions_analyze` + `super_sessions_synthesize` → `.memory/project_insights/wisdom/` |
| Monthly | Strategic review | Load all status + strategy + wisdom, identify patterns, update priorities |

## Git Integration

Every `memory_write` is an atomic git commit:

```
git add <file>
git commit -m "<path>: <description>"
```

### Zone A (Agent Memory)
- Local git only by default
- Optional: `git remote add origin <server>` for cross-device sync
- Server sync uses a custom git HTTP backend (the mem server, issue #8)

### Zone B (Project Memory)
- Local git + optional private remote (mem server, issue #8) — never the project's public code repo
- Lives alongside project repos, not inside them
- Version control without exposure: `git log`, `git blame`, `git diff`

## Implementation

A single pi extension: `~/.pi/agent/extensions/agent-memory.ts`

- ~500 lines of TypeScript (up from ~400 in v3)
- Six registered tools (five from v3 + `root` parameter on four)
- Eleven registered commands (seven from v3 + four new)
- One `before_agent_start` hook (inject Zone A system/ files)
- Session-scoped memory root variable
- No external dependencies beyond Node.js built-ins

### Changes from v3

| Change | Description |
|--------|-------------|
| `root` parameter | Added to `memory_tree`, `memory_read`, `memory_write`, `memory_search` |
| Session root | New variable set by `/startwork`, checked by all file-based tools |
| `/startwork` | New command: session initiation with project memory pivot |
| `/endwork` | New command: session wrap-up with status.md updates |
| `/memory:init` | New command: bootstrap `.memory/` in a project directory |
| Multi-root git | `memory_write` initializes git in the resolved root if needed |
| Tool count | Five → six (unchanged count, changed signatures) |
| Command count | Seven → eleven |

## Phase 2 Scope (consolidated 2026-08)

Consolidates the frozen Gate 2 interface (identity + sync + auto-discovery) with the retrieval/consolidation improvements from the 2026-08 design critique. Detailed work breakdown, dependencies, and acceptance criteria live in `docs/WBS.md`. Each work package maps to one GitHub issue.

> **Architecture decisions 2026-08-19** (tracked in #17): three buckets — `system/` (identity), `knowledge/` (global, renamed from `reference/`), and `<project>/.memory/` (project). Zone B is private + syncable (optional private remote, never the public code repo). Per-subagent memory is thin (role identity + pointers); the project index is a shared registry, not per-agent copies. See `.memory/reference/pi-agent-memory/decision-2026-08-19-one-store.md`.

### 2.1 Agent Identity (foundation)

- `agent.json` (uuid v4 + name) generated at `/agent:init`
- Agent UUID used in git commit author (`agent-<short-uuid>`) and frontmatter `agent_id`
- Runtime loads UUID on start; absent UUID degrades gracefully

### 2.2 Memory Sync (Zone A)

- git `post-commit` hook: conditional push (gated on `push_on_commit` + `server_url` + Zone A), 5s best-effort, non-blocking. Zone B never pushes.
- `/agent:pull [uuid]` — pure `git clone`, agent name read from `agent.json` in the clone
- `memory_sync_config` tool — get/set `push_on_commit`, `pull_on_start`
- `session_start` auto-pull — 2–3s fail-fast, continue on local state
- **Reference:** Letta Code CLI's `post-commit` hook (backgrounded subshell, logged to `memory-repository-push.log`, always exit 0) — see issue #8

### 2.3 Root Resolution & Discovery

- `resolveMemoryRoot` walks up from a stable current-project signal (not raw cwd); resolved once per session, cached
- Deterministic registry (`registry.json`) — authoritative name→path lookup (strict parser landed in issue #1)
- Robust `/startwork` — reconcile a stale registry path on move (yes/no prompt) and offer `/memory:init` when `.memory/` is absent (issue #13)
- `/startwork` becomes a ritual (eagle eye + priorities), not a gate

### 2.4 Retrieval

- BM25 ranked search with importance/recency boosts (replaces substring grep) — issue #2
- Backlinks — bidirectional `[[wiki-link]]` navigation — issue #3
- Archival vector search — DEFERRED (future): reuse heaven-search as an agent-only sidecar (issue #10), not built from scratch

### 2.5 Consolidation

- `/remember` scoped to 2–3 turns, prompt-style; project insight → `reference/`, human insight → `system/`
- Consolidation loop — decay/compression on `/endwork` (roll `## History`, mark stale, merge by topic) — issue #5

### 2.6 Context Budget

- Token cap for `system/` injection, ranked by importance + recency — issue #6

### 2.7 Data Integrity — frontmatter validation

- `beforeMemoryWrite` hook — schema validation (required `description`, known keys, sane types) + protected `read_only` field (human-owned, agent can't set/change/remove) — issue #16
- Pattern: Letta's `pre-commit` hook, rebuilt for our schema as a TypeScript extension hook (not a git hook)

### Still out of scope

- Sub-agent spawning and multi-agent coordination ACLs
- Cross-device Zone B sync (Zone B stays local)
- Cross-interface session merging

## Acceptance Criteria

1. **`/agent:init alph`** creates `~/.pi/agents/alph/memory/` as git repo with populated `system/` files
2. **`/memory:init ~/DEV/Heaven`** creates `.memory/` in project dir, detects org pattern, creates sub-project stubs
3. **`/startwork Heavenletters`** sets session root, loads index, presents priority stack
4. **`memory_tree("reference/")`** with session root shows org-level tree with sub-project statuses
5. **`memory_read("reference/heavencrm/status.md")`** resolves against session root correctly
6. **`memory_write("reference/heavencrm/status.md", content, ...)`** writes to project memory, auto-commits
7. **`/endwork`** updates affected status.md files, commits, clears session root
8. **Without `/startwork`**, tools default to Zone A (global agent memory) — backward compatible
9. **Explicit `root` parameter** overrides session root for cross-project operations
10. **Cold start is under 900 tokens** (Zone A only, measured via Pi's token usage)
11. **`git log`** inside `.memory/` shows all writes with descriptive commit messages
12. **Zone B `.memory/` is private** — local git + optional private remote (mem server); never in the project's public code repo
13. **`AGENTS.md`** is generated by `/memory:init` when missing, sub-500 words, agent-facing operational map
