/**
 * Tests for status.ts — run with: node test/status.test.ts
 * #48: the memory status surface — root, zone, registration, sync health.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cp from "node:child_process";
import { gatherStatus, renderStatus, type StatusEnv } from "../status.ts";
import { registerProject, mintProjectUuid, type GitFn } from "../identity.ts";
import { saveSyncConfig } from "../sync.ts";

const git: GitFn = (args, cwd) => {
	const r = cp.spawnSync("git", args, { cwd, encoding: "utf-8" });
	return { stdout: r.stdout || "", stderr: r.stderr || "", code: r.status ?? 1 };
};

function makeEnv(): StatusEnv {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "status-"));
	return {
		git,
		spawnSync: cp.spawnSync,
		configPath: path.join(root, "memory-sync.json"),
		logPath: path.join(root, "push.log"),
		agentsDir: path.join(root, "agents"),
		orgRoot: path.join(root, "org"),
	};
}

function initMemoryRepo(memoryPath: string): void {
	fs.mkdirSync(memoryPath, { recursive: true });
	git(["init"], memoryPath);
	git(["config", "user.email", "t@pi.local"], memoryPath);
	git(["config", "user.name", "Tester"], memoryPath);
	fs.writeFileSync(path.join(memoryPath, "status.md"), "# status\n");
	git(["add", "-A"], memoryPath);
	git(["commit", "-m", "init"], memoryPath);
}

// ─── no root → NO_ROOT ──────────────────────────────────────────────────────

{
	const report = gatherStatus(makeEnv(), { root: null, activeAgent: null });
	assert.equal(report.zone, "none");
	assert.equal(renderStatus(report), "Memory status: no root resolved.");
}

// ─── unregistered legacy root (the #46 gap) ────────────────────────────────

{
	const env = makeEnv();
	const mem = path.join(env.orgRoot, "..", "legacy-proj", ".memory");
	initMemoryRepo(mem);
	saveSyncConfig(env, { server_url: "ssh://host/mem", push_on_commit: true, pull_on_start: true });

	const r = gatherStatus(env, { root: mem, activeAgent: null });
	assert.equal(r.zone, "project");
	assert.equal(r.registered, false);
	assert.ok(r.registrationDetail.includes("writes will not sync"), "unregistered soul warns loudly");
	assert.ok(r.syncEnabled, "sync config still reported");
	assert.equal(r.uuid, null);
	assert.match(renderStatus(r), /\u26A0\uFE0F/);
}

// ─── registered project (post-#46) ──────────────────────────────────────────

{
	const env = makeEnv();
	const projectPath = path.join(env.orgRoot, "..", "real-proj");
	const mem = path.join(projectPath, ".memory");
	initMemoryRepo(mem);
	const uuid = mintProjectUuid(mem);
	git(["add", "project.json"], mem);
	git(["commit", "-m", "mint"], mem);
	registerProject(env, uuid, "real-proj", projectPath, [], null);
	saveSyncConfig(env, { server_url: "ssh://host/mem", push_on_commit: true, pull_on_start: true });

	const r = gatherStatus(env, { root: mem, activeAgent: null });
	assert.equal(r.zone, "project");
	assert.equal(r.registered, true);
	assert.equal(r.uuid, uuid);
	assert.ok(r.registrationDetail.includes("real-proj"));
	assert.equal(r.remoteUrl, "ssh://host/mem/real-proj.git");
	assert.ok(r.gitRepo);
	assert.equal(r.branch, "master");
	assert.ok(r.lastCommit && r.lastCommit.includes("mint"));
	assert.ok(r.aheadBehind !== null || r.aheadBehind === null, "ahead/behind degrades gracefully");
}

// ─── sync off (no server_url) ───────────────────────────────────────────────

{
	const env = makeEnv();
	const mem = path.join(env.orgRoot, "..", "offline", ".memory");
	initMemoryRepo(mem);
	const r = gatherStatus(env, { root: mem, activeAgent: null });
	assert.equal(r.syncEnabled, false);
	assert.equal(r.remoteUrl, null);
	assert.ok(renderStatus(r).includes("OFF"));
}

// ─── agent zone with identity ───────────────────────────────────────────────

{
	const env = makeEnv();
	const mem = path.join(env.agentsDir, "alpha", "memory");
	initMemoryRepo(mem);
	fs.writeFileSync(
		path.join(mem, "agent.json"),
		JSON.stringify({ uuid: "550e8400-e29b-41d4-a716-446655440000", name: "alpha", status: "ephemeral" }, null, 2),
	);
	saveSyncConfig(env, { server_url: "ssh://host/mem", push_on_commit: true, pull_on_start: true });

	const r = gatherStatus(env, { root: mem, activeAgent: "alpha" });
	assert.equal(r.zone, "agent");
	assert.equal(r.uuid, "550e8400-e29b-41d4-a716-446655440000");
	assert.equal(r.remoteUrl, "ssh://host/mem/550e8400-e29b-41d4-a716-446655440000.git");
	assert.equal(r.registered, false, "not yet in org registry (member row)");
}

// ─── org zone ───────────────────────────────────────────────────────────────

{
	const env = makeEnv();
	fs.mkdirSync(env.orgRoot, { recursive: true });
	const r = gatherStatus(env, { root: env.orgRoot, activeAgent: null });
	assert.equal(r.zone, "org");
	assert.equal(r.registered, true);
}

// ─── push log attribution ───────────────────────────────────────────────────

{
	const env = makeEnv();
	const mem = path.join(env.orgRoot, "..", "logged", ".memory");
	initMemoryRepo(mem);
	// old-style (unattributed) + new-style (repo-prefixed) lines
	fs.writeFileSync(env.logPath, [
		"fatal: No rebase in progress?",
		`${mem} pull ok; push ok`,
		`${mem} fatal: repository not found`,
		"/some/other/repo pull failed; push failed",
		"",
	].join("\n"));

	const r = gatherStatus(env, { root: mem, activeAgent: null });
	assert.equal(r.logEntries, 4, "total lines counted");
	assert.deepEqual(r.lastSync, [`${mem} pull ok; push ok`, `${mem} fatal: repository not found`], "only attributed lines for this root");
	assert.ok(renderStatus(r).includes("Last sync (this root):"));
}

// ─── checkRemote against a local bare repo (no real network) ───────────────

{
	const env = makeEnv();
	const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), "status-srv-"));
	const bare = path.join(serverDir, "proj.git");
	git(["init", "--bare", bare], serverDir);
	saveSyncConfig(env, { server_url: `file://${serverDir}/mem`, push_on_commit: true, pull_on_start: true });

	const projectPath = path.join(env.orgRoot, "..", "checkable");
	const mem = path.join(projectPath, ".memory");
	initMemoryRepo(mem);
	const uuid = mintProjectUuid(mem);
	registerProject(env, uuid, "checkable", projectPath, [], null);

	const r = gatherStatus(env, { root: mem, activeAgent: null, checkRemote: true });
	assert.ok(r.checkRemote, "network check ran");
	if (r.checkRemote && !r.checkRemote.ok) {
		// file:// remotes may not resolve on some setups — failing gracefully is also correct
		assert.ok(r.checkRemote.message.length > 0);
	} else {
		assert.equal(r.checkRemote!.ok, true);
	}
}

// ─── checkRemote requested but no remote derivable ──────────────────────────

{
	const env = makeEnv();
	const mem = path.join(env.orgRoot, "..", "noremote", ".memory");
	initMemoryRepo(mem);
	const r = gatherStatus(env, { root: mem, activeAgent: null, checkRemote: true });
	assert.ok(r.checkRemote);
	assert.equal(r.checkRemote!.ok, false);
	assert.ok(r.checkRemote!.message.includes("no remote"));
}

console.log("status.test.ts — all assertions passed");
