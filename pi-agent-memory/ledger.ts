/**
 * #100: the adoption ledger — the record of which finding became which change,
 * and whether it fired.
 *
 * Two systems already exist. `memory_audit` measures what memory costs and
 * proposes pruning; the friction loop analyses sessions and proposes fixes.
 * Neither records what happened to a proposal. So a declined proposal cost
 * nothing and came back verbatim four days later (2026-10-19 → 2026-10-23), an
 * installed fix could not be enumerated for removal, and verification never ran:
 * four audits, one baseline, zero checks.
 *
 * The ledger is one append-only file per project. A row is opened when a finding
 * is approved, extended when it is installed, and closed with a verdict when it
 * is checked. Rows are never rewritten, so the history survives.
 *
 * **The file is written by a command, never by hand.** The failure above was a
 * compensating control that nothing enforced. `/learning:approve` refuses an
 * `approved` row whose check is not already written down, which is the whole
 * difference between verification and a story told afterwards.
 *
 * Shape: a short table at the top that a human reads, and a fenced TSV block
 * below that the tools parse. Nineteen columns in a markdown table are
 * unreadable; a TSV block alone is opaque. The top is regenerated, the bottom
 * is append-only.
 *
 * Node built-ins only.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Where the ledger lives, relative to a project memory root. */
export const LEDGER_PATH = "reference/ledger.md";

/** Column order. The TSV block's header row is derived from this. */
export const COLUMNS = [
	"id",
	"opened",
	"source",
	"class",
	"finding",
	"evidence",
	"home",
	"scope",
	"artifact",
	"status",
	"approved_by",
	"installed_at",
	"commit",
	"check_metric",
	"check_definition",
	"check_after",
	"verdict",
	"verdict_date",
] as const;

export type Column = (typeof COLUMNS)[number];

/** One row. Every cell is a string; the file is the schema. */
export type LedgerRow = Record<Column, string>;

/**
 * `proposed` is written by an audit. `approved` means San named the id and the
 * check is pre-registered. `installed` means the change is in the tree.
 * `checked-*` and `rejected`/`superseded` are terminal.
 */
export const STATUSES = [
	"proposed",
	"approved",
	"installed",
	"checked-keep",
	"checked-rewrite",
	"checked-delete",
	"rejected",
	"superseded",
] as const;

export type Status = (typeof STATUSES)[number];

/**
 * Local first, by policy. A fix promoted from one project carries that
 * project's vocabulary and its always-loaded cost into every other project.
 * Anything above `project` needs a global audit naming the pattern in two or
 * more projects.
 */
export const SCOPES = ["project", "shared-skill", "commons", "identity"] as const;

export type Scope = (typeof SCOPES)[number];

/** Rows that still need something to happen. */
export const OPEN_STATUSES: Status[] = ["proposed", "approved", "installed"];

