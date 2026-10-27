# Memory audit check — keep, kill, demote

{{SUMMARY}}

Baseline: read `project_insights/audit-<date>/BASELINE.md` (the most recent one). Proposals: the `proposals.md` beside it.

## The ledger comes first

Read `reference/ledger.md`. It holds the checks someone already agreed to, with the metric written **before** the change was made. Those outrank anything read out of a baseline, because a baseline records numbers and the ledger records intent.

For every row at `installed` whose `check_after` has passed:

1. Compute `check_metric` by `check_definition` exactly as written. If the definition is ambiguous, say so — do not quietly improve it, because a redefined metric cannot be compared to its own baseline.
2. Report it against the same metric over the window before `installed_at`, and normalise per 100 tool calls when the mix of work can move the absolute count.
3. Write the verdict into the ledger, not only into `CHECK.md`, one command per row after CHECK.md is written:

```
/learning close <id> --verdict keep --note "failed calls 4.1 to 1.2 per 100 bash calls over 20 sessions"
```

Rows at `approved` with nothing installed are not this pass's business: name them and move on. A row that cannot be measured because its artifact was never found is `rewrite`, not `keep`.

## Per proposal, decide from the measurement, not from intent

| observation | verdict |
|---|---|
| applied, cost fell as predicted | keep |
| applied, cost fell less than predicted but fell | keep, correct the estimate |
| applied, cost flat | keep, rewrite the falsification test — the fix may still be right and the test wrong |
| applied, pattern still recurs | rewrite: wrong home or wrong trigger phrasing |
| never needed (pattern gone) | delete, and say so plainly |
| always-loaded context grew across two cycles running | prune before adding anything else |

## Write

`project_insights/audit-<YYYY-MM-DD>/CHECK.md`: the verdict table, one row per proposal, then the two numbers that
decide the cycle — always-loaded tokens (before → after) and read-trail concentration. Then update the proposals file
if the next audit should inherit unfinished items.

Every verdict reached above is also closed in the ledger with `/learning close`. Two records, one meaning: `CHECK.md`
is the argument, the ledger is the state.

## Then

One paragraph to San: what earned its place, what goes, what the next cycle starts from. If nothing changed and
nothing needs to change, say that too — a check that finds no rot is a result.
