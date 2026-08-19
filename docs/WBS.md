# pi-agent-memory — Work Breakdown Structure (Phase 2)

> Consolidated from the frozen Gate 2 scope and the 2026-08 design critique.
> Canonical spec: `SPEC_v4.md` §Phase 2 Scope. One work package = one GitHub issue.
> Supersedes the Gate-based `gameplan.md` (pre-methodology framing).

## Hierarchy

```
1.0 Phase 2
├── 1.1 Agent Identity          (foundation — ship first)
├── 1.2 Memory Sync             (depends on 1.1)
├── 1.3 Root Resolution & Discovery
├── 1.4 Retrieval
├── 1.5 Consolidation
├── 1.6 Context Budget
├── 1.7 Data Integrity
└── 1.8 Team Manifest           (project roster convention)
```

## Work Packages

### 1.1 Agent Identity — foundation

| ID | Package | Deliverable | Acceptance |
|----|---------|-------------|------------|
| 1.1.1 | `agent.json` generation | `/agent:init` writes `agent.json` (uuid v4 + name) | File created; re-init is idempotent (keeps UUID) |
| 1.1.2 | UUID in commits + frontmatter | git commit author `agent-<short-uuid>`; `agent_id` in frontmatter | `git log` shows agent author; new writes carry `agent_id` |
| 1.1.3 | Runtime UUID load | Load UUID at start; null-safe | No crash when `agent.json` absent |
| 1.1.4 | Thin org index | Locator file: name → Zone A path, UUID, status (`ephemeral | member`); written only at membership transitions | Index lists members; never duplicates identity content |
| 1.1.5 | Temp identity state | First-class ephemeral state: temp UUID + registry row | Promotion = state flip (`ephemeral → member`), no data migration |

**Depends on:** nothing. **Issue:** #7 (open).

### 1.2 Memory Sync — Zone A only

| ID | Package | Deliverable | Acceptance |
|----|---------|-------------|------------|
| 1.2.1 | `post-commit` push hook | Hook on Zone A repo; pushes if `push_on_commit` + `server_url` + Zone A | Zone B never pushes; failure logged, write still succeeds; 5s cap |
| 1.2.2 | `/agent:pull [uuid]` | Pure `git clone` from server; name from `agent.json` | Works against any git remote (GitHub, memfs) |
| 1.2.3 | `memory_sync_config` | get/set `push_on_commit`, `pull_on_start` | Read fills defaults; `root` only selects policy file |
| 1.2.4 | `session_start` auto-pull | Conditional pull before Zone A context build | 2–3s fail-fast; unreachable server → continue on local state |

**Depends on:** 1.1 (commit author uses UUID). **Issue:** #8 (open).

### 1.3 Root Resolution & Discovery

| ID | Package | Deliverable | Acceptance |
|----|---------|-------------|------------|
| 1.3.1 | Walk-up resolver | `resolveMemoryRoot` walks up from stable project signal | No mid-session root flip; wrong root = local misplacement only |
| 1.3.2 | Resolve-once cache | Resolve once per session, cache | Never re-walks per tool call |
| 1.3.3 | Registry + robust `/startwork` | `registry.json` name→path map + reconcile-on-move prompt + offer `/memory:init` | Deterministic `/startwork` by name; stale path reconciled via prompt |
| 1.3.4 | `/startwork` as ritual | Load eagle eye + priorities; not a gate | Works with no `.memory/` present (auto-discover) |

**Depends on:** 1.3.3 extends issue #1 (strict parser, shipped). **Issues:** 1.3.3 = #13 (open, folds in #4); 1.3.1/1.3.2/1.3.4 = #9 (open).

### 1.4 Retrieval

