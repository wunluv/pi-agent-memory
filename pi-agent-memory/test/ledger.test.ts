/**
 * Tests for the adoption ledger (#100). Run with: node test/ledger.test.ts
 *
 * The contracts that matter: a row cannot be approved without its check, an id
 * resolves to one row forever, and the file round-trips without losing a column.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	COLUMNS,
	approveIds,
	closeRow,
	dueRows,
	emptyRow,
	installRow,
	ledgerLine,
	nextId,
	openRows,
	parseRows,
	readLedgerRows,
	renderLedger,
	todayLocal,
	validateRow,
	type LedgerRow,
} from "../ledger.ts";

function row(over: Partial<LedgerRow> = {}): LedgerRow {
	const r = emptyRow();
	Object.assign(r, {
		id: "proj-2026-11-01-01",
		opened: "2026-11-01",
		source: "memory_audit",
		class: "F2",
		finding: "Inline scripts fail on quoting",
		evidence: "STRAY-COMMANDS.tsv",
		home: "this project's AGENTS.md",
		scope: "project",
		status: "approved",
		approved_by: "san",
		check_metric: "failed_inline_script_calls",
		check_definition: "bash results with isError=true and no retry within the turn",
		check_after: "2026-12-02",
	});
	return Object.assign(r, over);
}

// ─── an approved row must already carry its check ───────────────────────────

{
	const good = row();
	assert.deepEqual(validateRow(good, []), [], "a complete row validates");

	const noMetric = validateRow(row({ check_metric: "" }), []);
	assert.equal(noMetric.length, 1);
	assert.match(noMetric[0], /check_metric is empty/);

	const noDefinition = validateRow(row({ check_definition: "" }), []);
	assert.match(noDefinition[0], /check_definition is empty/);

	const noAfter = validateRow(row({ check_after: "" }), []);
	assert.match(noAfter[0], /check_after is empty/);

	// A proposal needs no check: nothing is being claimed yet.
	assert.deepEqual(validateRow(row({ status: "proposed", check_metric: "", check_definition: "", check_after: "" }), []), []);

	// An installed row needs its date and the thing to count.
	const installed = validateRow(row({ status: "installed", installed_at: "", artifact: "" }), []);
	assert.equal(installed.length, 2, installed.join("; "));

	// A checked row needs the verdict.
	const checked = validateRow(row({ status: "checked-keep", installed_at: "2026-11-02", artifact: "x", verdict: "", verdict_date: "" }), []);
	assert.equal(checked.length, 2, checked.join("; "));
	assert.deepEqual(validateRow(row({ status: "checked-keep", installed_at: "2026-11-02", artifact: "x", verdict: "keep", verdict_date: "2026-12-04" }), []), []);
}

// ─── the file is tab-separated, one line per cell ───────────────────────────

{
	assert.match(validateRow(row({ finding: "two\tcells" }), [])[0], /finding contains a tab/);
	assert.match(validateRow(row({ finding: "two\nlines" }), [])[0], /finding spans lines/);
	assert.match(validateRow(row({ opened: "1 Nov 26" }), [])[0], /opened must be YYYY-MM-DD/);
	assert.match(validateRow(row({ status: "maybe" }), [])[0], /unknown status/);
	assert.match(validateRow(row({ scope: "global" }), [])[0], /unknown scope/);
}

// ─── an id resolves to one row, for all time ────────────────────────────────

{
	const existing = [row()];
	assert.match(validateRow(row(), existing)[0], /already in the ledger/);
	assert.equal(nextId([], "agent_memory", "2026-11-01"), "agent-memory-2026-11-01-01");
	assert.equal(nextId(existing, "proj", "2026-11-01"), "proj-2026-11-01-02");
	assert.equal(nextId([row({ id: "proj-2026-11-01-07" })], "proj", "2026-11-01"), "proj-2026-11-01-08");
	// A different day restarts the count.
	assert.equal(nextId(existing, "proj", "2026-11-02"), "proj-2026-11-02-01");
}

// ─── round trip: no column is lost, hand edits still read ───────────────────

{
	const a = row();
	const b = row({ id: "proj-2026-11-01-02", status: "rejected", check_metric: "", check_definition: "", check_after: "", finding: "Pipe | in the finding" });
	const text = renderLedger([a, b], "proj");

	assert.match(text, /^# Learning ledger — proj/);
	assert.match(text, /## Open rows/);

	const back = parseRows(text);
	assert.equal(back.length, 2);
	for (const c of COLUMNS) assert.equal(back[0][c], a[c], `column ${c} survived the round trip`);
	assert.equal(back[1].finding, "Pipe | in the finding", "a pipe in the human table does not corrupt the data");
	assert.equal(back[1].status, "rejected");

	// Only the open row appears in the human table.
	const humanTable = text.slice(0, text.indexOf("## Rows"));
	assert.ok(humanTable.includes(a.id));
	assert.ok(!humanTable.includes(b.id), "a rejected row is history, not an open item");

	// A file with a reordered header still reads by name.
	const reordered = "```tsv\n" + [COLUMNS[0], "finding", "status"].join("\t") + "\n" + ["x-1", "a finding", "proposed"].join("\t") + "\n```";
	const parsed = parseRows(reordered);
	assert.equal(parsed[0].id, "x-1");
	assert.equal(parsed[0].finding, "a finding");
	assert.equal(parsed[0].status, "proposed");

	assert.deepEqual(parseRows("no block here"), []);
}

// ─── what is open, what is due, what is quiet ───────────────────────────────

{
	const proposed = row({ id: "p-1", status: "proposed", check_metric: "", check_definition: "", check_after: "" });
	const approved = row({ id: "a-1", status: "approved" });
	const installed = row({ id: "i-1", status: "installed", installed_at: "2026-11-02", artifact: "scratch-scripts" });
	const done = row({ id: "c-1", status: "checked-keep", installed_at: "2026-11-02", artifact: "x", verdict: "keep", verdict_date: "2026-12-04" });
	const rejected = row({ id: "r-1", status: "rejected", check_metric: "", check_definition: "", check_after: "" });
	const rows = [proposed, done, installed, rejected, approved];

	assert.deepEqual(openRows(rows).map((r) => r.id), ["a-1", "i-1", "p-1"], "approved first, then installed, then proposed");

	assert.deepEqual(dueRows(rows, "2026-11-30").map((r) => r.id), [], "not due yet");
	assert.deepEqual(dueRows(rows, "2026-12-02").map((r) => r.id), ["i-1"], "due on the day named");
	assert.deepEqual(dueRows(rows, "2026-12-09").map((r) => r.id), ["i-1"], "and after it");

	assert.equal(ledgerLine([done, rejected], "2026-12-09"), null, "a quiet ledger says nothing");
	assert.match(ledgerLine(rows, "2026-12-09") ?? "", /1 approved but not installed \(a-1\)/);
	assert.match(ledgerLine(rows, "2026-12-09") ?? "", /1 check overdue \(i-1\)/);
}

// ─── moving a row: approve, install, close ─────────────────────────────────

{
	// Regression: a row the audit already wrote as `proposed` must be promoted in
	// place. The first version refused every id already in the ledger, which made
	// every backfilled row unapprovable.
	const proposed = row({ id: "p-1", status: "proposed", approved_by: "", check_metric: "", check_definition: "", check_after: "" });
	const candidate = row({ id: "p-1", status: "proposed" });

	const promoted = approveIds([proposed], [candidate], ["p-1"]);
	assert.equal(promoted.error, undefined, promoted.error);
	assert.equal(promoted.rows[0].status, "approved");
	assert.equal(promoted.rows[0].approved_by, "san");
	assert.equal(promoted.rows[0].check_metric, "failed_inline_script_calls", "the candidate supplies the check");
	assert.deepEqual(validateRow(promoted.rows[0], []), [], "and the promoted row is valid");

	// A proposal never seen before is appended.
	const appended = approveIds([], [candidate], ["p-1"]);
	assert.equal(appended.rows.length, 1);
	assert.equal(appended.rows[0].status, "approved");

	// Anything already past `proposed` is refused, by name.
	assert.match(approveIds([row({ id: "p-1", status: "installed", installed_at: "2026-11-02", artifact: "x" })], [], ["p-1"]).error ?? "", /p-1 is already installed/);
	assert.match(approveIds([], [], ["nope"]).error ?? "", /nope is not in any proposals.tsv/);
	assert.equal(approveIds([proposed], [candidate], ["p-1"]).rows[0].status, "approved", "the input rows are not mutated");

	// install and close walk the status ladder and refuse to skip it.
	const installed = installRow(promoted.rows, "p-1", { artifact: "scratch-scripts", commit: "abc1234", date: "2026-11-02" });
	assert.equal(installed.rows[0].status, "installed");
	assert.equal(installed.rows[0].installed_at, "2026-11-02");
	assert.match(installRow([proposed], "p-1", { artifact: "x", date: "2026-11-02" }).error ?? "", /is proposed, not approved/);

	const closed = closeRow(installed.rows, "p-1", { verdict: "keep", note: "4.1 to 1.2 per 100 bash calls", date: "2026-12-04" });
	assert.equal(closed.rows[0].status, "checked-keep");
	assert.equal(closed.rows[0].verdict, "4.1 to 1.2 per 100 bash calls");
	assert.equal(closed.rows[0].verdict_date, "2026-12-04");
	assert.deepEqual(validateRow(closed.rows[0], []), [], "a closed row is valid");
	assert.match(closeRow([proposed], "p-1", { verdict: "keep", date: "2026-12-04" }).error ?? "", /is proposed, not installed/);
	assert.match(closeRow([], "gone", { verdict: "keep", date: "2026-12-04" }).error ?? "", /No ledger row gone/);

	// Local dates: a 01:00 SAST session belongs to that day, not to UTC's yesterday.
	assert.equal(todayLocal(new Date("2026-11-02T23:00:00Z")), "2026-11-03", "SAST is UTC+2");
}

// ─── reading a root with no ledger ──────────────────────────────────────────

{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
	assert.deepEqual(readLedgerRows(root), [], "a project that never opened a row has an empty ledger");
	fs.mkdirSync(path.join(root, "reference"), { recursive: true });
	fs.writeFileSync(path.join(root, "reference", "ledger.md"), renderLedger([row()], "proj"));
	assert.equal(readLedgerRows(root).length, 1);
}

console.log("ledger tests passed");
