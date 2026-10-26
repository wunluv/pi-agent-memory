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

## GitHub Workflow

Issue-driven. Every change starts as a GitHub issue (template in `.github/ISSUE_TEMPLATE/`). An issue is a prompt — it states the desired outcome and enough context for an agent to execute without asking what you meant. Open issues are the source of truth; work in issue order unless dependencies say otherwise.

**Tiers** (labels):

- **routine** — fixes, small enhancements → commit straight to `main`
- **serious** — core logic, data model, templates, public interface, high-risk changes → branch + PR, San reviews
- **phase-2** — feature tagged from the design spec (see `docs/IMPROVEMENT-DRAFTS.md`)

**Loop (all tiers):**

1. **Create issue:** `gh issue create` — problem, proposed solution, risk tier, test plan
2. **Implement** in atomic commits (one intent each). Reference the issue with `refs #n` in the commit body (links without closing). Never use closing keywords (`closes`/`fixes`/`resolves`).
3. **Comment** on the issue for decisions; discuss with San when needed
4. **Test** where applicable: `node --check`, dry-runs, curl API checks
5. **Push:** `git push origin main` (routine) or open a PR referencing the issue (serious)
6. **Deploy:** this extension is consumed via symlink (`~/.pi/agent/extensions/pi-agent-memory` → this tree), so the working tree IS the live code; changes take effect on next pi restart
7. **Close issue** explicitly, last: `gh issue close <n> -c "Fixed in <short-hash>. Verified: <test result>"`

Closing is always explicit and the final step. Never use closing keywords in commits or PRs — they auto-close on push/merge, which is silent and drops the verification record.

## Session Start

1. `git status --short` — flag uncommitted changes
2. Load `.memory/wip.md` if exists
3. Load project status: `memory_read("reference/status.md", root="~/DEV/pi/agent_memory/.memory")`
4. Summarize: pending changes, WIP state, next action

## Entry Points

```
pi-agent-memory/index.ts    # Extension entry — registerTools, registerCommands, lifecycle hooks
pi-agent-memory/prompts/    # Prompt templates loaded at runtime with file-based fallback
```

Pi loads this extension from `~/.pi/agent/extensions/pi-agent-memory` (symlinked to this directory).

## Files

Four entry points: `pi-agent-memory/index.ts` (tools, commands, hooks), `pi-agent-memory/prompts/`
(`system.md` injected every turn; the startwork, endwork, audit, consolidate, audit-check and
init-memory rituals), `pi-agent-memory/scripts/memory-audit.mjs` (the measurement engine), and this
file.

Repo tree, module map and what each module owns: `docs/TECHNICAL.md` §9. Design and planning:
`docs/DATA-MODEL.md`, `docs/EXPLAINED.md`, `docs/WBS.md`, `docs/IMPROVEMENT-DRAFTS.md`. Canonical spec:
`SPEC_v4.md`. Project memory lives in `.memory/` (`reference/status.md`, `wip.md`,
`session/latest.md`).

## Architecture

```
Zone A (Agent)     ~/.pi/agents/<agent>/memory/     Always in context (system/ files)
Zone B (Project)   <project>/.memory/               Session-scoped via /startwork
Zone C (Sessions)  .pi/sessions/                    Pi-managed, via memory_recall/super_sessions
```

**Terminology — zones vs buckets.** Zones A/B/C are lifecycle layers (always-injected / session-scoped / archive). The org root `~/.pi/org/` (shared registry + role library) is a fourth, orthogonal store — not "Zone D". SPEC_v4's "buckets" (`system/`, `knowledge/`, `<project>/.memory/`, `~/.pi/org/`) name the same layers by content: Zone A holds `system/` + `knowledge/` + a thin `projects/` index. The two vocabularies are aliases, not competing models.

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

## Tools and commands

Eight tools, eighteen commands, two hooks. The tables, the root-resolution chain, the `system/` write
guard and the hook behaviour are in `docs/TECHNICAL.md` §6. Two surfaces matter here day to day: the
canonical state filenames in `## Rules`, and the maintenance loop below.

