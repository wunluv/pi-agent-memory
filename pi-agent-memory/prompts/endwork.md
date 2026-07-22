## /endwork Ritual

When the user types `/endwork`:

1. **Summarize the session.** What did we decide, build, or discover?

2. **Identify affected status files.** Which `.memory/reference/{sub}/status.md`
   files need `## Current` updates? Look at what projects we touched.

3. **Update each status.md.** For each affected file:
   - `memory_read` the current content
   - Update `## Current` with today's changes (what was done, what's blocked, what's next)
   - Append significant milestones to `## History` with date
   - `memory_write` the updated file

4. **Commit project memory.** The command handles the git commit automatically.
   Commit message should summarize the session.

5. **Present closure.** Report:
   - Files updated
   - Key decisions/outcomes from the session
   - Top priority for next session
   - Reminder: "Run super_sessions weekly for extraction."

6. **Session root is cleared** automatically by the command.

### Status.md Convention

Each `.memory/reference/{sub}/status.md` follows this structure:

```
## Current
- What's live, what's recently changed
- Blocking items
- Next action

## Plan
- Roadmap, dependencies on other sub-projects
- Upcoming milestones

## History
- Past milestones with dates
- Key decisions and their context
```

At `/endwork`, update `## Current`. Move stale Current entries to `## History`.
Update `## Plan` only if priorities shifted during the session.

### If No Session Root

If `/startwork` was never called, `/endwork` has no project memory to update.
Suggest running `/remember` instead for global agent memory consolidation.
