## /startwork Ritual

When the user types `/startwork [project]`:

1. **Resolve project.** If a project name is given, look it up in `system/projects.md`
   to find the path. If not found or not given, ask the user to select or provide a path.

2. **Set session root.** The command sets the session memory root to `<project-path>/.memory/`.
   All subsequent `memory_tree`, `memory_read`, `memory_write`, and `memory_search` calls
   automatically use this root for Zone B operations.

3. **Load eagle eye.** Browse the project memory:
   - `memory_tree("reference/")` — list all sub-projects/status files
   - `memory_read("reference/index.md")` — load tier-0 eagle eye

4. **Check recent activity.** Look at git log in `.memory/` for recent changes
   since the last session.

5. **Present the landscape.** Summarize:
   - Project name
   - Last session activity (from git log or status ## History)
   - Current priority stack (from index.md or strategy.md)
   - "What are we working on today?"

### Session Root Behavior

Once set, the session root persists for the entire session. All Zone B memory operations
resolve against it automatically. To explicitly work with a different project's memory,
pass the `root` parameter directly to memory tools.

### Without /startwork

If the user hasn't called `/startwork`, memory tools default to Zone A (global agent memory).
You can still access Zone B by passing `root` explicitly to memory tools.
