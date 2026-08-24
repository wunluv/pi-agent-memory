## /endwork Ritual

The session ends with a **handoff** written to a fixed location, verified by
the command before it clears the session root. The content is yours to curate;
the existence is structurally guaranteed (warn + skip, never trap).

When the user types `/endwork`:

1. **Summarize the session.** What did we decide, build, or discover?

2. **Write the session handoff — REQUIRED.** Before running `/endwork`, write
   the rolling handoff file:
   `memory_write("session/latest.md", <content>, "<project> session handoff", ["session"])`
   Overwrites the previous session's file (git holds the history). Schema:

   ```
   ## Decisions made
   - ...

   ## Open threads
   - ...

   ## Next actions (top 3)
   1. ...
   2. ...
   3. ...
   ```

   The `date` + `agent_id` are stamped automatically in frontmatter by
   `memory_write` — the command checks that the handoff is dated today.

3. **Identify affected status files.** Which `.memory/reference/{sub}/status.md`
   files need `## Current` updates? Look at what projects we touched.

4. **Update each status.md.** For each affected file:
   - `memory_read` the current content
   - Update `## Current` with today's changes (what was done, what's blocked, what's next)
   - Append significant milestones to `## History` with date
   - `memory_write` the updated file

5. **Commit project memory.** The command handles the git commit automatically.

6. **The command verifies the handoff.** If `session/latest.md` is missing or
   not dated today, `/endwork` warns and offers to keep the session. Write the
   handoff and run `/endwork` again. "Skip anyway" clears the root without a
   handoff — allowed, but the next session will start without the distilled
   context.

7. **Present closure.** Report:
   - Files updated
   - Key decisions/outcomes from the session
   - Top priority for next session
   - Reminder: "Run super_sessions weekly for extraction."

8. **Session root is cleared** automatically by the command.

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
