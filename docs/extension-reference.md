# pi-agent-memory — Extension Reference

> Source of truth: `pi-agent-memory/index.ts` (v4, ~530 lines). This document explains the commands, the data flow, and the global-vs-project root resolution logic.

## 1. The Three Zones

The system splits memory into three physical locations:

| Zone | Location | Scope | How it's loaded |
|------|----------|-------|-----------------|
| **A — Agent** | `~/.pi/agents/<agent>/memory/` | Your identity, user knowledge, project index | `system/*.md` auto-injected into every turn |
| **B — Project** | `<project>/.memory/` | Per-project status, decisions, observations | On demand via `memory_tree`/`memory_read` after `/startwork` |
| **C — Sessions** | `~/.pi/agent/sessions/` (Pi-managed JSONL) | Raw conversation logs | Via `memory_recall` and the `super_sessions` pipeline |

Two pieces of module-level state drive everything:

- `activeAgent` — the current agent name, **persisted** to the file `~/.pi/agents/active`.
- `sessionMemoryRoot` — the current project's `.memory/` path, **in-memory only**, reset to `null` on every `session_start`.

---

## 2. All Commands (10)

> Note: the AGENTS.md header says "Commands (11)" but the source registers 10 `registerCommand` calls. The table below is the actual list.

| Command | Namespace | What it does |
|---------|-----------|--------------|
| `/agent:init <name>` | `agent:` | Create a new agent memory repo at `~/.pi/agents/<name>/memory/`. Initializes git, writes `system/persona.md`, `system/human/identity.md`, `system/human/preferences.md`, `system/projects.md`, and a `README.md`. Sets this agent active. |
| `/agent:switch [name]` | `agent:` | Switch the active agent. With no name, shows a picker of existing agents. Persists the choice to `~/.pi/agents/active`. |
| `/startwork [project\|path]` | bare | Begin a project session. Resolves a project path and sets `sessionMemoryRoot = <path>/.memory/`. Loads the "eagle eye" tree (`reference/`) and prints it. |
| `/endwork` | bare | End the session. Commits any uncommitted changes in the session root, then clears `sessionMemoryRoot` back to `null`. |
| `/remember` | bare | Consolidate the current session into **global** agent memory. Scans the last 20 assistant messages, heuristically buckets them into `_meta/observations/`, `_meta/decisions/`, `_meta/feedback/`, and writes + commits each. |
| `/memory:init <path>` | `memory:` | Bootstrap a `.memory/` directory in a project. Detects **org** (≥2 sub-directories with `package.json`/`.git`) vs **standalone**, then writes `reference/index.md`, `reference/status.md` (standalone) or `reference/strategy.md` + per-sub-project `status.md` (org), plus `project_insights/`. Local git only. |
| `/memory:tree [path]` | `memory:` | Print the memory tree (directories + files with star ratings from frontmatter `importance`). |
| `/memory:read <path>` | `memory:` | Read a single memory file, print body + extracted `[[wiki-links]]`. |
| `/memory:search <query>` | `memory:` | Full-text (case-insensitive substring) search across all `.md` files in the resolved root. Max 10 matches. |
| `/memory:recall <query>` | `memory:` | Search past Pi session history (Zone C) — scans `~/.pi/agent/sessions/**/*.jsonl` for matching message text. Max 20 excerpts. |

### Tools (5 in this extension, 2 in a sibling)

Registered as `registerTool` (callable by the agent as functions):

| Tool | Purpose |
|------|---------|
| `memory_tree` | Browse directory + descriptions, **no bodies** (progressive disclosure) |
| `memory_read` | Load a file body + `[[links]]` |
| `memory_write` | Write file with auto-frontmatter + git commit |
| `memory_search` | Full-text search across memory files |
| `memory_recall` | Search session JSONL history |

`super_sessions_analyze` and `super_sessions_synthesize` are **not** in this extension — they live in the sibling `super-sessions` extension.

---

## 3. Root Resolution — the single rule that answers "global vs project"

Every file-based tool and command funnels through one function:

```
resolveMemoryRoot(rootOverride?):
    1. rootOverride  → expand ~ → USE IT            (explicit param wins)
    2. sessionMemoryRoot (if set) → USE IT           (project memory wins)
    3. getAgentMemoryRoot() → ~/.pi/agents/<active>/memory/   (global fallback)
```

So the precedence is:

**explicit `root` parameter → session root (Zone B) → agent root (Zone A)**

Concretely, **when does it look at global vs project?**

