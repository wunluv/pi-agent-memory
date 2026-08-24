# pi-agent-memory — Technical Reference

Implementation-accurate reference for engineers. Describes the system as built
(2026-08), not as designed. Design intent lives in `SPEC_v4.md`; entity
relationships in `docs/DATA-MODEL.md`. The Gate 2 interface plan
(`docs/INTERFACE-PLAN.md`) is archived — this document supersedes it as the
interface reference; history in git.

## 1. What this is

A git-backed markdown memory system for pi agents, delivered as a pi extension.
Every memory write is an atomic git commit. Three memory zones (agent, project,
session) plus one shared org layer. ~850-token cold start. Zero npm
dependencies: Node built-ins + TypeBox (pi SDK) only.

**Key numbers:** extension = 9 TypeScript modules, `index.ts` 1911 lines
(entry: 6 tools, 13 commands, 2 hooks). 8 test files. Sync engine in
`sync.ts` (318 lines).

## 2. Architecture

```
ZONE A — Agent       ~/.pi/agents/<name>/memory/     git repo; system/*.md injected every turn
ZONE B — Project     <project>/.memory/              git repo; session-scoped via /startwork
ZONE C — Sessions    .pi/sessions/<cwd-hash>/        pi-managed JSONL; memory_recall + super_sessions
ORG LAYER            ~/.pi/org/                      shared git repo: registry.json + roles/
```

Resolution order for all file tools: explicit `root` param → session root →
auto-discovered nearest `.memory/` (walk-up from cwd, bounded at `~/.pi`) →
agent root (Zone A).

## 3. Entities

| Entity | Identity | Identity file | Location |
|--------|----------|---------------|----------|
| Org | none minted (single implicit org) | — | `~/.pi/org/` |
| Human | uuid at scale; not minted today | — | customer store (future) |
| Agent | uuid (v4), immutable | `agent.json` `{uuid, name, status}` | `~/.pi/agents/<name>/memory/` |
| Project | uuid (v4), immutable | `project.json` `{uuid}` only | `<project>/.memory/` |
| MemoryRoot | `agent:<uuid>` \| `project:<uuid>` | derived | owner dir |
| MemoryFile | — | — | relative `.md` under a root |

**Identity vs name vs path** (the core invariant):

| Axis | Nature | Stored where | Syncs? |
|------|--------|-------------|--------|
| uuid | immutable, global | identity file | yes |
| name | mutable, human-facing | directory name + registry | yes |
| path | mutable, machine-local | registry only | **no** |

Consequences: the directory is keyed by name (human-readable filesystem), the
uuid lives inside the identity file, rename never moves the uuid, and the
registry's `path` field never leaves the machine.

**Project soul rules:** `project.json` holds the uuid only (name/path would
drift). `cp -r` of a project carries the uuid → a fork, which `/startwork`
surfaces as a "mint a fresh uuid" prompt, never silent. Legacy roots without
`project.json` are unidentifiable; `/startwork` proceeds without registering
(see Known gaps).

## 4. The registry

`~/.pi/org/registry.json` — one shared index per machine. Single-writer
convention; written only at gated transitions (project registration/moves,
agent recruitment/promotion).

```json
{
  "version": 2,
  "updated": "2026-08-20",
  "projects": { "<uuid>": { "name": "...", "path": "...", "humans": ["..."] } },
  "members":  { "<uuid>": { "name": "...", "status": "member|ephemeral", "memoryPath": "..." } },
  "humans":   { "<uuid>": { "name": "...", "agents": ["..."] } }
}
```

Keyed by uuid, never name (rename-proof). Relationships stored once at their
owner: `humans[uuid].agents`, `projects[uuid].humans` (ACL: open when absent,
bound when present).

## 5. Sync engine

**Config:** `~/.pi/memory-sync.json` (mode 600), one per device:

```json
{ "server_url": "ssh://mojah2/var/www/private/pi-agent-memory",
  "push_on_commit": true, "pull_on_start": true }
```

Sync is off entirely when `server_url` is unset.

**Derived remotes** (never user-managed; no persistent `git remote` on any repo):

| Target | URL |
|--------|-----|
| Agent (Zone A) | `<server_url>/<agent-uuid>.git` |
| Project (Zone B) | `<server_url>/<sanitized-name>.git` |
| Org layer | `<server_url>/org.git` |

Sanitization: `[^a-zA-Z0-9._-]+` → `-`. **Guard:** every call passes
`assertPrivateMemoryRemote` — URL must start with `<server_url>/` and end
`.git`. Fetch/push go by explicit URL argument (`git pull <url> <branch>`),
so `git remote -v` stays empty on all local repos.

**Push mechanics** (`pushAsync`, `sync.ts`): after a gated commit, a detached
node child runs `pull --rebase --autostash <remote> <branch>` then `push`,
60s ceiling per op, always exits 0, logs to
`~/.pi/agent/memory-repository-push.log`. The write never waits on the
network. Branch is derived at runtime via `rev-parse --abbrev-ref HEAD`.

**Conflict policy:** rebase, never force. Same-file conflict → abort rebase,
both sides intact, human resolves. First push to a bare repo (`isNoRemoteRef`)
skips the pull and provisions via `git init --bare` over ssh when needed.

**Sync triggers:**

