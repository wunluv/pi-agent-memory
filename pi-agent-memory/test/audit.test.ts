/**
 * Tests for audit.ts and the measurement engine — run with: node test/audit.test.ts
 * #92: the maintenance cadence (derived, no state file) and budget parity with
 * the code that actually builds the system prompt.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cp from "node:child_process";
import {
	AUDIT_DIR,
	countSessionsSince,
	dueNotice,
	gatherAuditState,
	lastAuditDate,
	projectDirFor,
	renderAuditLine,
	sessionDirName,
} from "../audit.ts";
import type { GitFn } from "../identity.ts";
import { auditFrontmatter, agentBudget, runAudit, formatSummary, cmdSignature } from "../scripts/memory-audit.mjs";
import { budgetSystemInjection, rankSystemFiles, type SystemFileEntry } from "../context-budget.ts";

const git: GitFn = (args, cwd) => {
	const r = cp.spawnSync("git", args, { cwd, encoding: "utf-8" });
	return { stdout: r.stdout || "", stderr: r.stderr || "", code: r.status ?? 1 };
};

function tmp(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), `audit-${prefix}-`));
}

function gitInit(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
	git(["init"], dir);
	git(["config", "user.email", "t@pi.local"], dir);
	git(["config", "user.name", "Tester"], dir);
}

function commit(dir: string, message: string, dateIso?: string): void {
	git(["add", "-A"], dir);
	if (dateIso) {
		const r = cp.spawnSync(
			"git",
			["commit", "-m", message, "--date", `${dateIso}T12:00:00Z`],
			{ cwd: dir, encoding: "utf-8", env: { ...process.env, GIT_COMMITTER_DATE: `${dateIso}T12:00:00Z` } },
		);
		assert.equal(r.status, 0, r.stderr);
		return;
	}
	git(["commit", "-m", message], dir);
}

/** A sessions root with two project dirs and dated files. */
function makeSessions(): { root: string } {
	const root = tmp("sessions");
	addSessions(root, "/tmp/proj/alpha", ["2026-09-01", "2026-10-01", "2026-10-02"]);
	addSessions(root, "/tmp/proj/beta", ["2026-10-03"]);
	return { root };
}

/** Write dated session files for one cwd. */
function addSessions(root: string, cwd: string, dates: string[]): void {
	const dir = path.join(root, sessionDirName(cwd));
	fs.mkdirSync(dir, { recursive: true });
	for (const d of dates) fs.writeFileSync(path.join(dir, `${d}T10-00-00-000Z_x.jsonl`), "{}\n");
}

// ─── naming ─────────────────────────────────────────────────────────────────

assert.equal(sessionDirName("/home/wunluv/DEV/pi"), "--home-wunluv-DEV-pi--");
assert.equal(sessionDirName("/home/wunluv/DEV/Heaven/d5"), "--home-wunluv-DEV-Heaven-d5--");
assert.equal(projectDirFor("/tmp/proj/.memory"), "/tmp/proj");
assert.equal(projectDirFor("/home/wunluv/.pi/agents/pialph/memory"), null, "agent roots have no project dir");

// ─── counting ───────────────────────────────────────────────────────────────

{
	const s = makeSessions();
	assert.equal(countSessionsSince(s.root, null, null), 4, "all sessions when no project and no date");
	assert.equal(countSessionsSince(s.root, "/tmp/proj/alpha", null), 3, "only the matching project dir");
	assert.equal(countSessionsSince(s.root, "/tmp/proj/alpha", "2026-09-15"), 2, "dated after the boundary");
	assert.equal(countSessionsSince(s.root, "/tmp/proj/alpha", "2026-12-31"), 0, "nothing after a future date");
	assert.equal(countSessionsSince(path.join(s.root, "missing"), null, null), 0, "missing sessions root is zero, not a throw");
}

// ─── last audit, from git ───────────────────────────────────────────────────

{
	const root = tmp("root");
	gitInit(root);
	fs.writeFileSync(path.join(root, "README.md"), "x\n");
	commit(root, "init", "2026-09-10");

	assert.equal(lastAuditDate(git, root), null, "no audit commit yet");

	fs.mkdirSync(path.join(root, AUDIT_DIR), { recursive: true });
	fs.writeFileSync(path.join(root, AUDIT_DIR, "proposals.md"), "# p\n");
	commit(root, "audit proposals", "2026-09-21");

	assert.equal(lastAuditDate(git, root), "2026-09-21", "date of the commit that touched the audit dir");

	// A later commit elsewhere must not move the audit date.
	fs.writeFileSync(path.join(root, "README.md"), "y\n");
	commit(root, "unrelated", "2026-10-01");
	assert.equal(lastAuditDate(git, root), "2026-09-21", "unrelated commits do not count as an audit");
}

