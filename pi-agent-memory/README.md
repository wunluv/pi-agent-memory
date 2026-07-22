# pi-agent-memory

A lightweight three-zone memory system for pi agents. Git-backed markdown with progressive disclosure. ~800 tokens cold start — 17× lighter than Letta's equivalent.

## Architecture

```
Zone A (Agent)     ~/.pi/agents/<agent>/memory/     Always in context (system/ files)
Zone B (Project)   <project>/.memory/               Session-scoped via /startwork
Zone C (Sessions)  .pi/sessions/                    Pi-managed, accessed via memory_recall
```

## Quick Start

```bash
# 1. Create your agent
/agent:init alph

# 2. Bootstrap a project
/memory:init ~/Projects/my-app

# 3. Start working
/startwork my-app
```

## Commands

| Command | Description |
|---------|-------------|
| `/agent:init <name>` | Create a new agent with memory repo |
| `/agent:switch <name>` | Switch active agent |
| `/startwork [project]` | Start session, set project memory root |
| `/endwork` | End session, update status, commit |
| `/memory:init <path>` | Bootstrap `.memory/` in a project directory |
| `/memory:tree [path]` | Browse memory tree |
| `/memory:read <path>` | Read a memory file |
| `/memory:search <query>` | Full-text search |
| `/memory:recall <query>` | Search session history |
| `/remember` | Consolidate session into global memory |

## Tools

Six tools registered: `memory_tree`, `memory_read`, `memory_write`, `memory_search`, `memory_recall`, plus `super_sessions_analyze` and `super_sessions_synthesize`.

All file-based tools accept an optional `root` parameter to override the session root.

## Project Patterns

**Standalone** — single repo projects get their own `.memory/`:

```
~/Projects/BTTN/.memory/
└── reference/
    ├── index.md
    ├── status.md
    └── strategy.md
```

**Organisation** — multi-project umbrellas share one `.memory/`:

```
~/DEV/Heaven/.memory/
└── reference/
    ├── index.md
    ├── strategy.md
    ├── heavencrm/status.md
    ├── daily_hl/status.md
    └── ...
```

Each sub-project gets an `AGENTS.md` (in its own repo) with a memory pointer telling agents where to load context.

## File Format

Every memory file uses YAML frontmatter + markdown body:

```markdown
---
description: "Chose middleware over guard-based auth"
importance: 5
tags: [auth, middleware, architecture]
created: 2026-04-20
updated: 2026-04-22
---

# Decision
...
```

`[[wiki-links]]` create a navigable memory graph between files.

## Design

See [SPEC_v4.md](SPEC_v4.md) for the full design document — token budget, progressive disclosure protocol, session workflow, acceptance criteria.

## License

MIT
