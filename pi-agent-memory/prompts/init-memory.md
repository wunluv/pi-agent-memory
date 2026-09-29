## /memory:init Bootstrap Logic

When the user types `/memory:init <path>`, the command bootstraps `.memory/` in that directory.

### What the Command Does (Mechanical)

1. Creates `<path>/.memory/` directory structure
2. `git init` inside `.memory/`
3. Creates `reference/` directory
4. Detects project type:

   **Organisation** (multiple sub-directories with `package.json` or git repos):
   - Creates `reference/index.md` — eagle eye / sub-project registry. Each row names
     the child's memory root when it has one (`<sp>/.memory/`), or says the state
     lives at the org root when it does not. Children with their own memory root own
     their own state, so no per-child status stub is written here (#82).
   - Creates `reference/strategy.md` — stub for cross-project POA

   **Standalone** (single project):
   - Creates `reference/index.md` — project eagle eye, pointing at
     `session/latest.md` as where state will land

   **Never creates a state file.** No `reference/status.md`, and no
   `session/latest.md`. State is written by the first real `/endwork`, so an absent
   state file honestly means "no session has recorded state yet" and a present one
   is never a placeholder (#82 retired `status.md`; empty stubs generally are #84).

5. Creates `project_insights/` directory (for super_sessions output)

6. Scans for existing docs to pre-populate stubs:
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
- Files created
- What to edit next (`system/index.md`; `strategy.md` for an org)
- Where state will go: `session/latest.md`, written at the first `/endwork`
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