// ─── cadence ────────────────────────────────────────────────────────────────

{
	const s = makeSessions();
	const root = tmp("projroot");
	gitInit(root);
	fs.writeFileSync(path.join(root, "README.md"), "x\n");
	commit(root, "init", "2026-09-10");

	// Never audited → always due.
	const never = gatherAuditState({ git, root, sessionsRoot: s.root, today: "2026-10-19" });
	assert.equal(never.last, null);
	assert.equal(never.due, true);
	assert.match(never.reason, /no audit/);
	assert.match(renderAuditLine(never), /DUE/);
	assert.ok(dueNotice(never), "a due state produces a notice");

	// Audited 2026-10-19: the project's own sessions are only those under the
	// project dir. This root's cwd is the tmp dir, which has no sessions → 0.
	fs.mkdirSync(path.join(root, AUDIT_DIR), { recursive: true });
	fs.writeFileSync(path.join(root, AUDIT_DIR, "proposals.md"), "# p\n");
	commit(root, "audit", "2026-10-19");

	const fresh = gatherAuditState({ git, root, sessionsRoot: s.root, today: "2026-10-19" });
	assert.equal(fresh.last, "2026-10-19");
	assert.equal(fresh.sessionsSince, 0);
	assert.equal(fresh.due, false);
	assert.equal(dueNotice(fresh), null, "not due → no notice in the system prompt");
	assert.match(renderAuditLine(fresh), /ok/);

	// Days threshold, with a threshold overridden so the test does not age.
	const aged = gatherAuditState({ git, root, sessionsRoot: s.root, today: "2026-11-30", dueDays: 30, dueSessions: 99 });
	assert.equal(aged.due, true);
	assert.match(aged.reason, /days since/);

	// Sessions threshold, project-scoped counting. The memory root is its own
	// repo, so the audit commit lives in <project>/.memory — as it does in life.
	const alpha = tmp("alpha");
	const mem = path.join(alpha, ".memory");
	gitInit(mem);
	fs.mkdirSync(path.join(mem, AUDIT_DIR), { recursive: true });
	fs.writeFileSync(path.join(mem, AUDIT_DIR, "proposals.md"), "# p\n");
	commit(mem, "audit", "2026-09-15");
	addSessions(s.root, alpha, ["2026-10-01", "2026-10-02"]);
	// alpha's sessions after 2026-09-15: two.
	const two = gatherAuditState({ git, root: mem, sessionsRoot: s.root, today: "2026-10-19", dueSessions: 3, dueDays: 999 });
	assert.equal(two.last, "2026-09-15");
	assert.equal(two.sessionsSince, 2, "counts only this project's sessions");
	assert.equal(two.due, false);

	const one = gatherAuditState({ git, root: mem, sessionsRoot: s.root, today: "2026-10-19", dueSessions: 2, dueDays: 999 });
	assert.equal(one.due, true, "crossing the session threshold is due");
	assert.match(one.reason, /2 sessions since 2026-09-15/);
}

// ─── signature normalisation ────────────────────────────────────────────────

assert.equal(cmdSignature("cd ~/DEV/x && git status --short"), "git status --short");
assert.equal(cmdSignature("cd /tmp && ls -la /tmp/foo 2>/dev/null"), "ls -la P");
assert.equal(cmdSignature("echo 'hello world' > /tmp/a.md"), "echo Q >");
assert.equal(cmdSignature("sudo systemctl restart 42mail"), "systemctl restart 42mail", "leading sudo dropped");
assert.equal(cmdSignature("kill -9 12345"), "kill -N N", "standalone numbers collapse");
assert.equal(cmdSignature("ssh mojah2 'git --git-dir=/x log'"), "ssh mojah2 Q");

// ─── budget parity ──────────────────────────────────────────────────────────
// The report must agree with the code that builds the real prompt, or the
// numbers justify cuts the prompt never made.

