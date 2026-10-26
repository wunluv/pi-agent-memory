# Memory audit — write proposals, apply nothing

The measurement for this root is below. Read it, then propose. Nothing is applied in this pass.

{{SUMMARY}}

## Before you propose

- Read `reference/ledger.md` if it exists. Every design decision in this ledger records what was already proposed, approved, installed or **rejected**. A finding that is already a row does not come back as a new proposal: it comes back as a row to report (approved but not installed, or installed and past its check date). A rejected row stays rejected unless new evidence is named.
- `memory_tree` at the root. `memory_read` only the files a proposal names.
- A proposal that deletes or moves content must say where the reader is redirected. #82 retired `status.md` in the docs and it kept pulling 30 sessions of reads for another month.
- The always-loaded budget is the thing being defended: Zone A `system/` plus the project's AGENTS.md. A proposal that adds a line must remove more than it adds.
- Prefer deletions, merges and moves over rewrites. A rewrite costs the same tokens and buys nothing measurable.
- **Local first.** A proposal's `home` defaults to this project. A shared skill, the commons or the always-loaded identity needs a global audit naming the pattern in two or more projects; say which projects, or keep it local.

## Proposal shape

Write `project_insights/audit-<YYYY-MM-DD>/proposals.md` with `memory_write`. One proposal per finding:

    ## P1 — <one line, what changes>
    - **file:** <path>
    - **edit:** <exact: delete these lines / merge X into Y / move to Z / split into A and B>
    - **saves:** <N tokens of always-loaded context, or "0 — structure only">
    - **evidence:** <the number or read-trail row that justifies it>
    - **falsifies:** <the observation next cycle that would prove this wrong>

Rank by tokens saved. Six proposals is the ceiling; three is usually right.

## Also write `proposals.tsv`

Beside the markdown, in the same directory, write `proposals.tsv`: bare tab-separated text, a header
row, one row per proposal, and no markdown fence. This is what `/learning approve <id>` reads, so a
proposal without a row here cannot be approved and will be re-proposed next cycle.

The header and column order are fixed:

```
id	opened	source	class	finding	evidence	home	scope	artifact	status	approved_by	installed_at	commit	check_metric	check_definition	check_after	verdict	verdict_date
```

Rules for the cells:

- `id` — `<project-slug>-<YYYY-MM-DD>-NN`, two-digit counter. Unique forever.
- `status` — `proposed`. Only a row written by `/learning` moves past this.
- `opened` — today.
- `source` — `memory_audit`, or the analysis that produced it.
- `evidence` — the file or number in this report the finding rests on.
- `home` — where the change lands, in words.
- `scope` — `project` unless a global audit justified wider.
- `finding` — one line, no tabs, no newlines.
- `check_metric`, `check_definition`, `check_after` — **not optional.** The number that will judge this
  change, how it is computed, and the date it is judged. A proposal you cannot measure is not a
  proposal; leave it out of both files. `/learning approve` refuses a row whose check is empty, and
  that refusal is the point.
- `artifact` — the exact thing to look for later when counting whether it fired: a skill name, a
  prompt name, a script path. Leave empty only if the change leaves no trace to find.
- Everything else — empty. `/learning install` and `/learning close` fill those in.

## Then

Stop. List the proposals to San with the token saving on each, and say what you recommend cutting first. Do not apply any of them, and do not write to any file except the two proposals files.
