# Memory consolidate — apply approved proposals, record the baseline

Proposals: {{PROPOSALS}}

San's approvals: {{APPROVED}}

## Rules

- Apply only the proposals San named. Not the ones you think are obvious. If no approvals were given, ask and stop.
- One `memory_write` per proposal, so each lands as its own commit and can be reverted alone.
- Delete, do not comment out. Move, do not copy. A retirement leaves a redirect where readers look.
- If a proposal cannot be applied as written because the file changed, stop and report it. Improvising is how the memory drifts from what was approved.

## Baseline

After the last proposal lands, re-run the measurement (`memory_audit` tool, same root, `write: true`) and write
`project_insights/audit-<YYYY-MM-DD>/BASELINE.md`:

    # Baseline <date>
    applied: P1, P3

    | proposal | always-loaded before | after | files touched |
    |---|---|---|---|
    | P1 | 3940 | 3104 | system/human/prefs/communication.md |

    Zone A total: 3940 → 3104 (−836, 21%)
    Budgeted pool: 2250/2400 → 1414/2400

Then confirm the commits are there: `git -C <root> log --oneline -n <number of proposals>`.

## Then

Report the before and after, the tokens saved, and the date the check is due (<10 sessions). Do not run the check now.
