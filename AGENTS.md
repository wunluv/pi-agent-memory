# AGENTS.md — pi-agent-memory

> Three-zone git-backed markdown memory system for pi agents. TypeScript · Node built-ins · TypeBox.

This file is the contract, not the manual. It is injected into every session in this repo, so it
carries only what shapes a decision on the first turn. Architecture, the tool surface, the module
map, gotchas and the maintenance loop live in `docs/TECHNICAL.md` — read the section you need rather
than keeping it in view. `## Where things live` is the index.

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

Closing is explicit and last — no closing keywords, so the verification record survives.

## Session Start

1. `git status --short` — flag uncommitted changes
2. Load `.memory/wip.md` if exists
3. Load project state: `memory_read("session/latest.md", root="~/DEV/pi/agent_memory/.memory")`
4. Summarize: pending changes, WIP state, next action

## Files

Four entry points: `pi-agent-memory/index.ts` (tools, commands, hooks), `pi-agent-memory/prompts/`
(`system.md` injected every turn; the startwork, endwork, audit, consolidate, audit-check and
init-memory rituals), `pi-agent-memory/scripts/memory-audit.mjs` (the measurement engine), and this
file.

Repo tree, module map and what each module owns: `docs/TECHNICAL.md` §9. Design and planning:
`docs/DATA-MODEL.md`, `docs/EXPLAINED.md`, `docs/WBS.md`, `docs/IMPROVEMENT-DRAFTS.md`. Canonical spec:
`SPEC_v4.md`. Project memory lives in `.memory/`: `session/latest.md` is the state file (current state,
decisions, next actions), `wip.md` is in-flight scratch that survives a restart, and `reference/` holds
everything else.

## Where things live

| To learn | Read |
|---|---|
| Zones, resolution order, the `before_agent_start` hook | `docs/TECHNICAL.md` §2 |
| Tool and command surface, root chain, `system/` write guard | §6 |
| Write path | §7 |
| Session lifecycle | §8 |
| Module map, repository layout | §9 |
| Known gaps | §10 |
| Maintenance loop (#92): audit → consolidate → audit-check | §12 |
| Gotchas | §13 |
| Phase 2 extension points | `docs/IMPROVEMENT-DRAFTS.md` §6 |

## Rules

- Node built-ins only (`fs`, `path`, `os`, `child_process`). Zero npm dependencies. TypeBox for parameter schemas (pi SDK requirement).
- `memory_write` is always an atomic git commit.
- Zone B `.memory/` repos are local git with an OPTIONAL private remote (mem server, issue #8) — never the project's public code repo (#17).
- Canonical state files — `session/latest.md` (the state file: current state, decisions, open threads, next actions) and `wip.md` (resume state: exact commands, current blocker) — distinct purposes, never overlap. `reference/status.md` retired (#82); its durable content is `## Current state`. Authoritative text in `pi-agent-memory/prompts/system.md`.
- Session root cleared on `session_start` hook — no cross-session leakage. `~` in root params is expanded to the home directory.
- The symlink is the deployment: `~/.pi/agent/extensions/pi-agent-memory` → this tree, so the working tree is live code and changes land on the next pi restart. It must exist before pi starts.

## Procedures

- **Inline scripts break on quoting more often than they work.** A quoted `node -e "` failed 117 times
  across 87 sessions and `python3 - <<EOF` 72 times across 111 (`memory_audit`, 2026-10-23). Use the
  shapes in `.memory/reference/procedures/inline-scripts.md` before writing one.

## Sibling Projects

- `super-sessions` — session analysis + wisdom synthesis pipeline (separate extension, consumes Zone C)
- HeavenCRM — reference implementation of the engineering methodology (.memory/DATA-MODEL.md, FLOW-TRACE.md, INTERFACE-PLAN.md)
- Heaven `.memory/framework/` — canonical methodology docs (methodology-injection, prompts, cheatsheet)

## Communication
- when referencing github issues include subject/title example:  Closed #62 (briefly describe issue subject here)
- be explicit when describing things. example:  and is waiting on nothing but a slot (say what this slot is?).
