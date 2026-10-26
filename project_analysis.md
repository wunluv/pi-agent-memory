# How the reserved-file convention actually behaves

**Date:** 2026-09-29 · **Scope:** all 29 `.memory/` roots under `~/DEV` · **Repo under test:** `pi-agent-memory`

An audit of the three canonical state files the memory system defines, checked against what is on disk rather than against the spec. Every claim below is reproducible with `find`, `wc -c`, and `git log`.

**Redaction rule applied.** This repository is public. Project directory names already disclosed in existing public issues (`Heaven`, `d5`, `kalai`, `heavencrm`, `heaven_mailer`, `heaven_next`, `heaven_news`, `godwriting`, `mojah2`) are kept so the evidence is checkable. Customer names, revenue figures, host addresses, and business content from private project memory are omitted; none of them carry the argument. Figures, byte counts, dates, and paths are exact.

---

## 1. What the convention says

`pi-agent-memory/prompts/system.md:51`:

> **Canonical state files — three, never overlap:** `reference/status.md` (durable project state: live/broken/pending-human), `wip.md` (in-flight scratch, survives restart), `session/latest.md` (rolling handoff: decisions/open/next). Always pass full relative paths — `reference/status.md`, never bare `status.md`.

That one line is the whole specification. Enforcement exists in only one place: `handoff.ts` defines `SESSION_HANDOFF_PATH = "session/latest.md"` and `/endwork` refuses to clear the session root unless it exists and is dated today.

| File | Created by | Surfaced by | Folded by | Validated by |
|---|---|---|---|---|
| `reference/status.md` | `/memory:init` (stub) | nothing | nothing | nothing |
| `wip.md` | nothing | nothing | nothing | nothing |
| `session/latest.md` | the agent | `/startwork` (first) | overwritten next session | `handoff.ts` gate |

`wip.md` appears in no ritual at all: not created by init, not surfaced by `/startwork` (which lists the handoff, the `reference/` tree, the git delta, and project context), and not touched by `/endwork`. It is named in exactly one advisory sentence.

---

## 2. Adoption across 29 roots

| File | Roots containing it |
|---|---|
| `reference/status.md` | 10 |
| `session/latest.md` | 14 |
| `wip.md` | 3 |
| no state file at all | 11 |

`wip.md` roots: `kalai`, `heavencrm`, `heaven_mailer`.

---

## 3. Findings

### 3.1 The trio merges into one document when a root is healthy

`~/DEV/kalai/.memory` is the only root holding all three files. All three are dated 2026-09-18 at importance 5, and all three retell the same session: the same design decision agreed, the same verification milestone reached, and the same two technical findings recorded. `reference/status.md`'s Log entry is an abstract of `session/latest.md`'s Decision list.

One session, three documents, three times the authoring cost, and no reader can tell which one is the record.

### 3.2 The durable file is the one that dies

This is the sharper failure, and it is not a merge:

| Root | Canonical `reference/status.md` | Where the durable state actually lives |
|---|---|---|
| `heaven_mailer` | **268 bytes**, still the init stub ("Status pending / Plan TBD"), untouched since 2026-08-18 | `reference/daily_hl/status.md`, 18,977 bytes, updated 2026-09-28 |
| `heavencrm` | **absent** — archived to `.archive/reference/status.md` and `.archive/reference/heavencrm/status.md` | no live status file anywhere |
| `mojah2`, `mailarchive`, `pi/`, `Heaven/` | absent | handoff only |

In `heaven_mailer` the same root holds a dead stub at the canonical path and the live state one directory away. An agent that starts at the canonical path reads "Status pending" and concludes the project is unstarted. Writing a stub at a canonical path is worse than writing nothing, because a stub reads as current truth.

### 3.3 `wip.md` is an orphan file

Least adopted (3 of 29), managed by nothing, and it has already rotted: `kalai`'s is 11 days old and describes work that has moved on.

It still earns its place, for one reason the other two files do not cover. That root's `wip.md` holds **reproducible shell commands** to resume the work — the exact push, build, and run invocations, including the flags. Neither `status.md` nor `session/latest.md` holds anything equivalent, which makes `wip.md` the most useful of the three documents there.

### 3.4 Enforcement is on the wrong file

The only mechanical guarantee in the system protects the file that is overwritten every session. The durable file, whose entire purpose is to remain true between sessions, has no ritual, no validation, and no staleness signal. Rot is invisible: `memory_tree` shows a description and a star rating, so a file written six weeks ago renders identically to one written this morning even though `updated:` is already in its frontmatter.

### 3.5 A child's status has no single home

In `~/DEV/Heaven/`, a child's status file can live in the org root, the child root, both, or neither:

| Child | Org-root copy | Child-root copy |
|---|---|---|
| `heaven_next` | 2,709 B, updated 2026-08-18 | 5,067 B, updated 2026-08-28 |
| `daily_hl` | 6,045 B, updated 2026-09-18 | 18,977 B, updated 2026-09-28 |
| `heaven_news` | 2,577 B, updated 2026-09-03 | absent (only `project_insights/`) |
| `d5` | absent | 14,411 B, updated 2026-09-30 |
| `heavencrm` | absent | archived, no live file |

