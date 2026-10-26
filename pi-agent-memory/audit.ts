/**
 * #92: the maintenance cadence.
 *
 * The loop's stages (measure → propose → apply → check) only run when something
 * asks them to. Nothing did: the first measurement on 2026-10-19 found one audit
 * in a month, on one of twenty projects, and a cold start that had quadrupled
 * since April with no one watching.
 *
 * So the trigger lives in two places, both cheap:
 *   - a one-line notice in the system prompt when an audit is due
 *   - the same line in `memory_status`, on demand
 *
 * **No new state file.** "When was the last audit" is derived from git (the last
 * commit touching `project_insights/audit`), and "how many sessions since" is
 * counted from session file names, which start with an ISO date. Nothing to keep
 * in sync, nothing to go stale, and it works on a fresh clone.
 *
 * Node built-ins only.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { GitFn } from "./identity.ts";
import { LEDGER_PATH, dueRows, readLedgerRows } from "./ledger.ts";

/** Where audit artifacts live, relative to the memory root, for project roots. */
export const AUDIT_DIR = "project_insights/audit";

/** Due when either threshold is crossed, whichever comes first. */
export const DUE_SESSIONS = Number(process.env.PI_MEMORY_AUDIT_SESSIONS || 20);
export const DUE_DAYS = Number(process.env.PI_MEMORY_AUDIT_DAYS || 30);

export interface AuditState {
	root: string;
	/** Date (YYYY-MM-DD) of the last commit that touched the audit dir, or the ledger. */
	last: string | null;
	daysSince: number | null;
	sessionsSince: number;
	due: boolean;
	/** Plain-language reason, empty when not due. */
	reason: string;
	/**
	 * #100: which clock `last` came from. The ledger is authoritative once a
	 * project has one; the audit directory is the fallback for a project that has
	 * not opened a row yet. They are not interchangeable: the friction loop writes
	 * into `project_insights/audit`, so keying the memory clock on that directory
	 * let a friction `endwork` reset it (d5 reported "last audit 2026-09-22", a
	 * friction commit).
	 */
	clock: "ledger" | "audit";
	/** Ids whose pre-registered check date has arrived (#100 stage 6). */
	overdue: string[];
	/** Ids approved but not yet installed: nothing is in the tree for them. */
	awaitingInstall: string[];
}

/**
 * `--home-wunluv-DEV-Heaven-d5--` for a cwd. Kept in step with
 * `sessionDirFor` in scripts/memory-audit.mjs, which uses it for the same
 * purpose. If pi ever changes the session-dir convention, both move together.
 */
export function sessionDirName(cwd: string): string {
	return "--" + cwd.replace(/^\/|\/$/g, "").replace(/\//g, "-") + "--";
}

/** The project directory a memory root belongs to, or null for agent/org roots. */
export function projectDirFor(root: string): string | null {
	return path.basename(root) === ".memory" ? path.dirname(root) : null;
}

/** Date of the last commit touching the audit dir, or null if never. */
export function lastAuditDate(git: GitFn, root: string): string | null {
	return lastCommitDate(git, root, AUDIT_DIR);
}

/** Date of the last commit touching `relPath`, or null if never. */
export function lastCommitDate(git: GitFn, root: string, relPath: string): string | null {
	const r = git(["log", "-1", "--format=%cs", "--", relPath], root);
	if (r.code !== 0) return null;
	const date = (r.stdout || "").trim().split("\n")[0] || "";
	return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** Count session files dated after `since` under one session dir (or all). */
export function countSessionsSince(sessionsRoot: string, cwd: string | null, since: string | null): number {
	let dirs: string[] = [];
	try {
		dirs = fs
			.readdirSync(sessionsRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return 0;
	}
	if (cwd) {
		const one = sessionDirName(cwd);
		dirs = dirs.filter((d) => d === one);
	}
	let n = 0;
	for (const d of dirs) {
		let files: string[] = [];
		try {
			files = fs.readdirSync(path.join(sessionsRoot, d));
		} catch {
			continue;
		}
		for (const f of files) {
			if (!f.endsWith(".jsonl")) continue;
			const date = f.slice(0, 10);
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
			if (!since || date > since) n++;
		}
	}
	return n;
}

function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b)) return 0;
	return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Gather the cadence state for a memory root.
 *
 * opts.today  YYYY-MM-DD, injectable for tests (default: real today)
 * opts.dueSessions / opts.dueDays  override the thresholds (tests, experiments)
 */
export function gatherAuditState(opts: {
	git: GitFn;
	root: string;
	sessionsRoot: string;
	today?: string;
	dueSessions?: number;
	dueDays?: number;
}): AuditState {
	const root = opts.root;
	const today = opts.today || new Date().toISOString().slice(0, 10);

	// The ledger is the clock once a project has one (#100). Until then, the audit
	// directory stands in, so a project that never opened a row still gets nudged.
	const ledgerLast = lastCommitDate(opts.git, root, LEDGER_PATH);
	const clock: "ledger" | "audit" = ledgerLast ? "ledger" : "audit";
	const last = ledgerLast ?? lastAuditDate(opts.git, root);
	const ledgerRows = readLedgerRows(root);
	const overdue = dueRows(ledgerRows, today).map((r) => r.id);
	const awaitingInstall = ledgerRows.filter((r) => r.status === "approved").map((r) => r.id);

	const cwd = projectDirFor(root);
	const since = countSessionsSince(opts.sessionsRoot, cwd, last);
	const days = last ? daysBetween(last, today) : null;

	const dueSessions = opts.dueSessions ?? DUE_SESSIONS;
	const dueDays = opts.dueDays ?? DUE_DAYS;

	let due = false;
	let reason = "";
	if (overdue.length) {
		// A pre-registered check that has come due is the strongest signal there is:
		// someone already agreed the change would be measured by now.
		due = true;
		reason = `${overdue.length} check${overdue.length === 1 ? "" : "s"} overdue (${overdue.join(", ")})`;
	} else if (!last) {
		due = true;
		reason = "no audit recorded";
	} else if (since >= dueSessions) {
		due = true;
		reason = `${since} sessions since ${last}`;
	} else if (days !== null && days >= dueDays) {
		due = true;
		reason = `${days} days since ${last}`;
	}

	return { root, last, daysSince: days, sessionsSince: since, due, reason, clock, overdue, awaitingInstall };
}

/** One line for `memory_status`. Never empty: silence is what failed before. */
export function renderAuditLine(state: AuditState): string {
	const when = state.last ? `last audit ${state.last} (${state.daysSince}d ago)` : "never audited";
	const from = state.clock === "ledger" ? ", clocked on the ledger" : "";
	const waiting = state.awaitingInstall.length
		? ` ${state.awaitingInstall.length} approved but not installed (${state.awaitingInstall.join(", ")}).`
		: "";
	if (state.due) return `Audit: DUE — ${state.reason}; ${when}${from}. Run /memory:audit or /learning list${waiting}`;
	return `Audit: ok — ${state.sessionsSince} sessions since the last one (${when}${from}); due at ${DUE_SESSIONS} sessions or ${DUE_DAYS} days.${waiting}`;
}

/** The notice injected into the system prompt when due. One line, ~20 tokens. */
export function dueNotice(state: AuditState): string | null {
	if (!state.due) return null;
	const ledger = state.overdue.length
		? `Close the loop with /learning: the check you pre-registered has come due.`
		: `The loop: /memory:audit writes proposals, /learning approve opens the ones San names, /learning close records the verdict.`;
	return (
		`**Memory audit due** — ${state.reason}. ` +
		`${ledger} ` +
		`Mention it once if the session has room; do not derail the task.`
	);
}
