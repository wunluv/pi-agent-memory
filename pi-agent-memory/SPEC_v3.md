# Pi Agent Memory System — SPEC v3

A lightweight memory system for pi agents. Two-tier git-backed markdown files with progressive disclosure. On-demand project memory browsing (matches Letta's model). ~800 tokens cold start.

## Why This Exists

Letta Code's memory model works: two-tier git-backed markdown with frontmatter, only `system/` files in context, everything else loaded on demand. But its cold start is ~14K tokens. Pi agents cold start at ~200 tokens. This replicates Letta's memory architecture as a single pi extension: **same model, 17× lighter, no external server.**

Beyond the token advantage, this spec addresses what V2 missed after reviewing a mature Letta system prompt: human-specific memory, behavioral discipline, recall of full conversation history, and wiki-link cross-referencing between memory files.

## Physical Layout

```
~/.pi/agents/<agent-name>/
└── memory/                          ← git repo (one per agent)
    │
    ├── system/                      ← PINNED: always in context
    │   ├── persona.md               # Who I am, relationship with user, communication discipline
    │   ├── human/                   # What I know about my user
    │   │   ├── identity.md          # Background, motivations, drives
    │   │   └── preferences.md       # Communication style, work patterns, AI philosophy
    │   └── projects.md              # Lightweight index of active projects ([[links]] only)
    │
    ├── <project>/                   ← LAZY: semantic wiki-paths organized by project/domain
    │   └── <topic>/                 # Path IS the taxonomy — browse by subject
    │       ├── status.md
    │       ├── decisions/           # Optional: per-project sub-categories
    │       ├── observations/
    │       ├── feedback/
    │       └── references/
    │
    └── _meta/                       ← LAZY: cross-project concerns (optional)
        ├── observations/
        ├── feedback/
        └── decisions/
```

## What Goes Where

| Tier | Directory | In context? | What belongs here |
|------|-----------|-------------|-------------------|
| Pinned | `system/persona.md` | Always | Identity, beliefs, relationship with user, language discipline, model awareness, known limitations |
| Pinned | `system/human/` | Always | User's background, communication style, work patterns, what they value in AI collaboration |
| Pinned | `system/projects.md` | Always | Lightweight project index with [[links]] — 5 tokens per project, not full context |
| Lazy | `<project>/` (e.g. `reference/heavenletters/`) | On demand | Everything about a specific project or domain — status, decisions, observations, references |
| Lazy | `<project>/decisions/` | On demand | Technical/architectural decisions with rationale and rejected alternatives |
| Lazy | `<project>/observations/` | On demand | Session notes, milestone events, relational observations |
| Lazy | `<project>/feedback/` | On demand | User corrections specific to this project |
| Lazy | `<project>/references/` | On demand | Project details, specs, external documentation |
| Lazy | `_meta/` | On demand | Cross-project concerns that don't belong to any specific project |

### Semantic wiki-paths: path IS the taxonomy

Paths describe *what* the memory is about, not *what kind* of memory it is.

```
reference/heavenletters/status.md         ← the subject IS the path
my-app/auth/decision.md                   ← self-documenting
my-app/auth/references/rfc-spec.md        ← hierarchical by project
_meta/observations/cross-cutting.md       ← only things without a project home
```

The old categorical grouping (`archive/decisions/`, `archive/observations/`) becomes an **optional per-project convention** — you can nest `decisions/`, `observations/`, `feedback/` inside a project subtree when it's useful, but the primary organization is by subject.

Benefits:
- **`memory_tree("reference/heavenletters/")`** shows everything known about heavenletters in one view
- **Paths are self-documenting** — no need to guess which category a memory lives in
- **Project subtrees replace `[[links]]`-only indexes** — each project is its own directory
- **Cross-project `_meta/`** catches things that don't fit a project

### Why keep `feedback/` and `observations/` as optional sub-paths?

Observations are neutral records. Feedback is corrective — "you do X and I want you to stop." Keeping them separate within a project means the agent can scan feedback history without sifting through general observations. Over time, persistent feedback graduates into `system/persona.md` as behavioral rules.

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

## Reasoning
- Middleware composes cleanly: logging → auth → validation → handler
- Guards couple auth to route definitions
- Middleware enables independent testing

## Rejected
- Decorator-based (too coupled, magic behavior)
- Inline checks (violates DRY)

## See Also
- [[my-app/auth/observations/jwt-config]]
- [[system/policies]]
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | Single sentence. What this file contains. Used in `memory_tree()` listings. |
| `importance` | No | 1–5. Controls star rating in tree view. Default 3. |
| `tags` | No | Array of lowercase strings. Used in `memory_search()` and filtering. |
| `created` | Auto | ISO date. Set automatically on first write. |
| `updated` | Auto | ISO date. Updated automatically on edit. |

### `[[path]]` Wiki-Links

Files can reference each other using `[[path/relative/to/memory/root]]`:

```markdown
## See Also
- [[reference/heavenletters/observations/2026-04-27-session.md]]
- [[system/human/preferences.md]]
```

These are rendered as navigable links in `memory_tree()` output and can be followed via `memory_read()`. This creates a navigable memory graph — the agent can "walk" its memory by following related links.

### The `description` Field

The most important field. When the agent calls `memory_tree()`, it sees only file paths and descriptions — not file bodies. This is Letta's key insight: **browse without paying to read.**

```
reference/
└── heavenletters/
    ├── status          (★★★★★) — Current state of heavenletters project
    ├── decisions/
    │   └── auth-strategy (★★★★★) — Chose middleware over guard-based auth
    ├── observations/
    │   └── 2026-04-27-session (★★★★) — First session: identity confabulation (Claude)
    └── references/
        └── deepseek-v4-paper (★★★★★) — Technical report: CSA+HCA, Muon, OPD, 1.6T params

_meta/
├── feedback/
│   ├── over-qualifiers (★★★★★) — Tends to inflate statements with unnecessary qualifiers
│   └── misattribution  (★★★★)  — Claimed credit for user's parameter count guess
└── observations/
    └── v3-spec-review (★★★★★) — Reviewed V2 spec against Letta prompt, identified 7 gaps
```

~100 tokens. Full awareness of everything the agent knows about. Zero content loaded.

## Context Loading

### Only `system/` is auto-injected

On every turn, the extension reads all `system/*.md` files (recursively) and appends them to the agent's system prompt. **Nothing from project subtrees or `_meta/` is auto-injected.**

The agent accesses lazy contents exclusively through tool calls:
- `memory_tree()` — browse what's available
- `memory_read()` — load specific files
- `memory_search()` — full-text search
- `memory_recall()` — search session history

This matches Letta's model: the agent knows nothing about project memory contents until it asks.

### Token Budget

| Component | Tokens | What |
|-----------|--------|------|
| Pi's base system prompt | ~200 | Tools, capabilities, guidelines |
| Memory tool descriptions | ~120 | Five tools, one-line each |
| `system/persona.md` | ~150 | Identity, discipline, relationship |
| `system/human/identity.md` | ~80 | User background, drives |
| `system/human/preferences.md` | ~100 | Communication style, work patterns |
| `system/projects.md` | ~60 | Lightweight project index |
| Memory header/footer | ~30 | Section markers |
| **Total cold start** | **~740** | |

Budget is measured, not guessed. The acceptance criteria verify this.

### When to edit system files

`system/` files are for **stable, cross-session knowledge.** Edit them when:
- Setting up a new agent (`/agent:init`)
- The user's role or preferences change significantly
- Persistent feedback patterns graduate from a project's `feedback/` (or `_meta/feedback/`) into `system/persona.md`
- Project list changes

Daily observations, session notes, and one-off feedback stay in their respective project directories or `_meta/`. This prevents pinned context from growing.

## Tools

### Five tools

| Tool | Description |
|------|-------------|
| `memory_tree(path?)` | List directory with frontmatter descriptions. Default: memory root. |
| `memory_read(path)` | Read full content of a memory file (system/, project path, or _meta/). |
| `memory_write(path, content, description, tags?, importance?)` | Write/edit file anywhere under memory root. Auto-commits to git. |
| `memory_search(query)` | Full-text search via `rg` across memory repo. |
| `memory_recall(query)` | Search Pi session JSONL history for past conversations. |

### Tool Behaviors

**`memory_tree(path = "")`** (defaults to memory root)
- Recursively lists directories and `.md` files under `path`
- For `.md` files, extracts `description` and `importance` from frontmatter
- Renders `[[links]]` as navigable paths
- Returns formatted tree with star ratings
- Files without descriptions show filename only
- Respects `.memory_ignore` if present

**`memory_read(path)`**
- Path relative to `memory/` root
- Can read from `system/`, project paths, or `_meta/`
- Returns full markdown content including frontmatter
- Extracts and lists `[[links]]` found in the body for easy traversal

**`memory_write(path, content, description, tags?, importance?)`**
- Path relative to `memory/` root (can write to `system/`, project paths, or `_meta/`)
- Creates directories as needed
- Generates frontmatter from description/tags/importance
- Auto-commits: `git add <file> && git commit -m "<description>"`
- Returns confirmation with commit hash
- If path exists, edits file — previous version preserved in git

**`memory_search(query)`**
- Runs `rg --smart-case --max-count 10 <query>` across memory repo
- Returns matched lines with file paths
- Ignores `.git/` directory

**`memory_recall(query)`**
- Searches Pi session JSONL files for past conversations
- Returns matching message excerpts with session IDs
- Enables recovering context the agent observed but didn't explicitly write
- Under the hood: scans `~/.pi/agent/sessions/` for the current project

## Commands

| Command | Description |
|---------|-------------|
| `/agent:init <name>` | Set up new agent. Creates memory repo, walks through persona/human/projects setup |
| `/agent:switch <name>` | Switch active agent context |
| `/remember` | Consolidate current session into project memory paths |
| `/memory:tree [path]` | Display memory tree |
| `/memory:read <path>` | Read a memory file |
| `/memory:search <query>` | Full-text search |
| `/memory:recall <query>` | Search session history |

### `/agent:init <name>`

Interactive setup that creates the memory repo and populates initial system files:

1. Creates `~/.pi/agents/<name>/memory/` as a git repo
2. **Persona**: prompts for agent identity, beliefs, communication discipline
3. **Human**: prompts for user background, communication style, work patterns
4. **Projects**: prompts for active project list (names only, links later)
5. Writes template `system/` files
6. Initial commit

### `/remember`

End-of-session consolidation. The agent reviews the current conversation and writes 2–5 observations to the relevant project's `observations/`, `decisions/`, and/or `feedback/` sub-paths (or `_meta/` for cross-project items). This is explicit, not automatic — the user or agent decides when a session warrants it. Pattern:

1. Agent scans conversation for: decisions made, user feedback, relational insights, breakthroughs
2. Agent writes concise markdown files with frontmatter
3. Agent suggests any feedback patterns that should graduate to `system/persona.md`

## Git Integration

Every `memory_write` is an atomic git commit:

```
git add <file>
git commit -m "my-app/auth/decision.md: Chose middleware over guard-based auth"
```

Benefits:
- **Full history**: `git log` shows every memory change over time
- **Blame**: `git blame` traces when any line was added and why
- **Safe edits**: previous versions preserved on overwrite
- **Rollback**: `git revert` if a bad edit
- **Remote backup**: `git remote add origin ... && git push`
- **Parallel safety**: git worktrees if sub-agents are added later

## What's Not in This Spec

Deliberately deferred:

- **Dreaming/reflection sub-agents** — `/remember` is explicit. Autonomous background consolidation is Phase 2.
- **Vector search / embeddings** — `rg` and `memory_recall()` handle text search well enough for markdown and JSONL. Add only if proven necessary.
- **Sub-agent spawning** — single agent, single memory repo. Multi-agent is a separate problem.
- **Memory compaction** — Pi handles context compaction. Memory file summarization needs real usage patterns first.
- **Cross-agent shared memory** — one agent, one repo. Phase 2.

## Implementation

A single pi extension: `~/.pi/agent/extensions/agent-memory.ts`

- ~200 lines of TypeScript
- Five registered tools
- Five registered commands
- One `before_agent_start` hook (inject system/ files)
- No external dependencies beyond Node.js built-ins (`fs`, `path`, `child_process`)
- Uses `pi.exec()` for git and ripgrep

## Acceptance Criteria

1. **`/agent:init alph`** creates `~/.pi/agents/alph/memory/` as git repo with populated `system/` files
2. **`memory_write("my-app/auth/decision.md", content, "Chose middleware...", ["auth","middleware"], 5)`** creates file with correct frontmatter and commits it
3. **`memory_tree()`** returns formatted tree with descriptions and star ratings, no file bodies
4. **`memory_read("my-app/auth/decision.md")`** returns full content with extracted [[links]]
5. **`memory_search("middleware")`** returns matching lines with file paths
6. **`memory_recall("parameter count")`** returns relevant excerpts from past sessions
7. **On every turn**, only `system/*.md` files are injected into context — not project subtrees or `_meta/`
8. **`[[links]]`** in memory files are rendered in `memory_tree()` and extracted in `memory_read()`
9. **Cold start is under 850 tokens** (measured via Pi's token usage)
10. **`git log`** inside memory repo shows all writes with descriptive commit messages
11. **`/remember`** writes 2–5 observations from current session into appropriate project paths
