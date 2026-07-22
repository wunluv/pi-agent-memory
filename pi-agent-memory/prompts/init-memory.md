## /memory:init Bootstrap Logic

When the user types `/memory:init <path>`, the command bootstraps `.memory/` in that directory.

### What the Command Does (Mechanical)

1. Creates `<path>/.memory/` directory structure
2. `git init` inside `.memory/`
3. Creates `reference/` directory
4. Detects project type:

   **Organisation** (multiple sub-directories with `package.json` or git repos):
   - Creates `reference/index.md` — eagle eye listing all sub-projects
   - Creates `reference/strategy.md` — stub for cross-project POA
   - Creates `reference/{sub}/status.md` for each sub-project (stub)

   **Standalone** (single project):
   - Creates `reference/index.md` — project eagle eye
   - Creates `reference/status.md` — operational logbook stub

5. Creates `project_insights/` directory (for super_sessions output)

6. Scans for existing docs to pre-populate stubs:
   - Reads `README.md` and `package.json` for project name, stack, description
   - Reads any existing `STATUS.md` files for current state
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
- Files created
- What to edit next (strategy.md, per-project status stubs)
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