{
	const sys = tmp("system");
	const files: Array<[string, number, number]> = [
		// relPath, importance, body length
		["human/identity.md", 5, 1200],
		["persona.md", 3, 3000],
		["projects.md", 5, 2000],
		["human/prefs/communication.md", 5, 3400],
		["human/prefs/workflow.md", 5, 1500],
		["infrastructure.md", 5, 4000],
		["notes/extra.md", 2, 900],
	];
	for (const [rel, importance, len] of files) {
		const abs = path.join(sys, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, `---\ndescription: t\nimportance: ${importance}\nupdated: 2026-01-01\n---\n${"x".repeat(len)}`);
	}

	const auditSide = agentBudget(sys, 2400);
	assert.ok(auditSide);

	const entries: SystemFileEntry[] = files.map(([rel]) => {
		const { body, importance, updated } = auditFrontmatter(fs.readFileSync(path.join(sys, rel), "utf8"));
		return { relPath: rel, content: body.trim(), importance, updated };
	});
	const promptSide = budgetSystemInjection(rankSystemFiles(entries), 2400);

	assert.deepEqual(
		auditSide.omitted.map((o) => o.rel).sort(),
		promptSide.omitted.map((o) => o.relPath).sort(),
		"the audit and the prompt evict the same files",
	);
	assert.equal(auditSide.pinnedTokens, promptSide.pinnedTokens, "pinned spine cost agrees");
	assert.equal(auditSide.used, promptSide.usedTokens, "budgeted pool cost agrees");
	assert.ok(auditSide.omitted.length > 0, "fixture must actually overflow the budget");
}

// ─── runAudit shape ─────────────────────────────────────────────────────────

{
	const s = makeSessions();
	const a = runAudit({ sessionsRoot: s.root, agentsDir: path.join(s.root, "no-agents"), minSessions: 1 });
	assert.ok(a);
	assert.equal(a.totals.sessions, 4);
	assert.equal(a.totals.measured, 0, "synthetic files carry no usage");
	assert.deepEqual(a.budgets, [], "no agents dir → no Zone A rows, no throw");
	assert.equal(a.reads.length, 0);
	assert.equal(runAudit({ sessionsRoot: path.join(s.root, "missing") }), null);
}

// ─── project scoping: the local report answers a local question ────────────

{
	const s = makeSessions();
	addSessions(s.root, "/tmp/proj/alpha/sub", ["2026-10-04"]); // a session started below the project
	addSessions(s.root, "/tmp/other", ["2026-10-05"]);
	// give alpha real first-turn usage, so cold start and the trend have numbers
	const usageLine = (n: number) =>
		JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: n }, content: [] } }) + "\n";
	fs.writeFileSync(path.join(s.root, sessionDirName("/tmp/proj/alpha"), "2026-09-20T10-00-00-000Z_u.jsonl"), usageLine(7000));
	fs.writeFileSync(path.join(s.root, sessionDirName("/tmp/proj/alpha"), "2026-10-06T10-00-00-000Z_u.jsonl"), usageLine(9000));
	fs.writeFileSync(path.join(s.root, sessionDirName("/tmp/other"), "2026-10-07T10-00-00-000Z_u.jsonl"), usageLine(3000));

	const local = runAudit({ sessionsRoot: s.root, agentsDir: path.join(s.root, "no-agents"), minSessions: 1, project: "/tmp/proj/alpha" });
	assert.ok(local);
	assert.equal(local.scope.project, "/tmp/proj/alpha");
	assert.equal(local.totals.sessions, 6, "the project's own dirs, including one nested below it");
	assert.equal(local.totals.mean, 8000, "only this project's usage");
	assert.equal(local.cost.length, 1, "only this project appears in the cost table");
	assert.equal(local.scope.portfolio, undefined, "a local run does not scan the portfolio (#100)");

	const text = formatSummary(local);
	assert.ok(text.includes("Cold start (this project)"), text);
	assert.ok(!text.includes("Portfolio for comparison"), "no portfolio figure leaks into a local report");
	assert.ok(!text.includes("/memory:audit-global"), "and no pointer to the wide run");
	assert.ok(text.includes("Trend (this project)"), text);
	assert.ok(!text.includes("Heaviest projects"), "a one-project report has no ranking to show");

	// A portfolio run stays as it was: no scope words, and it ranks projects.
	const global = runAudit({ sessionsRoot: s.root, agentsDir: path.join(s.root, "no-agents"), minSessions: 1 });
	assert.equal(global.scope.project, null);
	assert.equal(global.totals.sessions, 9);
	const globalText = formatSummary(global);
	assert.ok(globalText.includes("Cold start (all sessions)"), globalText);
	assert.ok(!globalText.includes("Portfolio for comparison"));
	assert.ok(globalText.includes("Heaviest projects"), globalText);
}

