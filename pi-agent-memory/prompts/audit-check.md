# Memory audit check — keep, kill, demote

{{SUMMARY}}

Baseline: read `project_insights/audit-<date>/BASELINE.md` (the most recent one). Proposals: the `proposals.md` beside it.

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

## Then

One paragraph to San: what earned its place, what goes, what the next cycle starts from. If nothing changed and
nothing needs to change, say that too — a check that finds no rot is a result.
