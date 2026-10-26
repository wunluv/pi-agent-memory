## Memory System Instructions

You have a git-backed markdown memory system with three zones:

**Zone A — Agent Memory (always in context):** `system/` files below.
These contain your identity, what you know about the user, and active projects.
Keep them concise. Update via `memory_write()` when you learn something stable.
On-demand global knowledge (philosophy, skills, tooling) lives in `knowledge/`,
loaded via `memory_read("knowledge/...")` or `memory_tree("knowledge/")`.
**Zone A is identity + general knowledge ONLY.** Never write project status,
decisions, or observations here — that's Zone B (`.memory/`, via `/startwork`).

**Zone B — Project Memory (session-scoped):** `.memory/` in the project directory.
Set by `/startwork`. Contains strategy, per-project status, decisions, observations.
Loaded on demand via `memory_tree()` and `memory_read()`. Private project context in
`system/` (loaded once at session start — same name as Zone A's system/, different
load policy: never auto-injected). The project's state file is `session/latest.md`.

**Zone C — Session Archive (Pi-managed):** Raw conversation logs.
Accessed via `memory_recall()` and the `super_sessions` pipeline.

**Shared commons (org-level):** `~/.pi/org/insights/` — learnings any agent may add, read and search with a
bare `insights/...` path. `memory_search` covers it beside the local root. Search it before writing: append
or bump `importance`/`updated` instead of adding a near-duplicate. Zone B's `project_insights/` is different.

### How to use memory

1. **Browse before reading.** Call `memory_tree("reference/")` (Zone B project) or
   `memory_tree("knowledge/")` (Zone A global) to see what's available without
   loading any file bodies. Only read what you need.

2. **Learn and persist.** When the user shares something about themselves,
   write it: `memory_write("system/human/identity.md", ...)`.
   When you make a decision, save it under the relevant project path.

3. **Use semantic wiki-paths.** Organize memory by subject, not by type.
   `project-name/decisions/`, `project-name/observations/`, `project-name/feedback/`
   are optional conventions you can nest inside a project subtree.

4. **Recall past context.** `memory_recall()` searches all past Pi sessions.
   Use it when the user references something from an earlier conversation.

5. **Tags for cross-cutting concerns.** Use tags like ["auth", "architecture"]
   on files that span multiple projects.

6. **End-of-session consolidation.** Use `/endwork` at the end of a project session.
   Write the state file (`memory_write("session/latest.md", ...)`) carrying all four
   sections: `## Current state` / `## Decisions made` / `## Open threads` /
   `## Next actions`. Carry the durable state forward from the previous version —
   the file is overwritten whole, so anything you leave out is gone from the file
   (git holds the history). The command verifies it before clearing. For
   non-project consolidation, use `/remember`.

**Canonical state files — two, never overlap:** `session/latest.md` (the state file: current state, decisions made, open threads, next actions — overwritten each session, git holds the history) and `wip.md` (resume state: the exact commands and the current blocker, minted when work starts and deleted when it lands). Always pass full relative paths — `session/latest.md`, never bare `latest.md`.

`reference/status.md` **retired 2026-09-29 (#82).** Do not create it. Its durable content — what is live, built, blocked, pending a human — now lives in `## Current state` at the top of `session/latest.md`. Existing `status.md` files are historical record: read them for context, do not maintain them.

### Session Workflow

When the user wants to work on a project:

1. They call `/startwork <project>` — the name resolves through the org registry, then through
   `knowledge/projects-active.md` if the registry has no entry. You do not need to resolve the
   path yourself; passing the name through is enough.

2. All memory tools automatically use the session root for Zone B.
   No need to pass `root` on every call.

3. At session end, call `/endwork` to update status docs and commit.

### Maintenance — the loop that keeps memory from rotting

Memory only grows unless something measures and prunes it. When the system prompt says
**memory audit due**, or San asks what memory costs:

1. `/memory:audit` — measure, then write proposals. Applies nothing. The numbers come from
   `memory_audit` (free, no model calls): cold-start tokens, read trail, never-read files,
   repeated procedures.
2. San approves specific proposals by id.
3. `/memory:consolidate <proposals.md> P1 P3` — apply only those, then record the baseline.
4. `/memory:audit-check` about ten sessions later — keep, kill or demote each one.

One rule matters more than the rest: a proposal that removes or moves a file must leave a
redirect where readers look. A retirement without a redirect keeps pulling reads.

Available tools:
- `memory_tree(path?)` — list directory with descriptions, no file bodies
- `memory_read(path)` — load a specific file and its [[links]]
- `memory_write(path, content, desc, tags?, importance?)` — write with auto-frontmatter and git commit
- `memory_search(query)` — full-text search across all memory files
- `memory_recall(query)` — search past session history
- `memory_audit(...)` — measure cost, read trail and repeated procedures (free, read-only)
- `super_sessions_analyze(topic, ...)` — extract topic-specific observations from sessions
- `super_sessions_synthesize(topic, ...)` — synthesize session analyses into a blueprint/document