## Maintenance loop (#92)

Memory only grows unless something measures and prunes it. Before this loop existed,
cold start had gone from a 2.0K mean in April 2026 to 8.0K in October, and one audit had
run in a month on one of twenty projects.

```
memory_audit (free)  ──▶  /memory:audit      proposals, applies nothing
                              │ San approves by id
                              ▼
                          /memory:consolidate  one memory_write per proposal + BASELINE.md
                              │ ~10 sessions later
                              ▼
                          /memory:audit-check  keep / kill / demote, written to CHECK.md
```

- **Measurement engine:** `scripts/memory-audit.mjs`. Session JSONL is the source: first-turn
  `usage.input` gives the real cold start, `memory_read` calls give the read trail, bash
  signatures give the rediscovery count. No model calls, no new storage (#34's sidecar is
  redundant).
- **Cadence:** derived, never stored. `audit.ts` reads the last commit touching
  `project_insights/audit` and counts session files dated after it. Due at 20 sessions or 30
  days; the notice appears in `memory_status` and as one line in the system prompt.
- **Why a notice and not a cron:** a cron comments on nothing. The line reaches the model
  inside the turn, and the model is the one who can run the loop.

## Extension Points (Phase 2 candidates)

Four hooks are absent in Phase 1 by design, so Phase 2 extends rather than modifies: `beforeMemoryWrite`,
`afterMemoryCommit`, a `resolveMemoryRoot` plugin, and an archival storage backend. What each would take:
`docs/IMPROVEMENT-DRAFTS.md` §6.

## Rules

- Node built-ins only (`fs`, `path`, `os`, `child_process`). Zero npm dependencies.
- TypeBox for parameter schemas (pi SDK requirement)
- TypeScript — entry `index.ts` + 14 modules by concern (sync, identity, discovery, paths, backlinks, session-search, search-sessions, ranked-search, context-budget, gitignore, handoff, status, project-lookup, audit). Zero npm dependencies.
- `memory_write` is always an atomic git commit
- Zone B `.memory/` repos are local git with an OPTIONAL private remote (mem server, issue #8) — never the project's public code repo. The old "local-only, no remote" rule was superseded by the one-store decision (#17)
- Session root cleared on session_start hook — no cross-session leakage
- `~` in root params expanded to home directory
- Canonical state filenames — `reference/status.md` (durable state), `wip.md` (in-flight scratch), `session/latest.md` (rolling handoff) — distinct purposes, never overlap. Authoritative text in `pi-agent-memory/prompts/system.md`.

## Procedures

- **Inline scripts break on quoting more often than they work.** A quoted `node -e "` failed 117 times
  across 87 sessions and `python3 - <<EOF` 72 times across 111 (`memory_audit`, 2026-10-23). Use the
  shapes in `.memory/reference/procedures/inline-scripts.md` before writing one.

## Gotchas

- `memory_write` auto-initializes git if no repo exists at the resolved root
- `parseFrontmatter` only handles simple YAML (description, importance, tags, created, updated). Nested structures ignored.
- `buildTreeView` walks directories recursively — large memory trees can be slow. Progressive disclosure is the user's responsibility.
- `memory_recall` is BM25-ranked with importance/recency boosts (#42); tolerant of malformed JSONL lines; bounded excerpts.
- The extension is split by concern into modules (index.ts + 9); `index.ts` remains the only file with tool/command registration.
- Pi loads the extension by reading `index.ts` from the symlink target. The symlink must exist before Pi starts.

## Sibling Projects

- `super-sessions` — session analysis + wisdom synthesis pipeline (separate extension, consumes Zone C)
- HeavenCRM — reference implementation of the engineering methodology (.memory/DATA-MODEL.md, FLOW-TRACE.md, INTERFACE-PLAN.md)
- Heaven `.memory/framework/` — canonical methodology docs (methodology-injection, prompts, cheatsheet)

## Communication
- when referencing github issues include subject/title example:  Closed #62 (briefly describe issue subject here)
- be explicit when describing things. example:  and is waiting on nothing but a slot (say what this slot is?).

