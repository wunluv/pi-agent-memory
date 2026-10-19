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
import { auditFrontmatter, agentBudget, runAudit, cmdSignature } from "../scripts/memory-audit.mjs";
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

console.log("audit tests passed");