| Hook / command | Action | Timeout |
|----------------|--------|---------|
| `session_start` | `syncOrgOnStart`: pull org layer (push:false) + auto-discovery | 2.5s fail-fast |
| `/startwork` (begin) | `syncProjectOnStart`: pull project soul | 60s |
| post-commit | `maybeSyncAfterCommit(root)`: dispatch by root role — Zone A → agent repo; org root → `syncOrgAfterWrite`; registered Zone B (has `project.json`) → project repo | async, fire-and-forget |

**Server contract:** stateless bare git repos at `<server_url>/`; portable
(migrate = copy repos + update `server_url` per device); any git remote valid;
ssh provisioning fallback.

## 6. Tools and commands

**Tools (6, this extension):**

| Tool | Root resolution | Notes |
|------|-----------------|-------|
| `memory_tree(path?, root?)` | standard chain | directory listing from frontmatter descriptions, star ratings, no bodies |
| `memory_read(path, root?)` | standard chain | full file + frontmatter, extracts `[[links]]` |
| `memory_write(path, content, description, tags?, importance?, root?)` | standard chain | atomic write+commit; `overrideReason` required for live `system/` spine writes (#36) |
| `memory_search(query, root?)` | standard chain | ranked (BM25 + importance/recency boosts), 10-match cap |
| `memory_recall(query)` | Zone C only | BM25 over session JSONL, malformed-line tolerant, bounded excerpts (#42) |
| `memory_sync_config(get\|set)` | global config | get/set `server_url`, `push_on_commit`, `pull_on_start` |

Plus `super_sessions_analyze` / `super_sessions_synthesize` (sibling extension,
consumes Zone C → writes analyses/wisdom into project memory).

**Commands (13):** `/agent:init`, `/agent:switch`, `/agent:sync`, `/agent:pull
[uuid]`, `/startwork [project|path]`, `/endwork`, `/remember`, `/memory:init
<path>`, `/memory:tree`, `/memory:read`, `/memory:search`, `/memory:recall`,
`/memory:sync-config`.

**Hooks (2):** `before_agent_start` → `buildSystemContext()` injects all
`system/*.md` recursively into the system prompt (~850 tokens, pinned by #36);
`session_start` → org pull + auto-discovery + clear session root.

## 7. Write path

```
memory_write(path, content, description, tags?, importance?, root?)
  → resolveMemoryRoot()                     # param → session → discover → agent root
  → #36 guard: system/ spine writes need overrideReason
  → write file + generate frontmatter       # description, importance, tags, created, updated, agent_id
  → git add <file> && git commit -m "<path>: <description>"
  → maybeSyncAfterCommit(root)              # async push by root role (see §5)
```

Atomic: write and commit succeed or fail together. Every write is versioned by
git; frontmatter `agent_id` is immutable after first write.

## 8. Session lifecycle

```
session_start   → clear session root; syncOrgOnStart (2.5s fail-fast); auto-discover → cache root
/startwork      → no-arg: use discovered root, begin (set session root, syncProjectOnStart, eagle-eye tree)
                → named: resolve path → Case A (.memory exists: reconcile uuid, fork prompt)
                             → Case B (registry/projects.md lookup)
                             → Case C (offer bootstrap via /memory:init)
/endwork        → update status.md ## Current; commit; clear session root
```

## 9. Module map

```
index.ts           entry: tools, commands, hooks, guards, session root, bootstrap
sync.ts            config, derived URLs, guards, syncOnce/pullOnce/pushAsync, child script
identity.ts        agent.json/project.json, registry read/write, uuid minting
discovery.ts       nearest-.memory/ walk-up, resolve-once cache
paths.ts           path normalization, ~ expansion
ranked-search.ts   BM25 + importance/recency boosts
session-search.ts  Zone C JSONL scan (memory_recall)
backlinks.ts       [[link]] extraction/traversal
context-budget.ts  system/ injection budget + pinning (#36)
gitignore.ts       .gitignore excludes .memory/ on bootstrap
prompts/           system.md (injected every turn), startwork.md, endwork.md, init-memory.md
test/              8 files: backlinks, context-budget, discovery, gitignore, identity, paths, session-search, sync
```

## 10. Known gaps (as of 2026-08-24)

- **`org.git` not yet provisioned on the sync server.** `syncOrgAfterWrite`
  only fires on gated registry writes; none since #24 merged. Every
  `session_start` org pull fails silently (empty FETCH_HEAD). Fix rides on
  issue #46 (first gated org write provisions the bare repo).
- **No-arg `/startwork` skips reconcile** (#46): a discovered root without
  `project.json` is never minted or registered. Writes commit locally but the
  Zone B push dispatch (`maybeSyncAfterCommit` gates on `readProjectUuid`)
  silently skips. No warning to the user.
- Sync failures are non-fatal by design; unavailable remotes never block
  project work.

## 11. Glossary

| Term | Definition |
|------|-----------|
| Soul | An Agent or Project with a persistent uuid (the syncing unit) |
| Zone | A: agent, B: project, C: session |
| MemoryRoot | The git repo a zone resolves to |
| Registry | Shared uuid→name/path index at `~/.pi/org/registry.json` |
| Gated write | A registry write at a transition (register, move, promote), human-approved |
| Derived remote | URL computed from `server_url`, never user-managed |
| Spine | The pinned `system/` files always injected into context (#36) |
