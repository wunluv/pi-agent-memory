## /endwork Ritual

The session ends with a **handoff** written to a fixed location, verified by
the command before it clears the session root. The content is yours to curate;
the existence is structurally guaranteed (warn + skip, never trap).

When the user types `/endwork`:

1. **Summarize the session.** What did we decide, build, or discover?

2. **Write the state file — REQUIRED.** Before running `/endwork`, write the
   rolling state file:
   `memory_write("session/latest.md", <content>, "<project> state and handoff", ["session"])`
   Overwrites the previous session's file (git holds the history). Schema — all
   four sections are required and checked:

   ```
   ## Current state
   - What is live, built, blocked, or pending a human.
   - Carry this forward from the previous version: the file is overwritten
     whole, so what you leave out is gone from the file.

   ## Decisions made
   - ...

   ## Open threads
   - ...

   ## Next actions (top 3)
   1. ...
   2. ...
   3. ...
   ```

   `## Current state` is the durable half. It replaced `reference/status.md`
   (#82, 2026-09-29). `## History` is gone: git is the history, and
   `git log session/latest.md` is the log.

   The `date` + `agent_id` are stamped automatically in frontmatter by
   `memory_write` — the command checks that the file is dated today, and names
   any required section that is missing.

3. **Wrap up in-flight work.** If `wip.md` exists, fold its durable lines into
   `## Current state`, its next-action lines into the next actions, and then
   delete it. Its whole purpose is the exact resume commands, so do not keep a
   second copy elsewhere. (`wip.md` is not yet folded automatically — this is
   the manual step until that lands.)

4. **Commit project memory.** The command handles the git commit automatically.

5. **The command verifies the state file.** If `session/latest.md` is missing or
   not dated today, `/endwork` warns and offers to keep the session. Write the
   file and run `/endwork` again. "Skip anyway" clears the root without it —
   allowed, but the next session will start without the distilled context.

6. **Present closure.** Report:
   - Files updated
   - Key decisions/outcomes from the session
   - Top priority for next session
   - Reminder: "Run super_sessions weekly for extraction."

7. **Session root is cleared** automatically by the command.

### State-file convention

`session/latest.md` is the project's single state file. The four sections above
are the contract; `/endwork` reports any that are missing.

`reference/status.md` is retired (#82). Do not create or update one. If you find
an existing one, read it for context and fold anything still true into
`## Current state` rather than maintaining it.

### If No Session Root

If `/startwork` was never called, `/endwork` has no project memory to update.
Suggest running `/remember` instead for global agent memory consolidation.