`heaven_next` has two divergent copies. The org registry row points at the **older, shorter** one. `heaven_news` is authoritative at the org root by accident.

The org registry (`Heaven/.memory/reference/index.md`) gives ten children four different path shapes for the same question, and at least two rows are broken: `heavencrm` points at `reference/heavencrm/status.md` in a directory that holds 13 topic files and no status file, and `d5` points at a directory (`reference/`) rather than a file. The same directory contains both `brand/` and `Brand/`, differing only by case.

This is the same collision class as #75, which settled the within-root case (`system/<relpath>` naming two files). The cross-root case has no rule.

### 3.6 Bootstrap costs more than it returns

`/memory:init` writes stub files that, in the majority of roots, are never filled. 11 of 29 roots hold no state file at all; several of the 10 with `reference/status.md` hold init stubs. Each stub costs a git commit, a `memory_tree` row, a false positive for any staleness check built on top, and the risk described in 3.2.

`~/DEV/MSA/.memory/status.md` and `~/DEV/MSA/research-agent/.memory/status.md` are bare-root `status.md`, the exact form the convention warns against. That drift is manual rather than generated, which suggests the intended path is not obvious from the bootstrap output either.

---

## 4. Proposals

Ranked by leverage against effort. Issues filed in `wunluv/pi-agent-memory`.

| # | Proposal | Tier | Issue |
|---|---|---|---|
| 1 | `/memory:init` stops writing empty stubs; create only files with real content, report intended paths in the output instead | serious | [#84](https://github.com/wunluv/pi-agent-memory/issues/84) |
| 2 | Staleness becomes visible: reserved files pinned at the top of `memory_tree` with their `updated` date, and one plain line from `/startwork` when the durable file is absent or older than the handoff | routine | [#85](https://github.com/wunluv/pi-agent-memory/issues/85) |
| 3 | Define the boundary: what each reserved file holds and what must never appear in it, with the pipeline direction (durable lines fold up into `status.md`) | serious | [#82](https://github.com/wunluv/pi-agent-memory/issues/82) |
| 4 | Give `wip.md` a lifecycle: minted on start, surfaced first by `/startwork`, folded into `status.md` and the handoff by `/endwork`, then deleted. Existence becomes the signal | serious | [#86](https://github.com/wunluv/pi-agent-memory/issues/86) |
| 5 | One authority rule for child status across org and child roots, following #75's shape: pick a winner, name the loser's role explicitly | serious | [#83](https://github.com/wunluv/pi-agent-memory/issues/83) |
| 6 | Reconcile the org registry: every row resolves to a real, current file, one path shape, `brand`/`Brand` merged | routine | [#87](https://github.com/wunluv/pi-agent-memory/issues/87) |

**Sequencing.** #84, #85 and #87 are cheap and fix live misinformation, so they go first. #87 needs the path-shape decision that #82 or #83 settles; either order works. #86 depends on #82, because the fold destination must be defined before `wip.md` can be folded into it.

**Deliberate omissions.** #84 does not migrate the stubs already on disk. Replacing a placeholder with real state requires knowing what the state is, so that is human work per root. #87 does not settle which copy wins when both exist; it fixes pointers.

---

## 5. The open question

**Answered 2026-09-29.** San: "i have not read the status.md file once since it was implemented, so fold it."

So the honest outcome is two files rather than three: `reference/status.md` retires, `session/latest.md` becomes the state file carrying the durable content in `## Current state`, and `wip.md` carries resume state. Implemented as PR #88 (#82), including a required-section check in `handoff.ts` so the folded durable content cannot be silently dropped by an overwrite.

What remains unanswered is the same question one level down: **does San read `session/latest.md`?** Nothing confirms he does. Retiring one unread file and promoting another to carry its content is a reasonable bet, not a verified one, and #34 (access tracking) is still the mechanism that would answer it from data.

---

## 5a. The original question, as asked

Does San actually read `reference/status.md`?

The audit can see what is written, not what is read. If the durable file is written and never opened, then proposal 3's honest outcome is that the set shrinks to two files and `status.md` is retired rather than defended. #34 (access tracking) is the mechanism that would answer this from data; a direct answer settled it, and the answer was no.

Related: #74 (out-of-band edits do not sync) applies to any cleanup done in a project memory repo — a plain `git commit` there lands locally and never reaches the sync server, while `memory_status` still reports healthy. Any reconciliation commit must be pushed explicitly and verified on the host.

---

## 6. Method

```
find ~/DEV -maxdepth 3 -name .memory -type d          # 29 roots
git -C <root> log -1 --format=%ad --date=short -- <file>
wc -c <file>
find <root> -name status.md -not -path '*/.git/*'
```

Adoption counts exclude `.git` and archive directories. Byte counts and dates are as observed on 2026-09-29 and will drift; the structural findings (four path shapes, three routings, one validated file) are the durable part.
