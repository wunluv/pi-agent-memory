## /memory:init Bootstrap Logic

When the user types `/memory:init <path>`, the command bootstraps `.memory/` in that directory.

### What the Command Does (Mechanical)

1. Creates `<path>/.memory/` directory structure
2. `git init` inside `.memory/`
3. Creates `reference/`, `system/` and `project_insights/` directories
4. Decides the pattern — **organisation** (two or more sub-directories with `package.json` or a git
   repo) or **standalone** — because the report differs, not because the files do

   **It writes no memory files at all.** Directories, `project.json` and the first commit only (#84).
   A stub file full of "TBD" renders in `memory_tree` like content, goes stale in silence, and makes
   absence useless as a signal. So: no `reference/index.md`, no `reference/strategy.md`, no
   `system/index.md`, no `reference/status.md` (#82 retired it) and no `session/latest.md`. State is
   written by the first real `/endwork`; the org registry, eagle eye and project context are written
   when there is something true to say.

5. Scans for existing docs so the report can name what is missing:
   - Reads `README.md` and `package.json` for project name, stack, description
   - Reads any existing state file — a legacy `reference/status.md` or a
     `session/latest.md` — for current state
   - If standalone, reads the project root
   - If org, reads each sub-project directory

7. Generates `AGENTS.md` stub in project root if one doesn't exist:
   - Stack (from package.json)
   - Entry points (scanned)
   - Key files
   - Run commands
   - Gotchas section (empty, for human to fill)

8. Does NOT delete or modify any existing files
9. Does NOT push to any remote (`.memory/` is local git only)
10. Initial commit in `.memory/`

### What to Tell the User

After completion, report:
- Pattern detected (org with N sub-projects, or standalone)
- What exists: directories, `project.json`, the first commit. Say plainly that nothing was stubbed
- What to write when it is true: `system/index.md` (project context); `reference/index.md` and
  `strategy.md` for an org
- Where state will go: `session/latest.md`, written at the first `/endwork`, and that its absence until
  then is the signal `/startwork` reads
- Reminder: ".memory/ is local git only. Not pushed to GitHub."

### AGENTS.md Template

When generating AGENTS.md, use this structure:

```markdown
# Project Name — Agent Brief

## Stack
[detected from package.json]

## Entry Points
[scanned from src/ or main files]

## Key Files
[scanned]

## Conventions
[detected or left empty for human]

## Run
```bash
[detected install + run commands]
```

## Test
[detected or "No test suite yet"]

## Gotchas
[empty, for human to fill]
```

Keep it sub-500 words. Terse. An agent loads this and knows the terrain.