| Situation | Root used |
|-----------|-----------|
| Fresh session, no `/startwork` yet | **Global** (`~/.pi/agents/<active>/memory/`) |
| After `/startwork myapp` | **Project** (`~/DEV/.../myapp/.memory/`) |
| Passing an explicit `root` param to any tool | Whatever path you passed (bypasses both) |
| `memory_recall` | Always Zone C (`~/.pi/agent/sessions/`), ignores root entirely |
| `before_agent_start` hook | Always **global** `system/*.md` (Zone A injection) |
| `/remember` | Always **global** (writes to `_meta/`) |

The `sessionMemoryRoot` is deliberately ephemeral: the `session_start` lifecycle hook resets it to `null`, so no project context leaks across sessions. The `activeAgent` (global root) is the durable baseline.

---

## 4. Data Flow — write path (storing)

`memory_write(path, content, description, tags?, importance?)`:

1. **Resolve root** (rule above).
2. If the resolved root is **not a git repo**, `git init` it (auto-initialize).
3. Generate YAML frontmatter: `description`, `importance` (default 3, clamped 1–5), `tags`, `created`, `updated`.
4. Write `frontmatter + content` to `<root>/<path>` (creates parent dirs).
5. `git add <relpath>` + `git commit -m "<path>: <description>"` — **every write is an atomic commit**.

`/remember` (global consolidation) additionally:
- Reads the last 20 assistant messages from the session branch.
- Buckets by keyword heuristic: "decision/chose/selected" → `_meta/decisions/`, "feedback/correct/stop" → `_meta/feedback/`, else → `_meta/observations/`.
- Writes up to 3 observations, 2 decisions, 2 feedback entries, each its own dated file, each committed.

## 5. Data Flow — read path (retrieving)

**At every session start** (`before_agent_start` hook):

1. If no `activeAgent`, do nothing.
2. `buildSystemContext()` walks `~/.pi/agents/<active>/memory/system/` and collects every `.md`.
3. It prepends a `<memory_system>` block containing the memory-system instructions (from `prompts/system.md`, with a hardcoded fallback) followed by the full bodies of all `system/*.md` files.
4. This block is appended to the system prompt — **Zone A is always in context** (~800 tokens cold start).

**During a session** (on-demand, progressive disclosure):

1. `memory_tree("reference/")` — browse structure + descriptions without paying token cost for bodies.
2. `memory_read("reference/<proj>/status.md")` — load a specific body; the tool also extracts and returns any `[[wiki-links]]` so the agent can follow the graph.
3. `memory_search("query")` — substring search across all `.md` in the resolved root (10-match cap).
4. `memory_recall("query")` — when the user references something from a past conversation; searches Zone C JSONL, not the markdown trees.

**At session end** (`/endwork`):

1. `git status --porcelain` in the session root; if dirty, `git add -A` + commit with `endwork: Session consolidation <date>`.
2. `sessionMemoryRoot = null` — project context released.
3. (Ritual prompt `prompts/endwork.md` instructs the agent to update `## Current` / `## History` in the affected `status.md` files before the command runs.)

---

## 6. Summary table of root usage

| Operation | Zone | Root |
|-----------|------|------|
| System prompt injection (every turn) | A | `~/.pi/agents/<active>/memory/system/` |
| `memory_tree/read/write/search` (no session) | A | `~/.pi/agents/<active>/memory/` |
| `memory_tree/read/write/search` (after `/startwork`) | B | `<project>/.memory/` |
| `memory_tree/read/write/search` (explicit `root=`) | override | the path passed |
| `memory_recall` | C | `~/.pi/agent/sessions/` (fixed) |
| `/remember` | A | `~/.pi/agents/<active>/memory/_meta/` |
| `/endwork` commit | B | current `sessionMemoryRoot` |

## 7. Gotchas worth remembering

- **The `active` file** (`~/.pi/agents/active`) is what makes an agent "current". If it's stale or empty, Zone A injection silently does nothing.
- **`.memory/` repos are local-only** — never given a git remote. Version history via `git log` inside the `.memory/` dir.
- **`memory_recall` is substring match only** — no stemming, no semantic search.
- **`parseFrontmatter` is naive** — single-line `key: value` only; nested YAML is ignored. Tags must be on one line as `[a, b]`.
- **`/remember` heuristics are crude** — keyword matching on assistant text, so bucketing can misfile. Treat `_meta/` output as a draft to curate.
- **Session root is volatile** — cleared by `session_start`, so nothing persists across sessions unless written (and committed) during the session or consolidated via `/remember`.
