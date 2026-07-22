# AGENTS.md — pi-agent-memory

> Three-zone git-backed markdown memory system for pi agents. TypeScript · Node built-ins · TypeBox.

## Engineering Values

1. DATA BEFORE CODE — Understand entities, relationships, invariants first. Code is downstream.
2. INTERFACES SACRED — Narrow, stable contract per component. Never break — deprecate, add v2.
3. SOLUTION < PROBLEM — After every change: what can I remove? Simplicity is the feature.
4. GROW BY EXTENSION — Never modify core behavior. Add hooks, plugins, extension points.
5. TEST CONTRACTS — Public interfaces only. Every test must survive complete internal rewrite.
6. HUMAN IN THE LOOP — Human provides taste: reviews data models, defines interfaces, says no, deletes.
7. WRITE FOR HUMANS — Comments explain WHY, not WHAT. Surface non-obvious decisions.

## Session Start

1. `git status --short` — flag uncommitted changes
2. Load `.memory/WIP.md` if exists
3. Load project status: `memory_read("reference/status.md", root="~/DEV/pi/agent_memory/.memory")`
4. Summarize: pending changes, WIP state, next action

## Entry Points

```
pi-agent-memory/index.ts    # Extension entry — registerTools, registerCommands, lifecycle hooks
pi-agent-memory/prompts/    # Prompt templates loaded at runtime with file-based fallback
```

Pi loads this extension from `~/.pi/agent/extensions/pi-agent-memory` (symlinked to this directory).

## Files

```
pi-agent-memory/
  index.ts              Extension: 6 tools, 11 commands, 2 hooks
  prompts/
    system.md           Memory system instructions injected into every turn
    startwork.md        /startwork ritual instructions
    endwork.md          /endwork ritual instructions
    init-memory.md      /memory:init prompt (future use)
  README.md             Quick start, architecture overview
  VMA.md                Vision, Mission, Aims — Phase 1 done, Phase 2 backlog
  SPEC_v4.md            Full design spec: three zones, progressive disclosure, acceptance criteria
  SPEC_v3.md            Previous spec version (reference)

SPEC_v4.md              Canonical spec at repo root
mem_system_prompt.md    Memory access protocol (scan before load, bin before read)
AGENTS.md               This file
.memory/                Project memory (local git, no remote)
  reference/
    status.md           Operational logbook
    DATA-MODEL.md       Entities, relationships, invariants (Gate 1)
    gameplan.md         Phased plan applying methodology gates
```

## Architecture

```
Zone A (Agent)     ~/.pi/agents/<agent>/memory/     Always in context (system/ files)
Zone B (Project)   <project>/.memory/               Session-scoped via /startwork
Zone C (Sessions)  .pi/sessions/                    Pi-managed, via memory_recall/super_sessions
```

```
before_agent_start hook
  → buildSystemContext()
  → inject system/*.md into system prompt (~850 tokens)
  → all other content loaded on demand via tools

Session workflow:
  /startwork → sessionMemoryRoot = <project>/.memory/
  All memory_read/memory_write/memory_search → resolveMemoryRoot()
  /endwork → commit, clear sessionMemoryRoot
```

## Tools (6)

| Tool | Resolves root via |
|------|-------------------|
| `memory_tree` | optional root param → session root → agent root |
| `memory_read` | optional root param → session root → agent root |
| `memory_write` | optional root param → session root → agent root |
| `memory_search` | optional root param → session root → agent root |
| `memory_recall` | (no root — searches Pi session JSONL) |
| `super_sessions_analyze` | (separate extension) |
| `super_sessions_synthesize` | (separate extension) |

## Commands (11)

| Command | Namespace |
|---------|-----------|
| `/agent:init` | agent: |
| `/agent:switch` | agent: |
| `/startwork` | (bare) |
| `/endwork` | (bare) |
| `/remember` | (bare) |
| `/memory:init` | memory: |
| `/memory:tree` | memory: |
| `/memory:read` | memory: |
| `/memory:search` | memory: |
| `/memory:recall` | memory: |

## Extension Points (Phase 2 candidates)

These are intentionally absent in Phase 1. The methodology says grow by extension, so Phase 2 adds hooks rather than modifying existing logic:

- `beforeMemoryWrite` hook — validate/censor before write
- `afterMemoryCommit` hook — push to remote, trigger indexing
- `resolveMemoryRoot` plugin — custom root resolution (for auto-discovered org memory)
- Archival storage backend — pluggable embedder + vector store

## Rules

- Node built-ins only (`fs`, `path`, `os`, `child_process`). Zero npm dependencies.
- TypeBox for parameter schemas (pi SDK requirement)
- TypeScript — single file (`index.ts`), ~530 lines
- `memory_write` is always an atomic git commit
- Zone B `.memory/` repos NEVER have a git remote — local version control only
- Session root cleared on session_start hook — no cross-session leakage
- `~` in root params expanded to home directory

## Gotchas

- `memory_write` auto-initializes git if no repo exists at the resolved root
- `parseFrontmatter` only handles simple YAML (description, importance, tags, created, updated). Nested structures ignored.
- `buildTreeView` walks directories recursively — large memory trees can be slow. Progressive disclosure is the user's responsibility.
- Session JSONL search (`memory_recall`) does case-insensitive substring match — no stemming, no semantic search.
- The extension is a single file by design. If it exceeds ~800 lines, split by concern (git helpers, frontmatter, session search) into separate modules.
- Pi loads the extension by reading `index.ts` from the symlink target. The symlink must exist before Pi starts.

## Sibling Projects

- `super-sessions` — session analysis + wisdom synthesis pipeline (separate extension, consumes Zone C)
- HeavenCRM — reference implementation of the engineering methodology (.memory/DATA-MODEL.md, FLOW-TRACE.md, INTERFACE-PLAN.md)
- Heaven `.memory/framework/` — canonical methodology docs (methodology-injection, prompts, cheatsheet)