/** Statuses that cannot move again. */
export const TERMINAL_STATUSES: Status[] = [
	"checked-keep",
	"checked-rewrite",
	"checked-delete",
	"rejected",
	"superseded",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEADER_PREFIX = "# Learning ledger";
const ROWS_HEADING = "## Rows";
const OPEN_HEADING = "## Open rows";

export function emptyRow(): LedgerRow {
	const row = {} as LedgerRow;
	for (const c of COLUMNS) row[c] = "";
	return row;
}

function isStatus(s: string): s is Status {
	return (STATUSES as readonly string[]).includes(s);
}

function isScope(s: string): s is Scope {
	return (SCOPES as readonly string[]).includes(s);
}

export function isTerminal(status: string): boolean {
	return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Rows the loop still owes something on, in the order a reader needs them. */
export function openRows(rows: LedgerRow[]): LedgerRow[] {
	const rank = (s: string) => (s === "approved" ? 0 : s === "installed" ? 1 : 2);
	return rows.filter((r) => OPEN_STATUSES.includes(r.status as Status)).sort((a, b) => rank(a.status) - rank(b.status) || a.id.localeCompare(b.id));
}

/** Installed rows whose pre-registered check date has arrived (#100 stage 6). */
export function dueRows(rows: LedgerRow[], today: string): LedgerRow[] {
	return rows
		.filter((r) => r.status === "installed")
		.filter((r) => DATE_RE.test(r.check_after) && r.check_after <= today)
		.sort((a, b) => a.check_after.localeCompare(b.check_after));
}

/**
 * Everything wrong with a row, in words. Empty means the row may be appended.
 *
 * `existing` is every id already in the ledger; a duplicate is rejected because
 * append-only means an id resolves to exactly one row for all time.
 */
export function validateRow(row: LedgerRow, existing: LedgerRow[] = []): string[] {
	const errors: string[] = [];
	const need = (c: Column, why: string) => {
		if (!String(row[c] ?? "").trim()) errors.push(`${c} is empty (${why})`);
	};

	need("id", "every row resolves to exactly one id, forever");
	need("opened", "when the finding arrived");
	need("source", "which audit or observation produced it");
	need("finding", "one line saying what is wrong");
	need("home", "where the change lands");
	need("scope", "project by default");
	need("status", "proposed, approved or installed");

	if (row.opened && !DATE_RE.test(row.opened)) errors.push(`opened must be YYYY-MM-DD, got "${row.opened}"`);
	if (row.status && !isStatus(row.status)) errors.push(`unknown status "${row.status}"`);
	if (row.scope && !isScope(row.scope)) errors.push(`unknown scope "${row.scope}" (${SCOPES.join(", ")})`);
	if (existing.some((r) => r.id === row.id)) errors.push(`id "${row.id}" is already in the ledger`);

	for (const c of COLUMNS) {
		const v = String(row[c] ?? "");
		if (v.includes("\t")) errors.push(`${c} contains a tab; the file is tab-separated`);
		if (v.includes("\n")) errors.push(`${c} spans lines; every cell is one line`);
	}

	// The rule the whole loop turns on: no check, no approval.
	if (row.status && isStatus(row.status) && !["proposed", "rejected", "superseded"].includes(row.status)) {
		need("check_metric", "a verdict needs a number, named before the change");
		need("check_definition", "so the number means the same thing at check time");
		need("check_after", "when the check is due");
		if (row.check_after && !DATE_RE.test(row.check_after)) errors.push(`check_after must be YYYY-MM-DD, got "${row.check_after}"`);
	}

	if (row.status === "installed" || row.status.startsWith("checked-")) {
		need("installed_at", "an installed row says when");
		need("artifact", "the thing to look for when counting whether it fired");
	}

	if (row.status.startsWith("checked-")) {
		need("verdict", "keep, rewrite or delete, in words");
		need("verdict_date", "when the verdict was reached");
		if (row.verdict_date && !DATE_RE.test(row.verdict_date)) errors.push(`verdict_date must be YYYY-MM-DD, got "${row.verdict_date}"`);
	}

	return errors;
}

/** `d5-2026-11-01-01`, incrementing within a project and day. */
export function nextId(rows: LedgerRow[], project: string, date: string): string {
	const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
	const prefix = `${slug}-${date}-`;
	let max = 0;
	for (const r of rows) {
		if (!r.id.startsWith(prefix)) continue;
		const n = Number(r.id.slice(prefix.length));
		if (Number.isFinite(n) && n > max) max = n;
	}
	return prefix + String(max + 1).padStart(2, "0");
}

/** Split a fenced TSV block into rows. Missing or ragged cells become "". */
export function parseRows(text: string): LedgerRow[] {
	const fence = /```tsv\r?\n([\s\S]*?)```/.exec(text);
	if (!fence) return [];
	const lines = fence[1].split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim().length > 0);
	if (lines.length < 2) return [];

	const header = lines[0].split("\t").map((h) => h.trim());
	const index = new Map<string, number>();
	header.forEach((h, i) => index.set(h, i));

	// A named column is read by name, so a reordered or extended header still
	// reads. A column the header omits falls back to its position, which is the
	// best guess available for a hand-edited file.
	const rows: LedgerRow[] = [];
	for (const line of lines.slice(1)) {
		const cells = line.split("\t");
		const row = emptyRow();
		COLUMNS.forEach((c, i) => {
			const at = index.has(c) ? index.get(c)! : i;
			row[c] = (cells[at] ?? "").trim();
		});
		if (row.id || row.finding) rows.push(row);
	}
	return rows;
}

function truncate(s: string, n: number): string {
	const flat = s.replace(/\r?\n/g, " ").trim();
	return flat.length > n ? flat.slice(0, n - 1).trimEnd() + "…" : flat;
}

function cell(s: string): string {
	return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/**
 * Render the whole file: the human table on top, the machine block below.
 *
 * Regenerating rather than appending to the top keeps the summary true when a
 * row moves; the TSV block is the append-only part.
 */
export function renderLedger(rows: LedgerRow[], project: string): string {
	const open = openRows(rows);
	const awaitingInstall = open.filter((r) => r.status === "approved").length;
	const awaitingCheck = open.filter((r) => r.status === "installed").length;

	const lines: string[] = [];
	lines.push(`${HEADER_PREFIX} — ${project}`);
	lines.push("");
	lines.push(
		"Append-only. A row is opened when a finding is approved, extended when it is installed, and closed",
	);
	lines.push("with a verdict when it is checked. Rows are never rewritten. Written by `/learning:approve` and");
	lines.push("`/learning:close`; do not hand-edit the block below.");
	lines.push("");
	lines.push(OPEN_HEADING);
	lines.push("");
	if (!open.length) {
		lines.push("Nothing open. A finding is opened here when an audit proposes it and San approves it.");
	} else {
		lines.push(
			`${open.length} open: ${awaitingInstall} awaiting install, ${awaitingCheck} awaiting a check.`,
		);
		lines.push("");
		lines.push("| id | finding | status | check due |");
		lines.push("|---|---|---|---|");
		for (const r of open) lines.push(`| ${cell(r.id)} | ${cell(truncate(r.finding, 70))} | ${cell(r.status)} | ${cell(r.check_after || "—")} |`);
	}
	lines.push("");
	lines.push(ROWS_HEADING);
	lines.push("");
	lines.push("```tsv");
	lines.push(COLUMNS.join("\t"));
	for (const r of rows) lines.push(COLUMNS.map((c) => (r[c] ?? "").trim()).join("\t"));
	lines.push("```");
	lines.push("");
	return lines.join("\n");
}

/** Read the ledger's rows for a memory root. Missing file is an empty ledger. */
export function readLedgerRows(root: string): LedgerRow[] {
	try {
		return parseRows(fs.readFileSync(path.join(root, LEDGER_PATH), "utf8"));
	} catch {
		return [];
	}
}

/** Path of the ledger for a memory root. */
export function ledgerFile(root: string): string {
	return path.join(root, LEDGER_PATH);
}

/**
 * One line for `/endwork` and `memory_status`. Null when there is nothing to
 * report, so a quiet ledger stays quiet.
 *
 * opts.today  YYYY-MM-DD (injectable for tests)
 */
export function ledgerLine(rows: LedgerRow[], today: string): string | null {
	const approved = rows.filter((r) => r.status === "approved");
	const due = dueRows(rows, today);
	if (!approved.length && !due.length) return null;
	const parts: string[] = [];
	if (approved.length) parts.push(`${approved.length} approved but not installed (${approved.map((r) => r.id).join(", ")})`);
	if (due.length) parts.push(`${due.length} check${due.length === 1 ? "" : "s"} overdue (${due.map((r) => r.id).join(", ")})`);
	return `Ledger: ${parts.join("; ")}. Run /learning:approve or /learning:close`;
}
