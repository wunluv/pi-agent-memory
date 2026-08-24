## /startwork Ritual

When the user types `/startwork [project]`:

1. **Resolve project.** If a project name is given, look it up in `system/projects.md`
   to find the path. If not found or not given, ask the user to select or provide a path.

2. **Set session root.** The command sets the session memory root to `<project-path>/.memory/`.
   All subsequent `memory_tree`, `memory_read`, `memory_write`, and `memory_search` calls
   automatically use this root for Zone B operations.

3. **The command surfaces, in order:**
   - **Last session handoff** (`session/latest.md`) — the distilled "where we
     were": decisions, open threads, next actions. Surfaced FIRST.
   - **Eagle-eye tree** of `reference/` (filenames + one-line descriptions).
   - **Last changes in memory** — the raw git log delta (last ~8 commits,
     dates + messages): what changed since the last session.
   - **Project context** (`.memory/system/`) — the project's private identity,
     working agreements, and memory rules. Loaded once at session start.

4. **Present the landscape.** Summarize:
   - Project name
   - Last session handoff + activity
   - Current priority stack (from index.md or strategy.md)
   - "What are we working on today?"

### Load Policy — Zone A vs Zone B `system/`

The `system/` name means "context" in both zones; the load policy is the
documented difference:

- **Zone A `system/`** (agent memory): injected into the system prompt EVERY
  turn (~850 tokens). Always present.
- **Zone B `system/`** (`.memory/system/`): loaded ONCE at `/startwork`, never
  auto-injected. Private project context — never ships to the code repo.
  Graceful fallback: a project without `system/` behaves exactly as before.

### Session Root Behavior

Once set, the session root persists for the entire session. All Zone B memory operations
resolve against it automatically. To explicitly work with a different project's memory,
pass the `root` parameter directly to memory tools.

### Without /startwork

If the user hasn't called `/startwork`, memory tools default to Zone A (global agent memory).
You can still access Zone B by passing `root` explicitly to memory tools.
