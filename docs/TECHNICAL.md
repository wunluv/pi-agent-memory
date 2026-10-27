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

**Terminology — zones vs buckets.** Zones A/B/C are lifecycle layers (always-injected /
session-scoped / archive). The org root `~/.pi/org/` (shared registry + role library) is a
fourth, orthogonal store — not "Zone D". SPEC_v4's "buckets" (`system/`, `knowledge/`,
`<project>/.memory/`, `~/.pi/org/`) name the same layers by content: Zone A holds `system/` +
`knowledge/` + a thin `projects/` index. The two vocabularies are aliases, not competing models.

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

**Derived remotes** (derived from config, written by the extension, never edited by hand):

| Target | URL |
|--------|-----|
| Agent (Zone A) | `<server_url>/<agent-uuid>.git` |
| Project (Zone B) | `<server_url>/<sanitized-name>.git` |
| Org layer | `<server_url>/org.git` |

Sanitization: `[^a-zA-Z0-9._-]+` → `-`. **Guard:** every call passes
`assertPrivateMemoryRemote` — URL must start with `<server_url>/` and end
`.git`.

**`origin` and divergence (#98).** After a successful pull or push the derived
URL is stored as `origin`, the branch tracks it, and `refs/remotes/origin/<b>` is
seeded from HEAD (no network). Before #98 the remote was passed as an argument and
never stored, so `@{upstream}` never resolved — which meant the divergence check
in `status.ts` (`rev-list --left-right --count HEAD...@{upstream}`) could never
return a number, and `memory_status` reported healthy on a repo whose commits had
never left the machine. An `origin` pointing anywhere other than the derived URL
is never repointed.

**Sync-on-commit hook (#98).** Each memory repo gets a `post-commit` hook that
pushes detached, so a commit made by hand in a shell reaches the server exactly
like one made by `memory_write`. It skips a rebase in progress (the caller syncs
after), skips when there is no `origin`, and is never written over a
`post-commit` this extension did not install. Failures stay silent in the hook;
the visible state is ahead/behind in `memory_status`, which names unpushed commits
in words.

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

**Tools (8, this extension):**

| Tool | Root resolution | Notes |
|------|-----------------|-------|
| `memory_tree(path?, root?)` | standard chain | directory listing from frontmatter descriptions, star ratings, no bodies |
| `memory_read(path, root?)` | standard chain | full file + frontmatter, extracts `[[links]]` |
| `memory_write(path, content, description, tags?, importance?, root?, overrideReason?)` | standard chain | atomic write+commit; `overrideReason` required for live `system/` spine writes (#36) |
| `memory_search(query, corpus?, root?)` | standard chain + org commons | ranked (BM25 + importance/recency boosts); `corpus: local\|shared\|all` in one pass (#71) |
| `memory_status(root?, checkRemote?)` | standard chain | zone, registration, local git state, last sync result, audit cadence line (#48) |
| `memory_sync_config(get\|set)` | global config | get/set `server_url`, `push_on_commit`, `pull_on_start` |
| `memory_recall(query)` | Zone C only | BM25 over session JSONL, malformed-line tolerant, bounded excerpts (#42) |
| `memory_audit(root?, agent?, sessions?, minSessions?, write?, scope?)` | standard chain | the measurement engine (#92); `scope: "project"` (default) or `"global"` (#99); free and read-only, writes TSVs only when `write:true` |

Plus `super_sessions_analyze` / `super_sessions_synthesize` (sibling extension,
consumes Zone C → writes analyses/wisdom into project memory).

**Commands (19):** `/agent:init`, `/agent:promote`, `/agent:switch`, `/agent:sync`,
`/agent:pull [uuid]`, `/startwork [project|path]`, `/endwork`, `/remember`,
`/memory:init <path>`, `/memory:tree`, `/memory:read`, `/memory:search`,
`/memory:recall`, `/memory:sync-config`, `/memory:status`, `/memory:audit [glob]`,
`/memory:audit-global [glob]`, `/memory:consolidate <proposals> [P1 …]`,
`/memory:audit-check [--global] [glob]`.

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
                             → Case B (registry, then knowledge/projects-active.md)
                             → Case C (offer bootstrap via /memory:init)
/endwork        → verify state file (four sections); commit; clear session root
```

## 9. Module map

### Repository layout

```
pi-agent-memory/
  index.ts            entry: tool + command + hook registration, session root, guards
  *.ts                one module per concern (below); no npm dependencies
  prompts/            system.md (injected every turn) + the ritual templates
  scripts/
    memory-audit.mjs  measurement engine (#92): CLI and imported by audit.ts
    legacy/           archived Letta-era protocol; canonical is prompts/system.md
  test/               pure unit suites
  test-harness/       tests that drive a registered tool through a fake pi
SPEC_v4.md            canonical spec
AGENTS.md             engineering contract
VMA.md                vision, mission, aims
docs/                 DATA-MODEL, TECHNICAL, EXPLAINED, WBS, IMPROVEMENT-DRAFTS
.memory/              this project's own memory (local git)
```

### Modules

```
index.ts           entry: tools, commands, hooks, guards, session root, bootstrap
sync.ts            config, derived URLs, guards, syncOnce/pullOnce/pushAsync, child script
identity.ts        agent.json/project.json, registry read/write, uuid minting
discovery.ts       nearest-.memory/ walk-up, resolve-once cache
paths.ts           path normalization, ~ expansion
scope.ts           scope resolution + reporting for read/search/tree results (#73)
ranked-search.ts   BM25 + importance/recency boosts
session-search.ts  Zone C JSONL retrieval adapter for memory_recall
search-sessions.ts `ss` CLI: the same BM25 over session files, for the shell
backlinks.ts       [[link]] extraction/traversal
context-budget.ts  system/ injection budget + pinning (#36)
handoff.ts         session handoff contract: .memory/session/latest.md (#50)
status.ts          memory + sync health surface (#48)
project-lookup.ts  knowledge/projects-active.md fallback lookup, miss diagnosis (#65, #97)
gitignore.ts       .gitignore excludes .memory/ on bootstrap
audit.ts           maintenance cadence: last audit from git, sessions since (#92)
prompts/           system.md (injected every turn), startwork, endwork, audit,
                   consolidate, audit-check, init-memory
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

## 12. Maintenance loop (#92)

Memory only grows unless something measures and prunes it. Before this loop existed, cold
start had gone from a 2.0K mean in April 2026 to 8.0K in October, and one audit had run in a
month on one of twenty projects.

```
memory_audit (free)  ──▶  /memory:audit      this project's numbers; proposals.md + proposals.tsv
                              │ San approves by id
                              ▼
                          /learning approve    opens a ledger row; refuses a row with no check
                              │ the change is made
                              ▼
                          /learning install    records artifact, commit, installed_at
                              │ check_after arrives
                              ▼
                          /learning close      keep / rewrite / delete, with its verdict written
```

The ledger (`reference/ledger.md`, #100) is the spine. Before it existed, nothing connected a
finding to a change to a check: the 2026-10-19 proposals returned verbatim on 2026-10-23, an
installed fix could not be listed for removal, and verification never ran once. One append-only
table per project, written only by the four `/learning` verbs.

- **Scope (#99, #100):** `/memory:audit` reports the project the session is standing in, plus the
  active agent's Zone A. It reads no other project's sessions and prints no portfolio figure. `/memory:audit-global` widens to every project and every agent. A scoped `never fetched`
  claim is stated as "by this project's sessions" — a file read only from another project
  looks dead in a narrow view, and dead-looking is an argument for deletion.
- **Measurement engine:** `scripts/memory-audit.mjs`. Session JSONL is the source: first-turn
  `usage.input` gives the real cold start, `memory_read` calls give the read trail, bash
  signatures give the rediscovery count. No model calls, no new storage (#34's sidecar is
  redundant).
- **Cadence:** derived, never stored. `audit.ts` reads the last commit touching
  `reference/ledger.md` once a project has one (before that, `project_insights/audit` stands in)
  and counts session files dated after it. Due at 20 sessions or 30 days, **or as soon as any
  installed row's `check_after` has passed** — an overdue pre-registered check outranks both
  thresholds, because someone already agreed that change would be measured by now. The notice
  appears in `memory_status` and as one line in the system prompt.
- **Why the clock moved (#100):** the friction loop writes into `project_insights/audit`, so
  keying the memory clock on that directory let a friction `endwork` reset it. d5 reported "last
  audit 2026-09-22", a friction commit. The ledger has one writer per meaning.
- **Placement (#100):** `scope` defaults to `project`. A shared skill, the commons or the
  always-loaded identity needs a global audit naming the pattern in two or more projects;
  `~/.pi/org/insights/memory-system/fix-placement.md` holds the rule.
- **Why a notice and not a cron:** a cron comments on nothing. The line reaches the model
  inside the turn, and the model is the one who can run the loop.

## 13. Gotchas

- `memory_write` auto-initializes git if no repo exists at the resolved root.
- `parseFrontmatter` handles simple YAML only (description, importance, tags, created,
  updated). Nested structures are ignored.
- `buildTreeView` walks directories recursively — large memory trees are slow. Progressive
  disclosure is the caller's responsibility.
- `memory_recall` is BM25-ranked with importance/recency boosts (#42), tolerant of malformed
  JSONL lines, and returns bounded excerpts.
- `index.ts` is the only file with tool/command registration; every other module is a concern
  with no registration side effects.
- The extension is loaded by reading `index.ts` through the symlink, so the symlink must exist
  before pi starts and the working tree is the live code.