| ID | Package | Deliverable | Acceptance |
|----|---------|-------------|------------|
| 1.4.1 | BM25 ranked search | `ranked-search.ts`; replaces substring grep; importance + recency boosts; snippets | `node --check`; fixture corpus ranks correctly | 
| 1.4.2 | Backlinks | `findBacklinks()`; `memory_read` shows "referenced by" | Path forms (`.md`/no-ext/suffix) resolve |
| 1.4.3 | Archival vector search | Reuse heaven-search as agent-only sidecar (deferred, see #10) | — future — |

**Depends on:** 1.4.3 after 1.4.1 (keyword baseline first, semantic layer later). **Issues:** 1.4.1 = #2, 1.4.2 = #3 (open); 1.4.3 = #10 (future).

### 1.5 Consolidation

| ID | Package | Deliverable | Acceptance |
|----|---------|-------------|------------|
| 1.5.1 | `/remember` refinement | Scoped to 2–3 turns; prompt-style; project → `reference/`, human → `system/` | Correct routing; distill not transcribe |
| 1.5.2 | Consolidation loop | `consolidateSession()` on `/endwork` — roll `## History`, mark stale, merge by topic | History cap; `[STALE]` marking; no data loss |

**Depends on:** 1.5.2 uses `importance`/`updated` frontmatter (exists since Phase 1). **Issues:** 1.5.2 = #5 (open); 1.5.1 = #11 (open).

### 1.6 Context Budget

| ID | Package | Deliverable | Acceptance |
|----|---------|-------------|------------|
| 1.6.1 | `system/` token cap | Budgeted injection ranked by importance + recency | Over-budget files cut first; still reachable via tools |

**Issue:** #6 (open).

### 1.7 Data Integrity — frontmatter validation

| ID | Package | Deliverable | Acceptance |
|----|---------|-------------|------------|
| 1.7.1 | `beforeMemoryWrite` validation hook | Frontmatter schema + protected-field guard on every write | Malformed frontmatter (missing/unclosed, unknown key, empty description, bad `importance`, `read_only` set/change/remove) rejected before write |

**Pattern reference:** Letta Code CLI's `pre-commit` hook (bash) — same checks, rebuilt for our schema as a TypeScript extension hook. **Issue:** #16 (open). **Depends on:** nothing; **feeds 1.2** (validate files pulled by sync before they land).

### 1.8 Team Manifest — project roster convention

| ID | Package | Deliverable | Acceptance |
|----|---------|-------------|------------|
| 1.8.1 | Manifest scaffold | `/memory:init` creates `.memory/team/manifest.md` (empty roster template + conventions header) for new AND existing projects; idempotent | Scaffold present after init; existing manifest never clobbered |
| 1.8.2 | Roster-only contract | Manifest holds Role → Identity → UUID → Status only; review gates live in project planning docs, care-loop records deferred | Schema enforced by 1.7 (future); SPEC §2.8 captures the split |

**Depends on:** 1.1 (manifest references UUIDs). **Issue:** #18 (open).

## Dependencies

```
1.1 ──► 1.2            (sync commits carry agent UUID)
#1  ──► 1.3.3          (strict parser precedes registry.json)
1.4.1 ─► 1.4.3         (keyword baseline before semantic layer — soft)
1.7 ──► 1.2            (validation guards files pulled by sync)
1.1 ──► 1.8            (manifest references agent UUIDs)
```

Everything else is independent and can be picked up in any order.

## Recommended Sequence

1. **Quick wins:** 1.4.1 (#2), 1.4.2 (#3), 1.6 (#6) — small, self-contained, fix daily retrieval now
2. **Foundation:** 1.1 → 1.2 — identity, then sync
3. **Discovery:** 1.3
4. **Team manifest:** 1.8 — bootstrap the roster convention early so projects start using it
5. **Consolidation:** 1.5
6. **Archival:** 1.4.3 — DEFERRED (future: compose with heaven-search as a sidecar)

## Issue Map

| WBS | Issue | Status |
|-----|-------|--------|
| 1.3.3 | #13 | open (folds #4) |
| 1.4.1 | #2 | merged (PR #12) |
| 1.4.2 | #3 | merged (PR #15) |
| 1.5.2 | #5 | open |
| 1.6.1 | #6 | merged (PR #15) |
| 1.1.x | #7 | open (hybrid registry specced) |
| 1.2.x | #8 | open |
| 1.3.1/1.3.2/1.3.4 | #9 | open |
| 1.4.3 | #10 | future |
| 1.5.1 | #11 | open |
| 1.7.1 | #16 | open |
| 1.8.x | #18 | open |
