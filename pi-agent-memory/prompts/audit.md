# Memory audit — write proposals, apply nothing

The measurement for this root is below. Read it, then propose. Nothing is applied in this pass.

{{SUMMARY}}

## Before you propose

- `memory_tree` at the root. `memory_read` only the files a proposal names.
- A proposal that deletes or moves content must say where the reader is redirected. #82 retired `status.md` in the docs and it kept pulling 30 sessions of reads for another month.
- The always-loaded budget is the thing being defended: Zone A `system/` plus the project's AGENTS.md. A proposal that adds a line must remove more than it adds.
- Prefer deletions, merges and moves over rewrites. A rewrite costs the same tokens and buys nothing measurable.

## Proposal shape

Write `project_insights/audit-<YYYY-MM-DD>/proposals.md` with `memory_write`. One proposal per finding:

    ## P1 — <one line, what changes>
    - **file:** <path>
    - **edit:** <exact: delete these lines / merge X into Y / move to Z / split into A and B>
    - **saves:** <N tokens of always-loaded context, or "0 — structure only">
    - **evidence:** <the number or read-trail row that justifies it>
    - **falsifies:** <the observation next cycle that would prove this wrong>

Rank by tokens saved. Six proposals is the ceiling; three is usually right.

## Then

Stop. List the proposals to San with the token saving on each, and say what you recommend cutting first. Do not apply any of them, and do not write to any file except the proposals file.