// scoped "never fetched" says what it means: not fetched HERE, not dead
{
	const s = makeSessions();
	const agentsDir = path.join(s.root, "agents");
	const sys = path.join(agentsDir, "a1", "memory", "system");
	fs.mkdirSync(sys, { recursive: true });
	fs.writeFileSync(path.join(sys, "persona.md"), "---\nimportance: 5\n---\n" + "x".repeat(400));

	// Beta's session reads the agent file; alpha's does not.
	const betaDir = path.join(s.root, sessionDirName("/tmp/proj/beta"));
	fs.writeFileSync(
		path.join(betaDir, "2026-10-03T10-00-00-000Z_y.jsonl"),
		JSON.stringify({
			type: "message",
			message: {
				role: "assistant",
				usage: { input: 5000 },
				content: [{ type: "toolCall", id: "c1", name: "memory_read", arguments: { path: "persona.md", root: sys } }],
			},
		}) + "\n",
	);

	const scoped = runAudit({ sessionsRoot: s.root, agentsDir, minSessions: 99, project: "/tmp/proj/alpha" });
	assert.equal(scoped.dead.length, 1, "alpha never read it, so it looks dead here");
	assert.ok(
		formatSummary(scoped).includes("by this project's sessions"),
		"the claim is scoped in words, because dead is an argument for deletion",
	);

	const global = runAudit({ sessionsRoot: s.root, agentsDir, minSessions: 99 });
	assert.equal(global.dead.length, 0, "portfolio-wide, beta's read counts");
	assert.ok(!formatSummary(global).includes("by this project's sessions"));
}

// ─── #100: the ledger is the clock, once a project has one ─────────────────

{
	const s = makeSessions();
	const alpha = tmp("ledgerclock");
	const mem = path.join(alpha, ".memory");
	gitInit(mem);
	fs.writeFileSync(path.join(mem, "README.md"), "x\n");
	commit(mem, "init", "2026-09-01");

	// A friction endwork touches project_insights/audit. Before the ledger, that
	// commit reset the memory audit clock (observed on d5).
	fs.mkdirSync(path.join(mem, "project_insights", "audit"), { recursive: true });
	fs.writeFileSync(path.join(mem, "project_insights", "audit", "INDEX.tsv"), "a\tb\n");
	commit(mem, "friction endwork", "2026-10-20");

	const noLedger = gatherAuditState({ git, root: mem, sessionsRoot: s.root, today: "2026-10-21" });
	assert.equal(noLedger.clock, "audit", "with no ledger the audit directory still stands in");
	assert.equal(noLedger.overdue.length, 0);

	// Now a ledger with a check that has come due.
	const installed = {
		id: "alpha-2026-10-01-01",
		opened: "2026-10-01",
		source: "memory_audit",
		class: "F2",
		finding: "Inline scripts fail on quoting",
		evidence: "STRAY-COMMANDS.tsv",
		home: "AGENTS.md",
		scope: "project",
		artifact: "scratch-scripts",
		status: "installed",
		approved_by: "san",
		installed_at: "2026-10-02",
		commit: "abc1234",
		check_metric: "failed_inline_script_calls",
		check_definition: "bash results with isError=true",
		check_after: "2026-11-01",
		verdict: "",
		verdict_date: "",
	};
	fs.mkdirSync(path.join(mem, "reference"), { recursive: true });
	fs.writeFileSync(
		path.join(mem, "reference", "ledger.md"),
		"```tsv\n" + Object.keys(installed).join("\t") + "\n" + Object.values(installed).join("\t") + "\n```\n",
	);
	commit(mem, "learning: approve alpha-2026-10-01-01", "2026-10-25");

	const clocked = gatherAuditState({ git, root: mem, sessionsRoot: s.root, today: "2026-10-26" });
	assert.equal(clocked.clock, "ledger");
	assert.equal(clocked.last, "2026-10-25", "the ledger's commit date wins over the friction commit");
	assert.deepEqual(clocked.overdue, [], "not due yet");
	assert.equal(clocked.due, false, "a fresh ledger that is not overdue is not due");

	const late = gatherAuditState({ git, root: mem, sessionsRoot: s.root, today: "2026-11-05" });
	assert.equal(late.due, true);
	assert.match(late.reason, /1 check overdue \(alpha-2026-10-01-01\)/);
	assert.match(renderAuditLine(late), /DUE/);
	assert.match(dueNotice(late) ?? "", /pre-registered/);
}

console.log("audit tests passed");
