/**
 * Tests for sync.ts — run with: node test/sync.test.ts
 * Uses real git against sandboxed tmp dirs (local bare repo = mock server),
 * plus injected fakes for the unreachable-server and ssh-provisioning paths.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cp from "node:child_process";
import {
	DEFAULT_SYNC_CONFIG,
	agentRepoUrl,
	isSyncEnabled,
	loadSyncConfig,
	localRemotePath,
	parseSshRemote,
	provisionRemote,
	pullOnce,
	pushAsync,
	saveSyncConfig,
	syncOnce,
	PUSH_CHILD_SCRIPT,
	type GitFn,
	type SyncEnv,
} from "../sync.ts";

const git: GitFn = (args, cwd, timeoutMs = 10000) => {
	const r = cp.spawnSync("git", args, { cwd, encoding: "utf-8", timeout: timeoutMs });
	return { stdout: r.stdout || "", stderr: r.stderr || "", code: r.status ?? 1 };
};

function makeEnv(): SyncEnv {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
	return {
		configPath: path.join(root, "memory-sync.json"),
		logPath: path.join(root, "push.log"),
		git,
		spawn: cp.spawn,
		spawnSync: cp.spawnSync,
		nodePath: process.execPath,
	};
}

function mkTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "sync-test-"));
}

function author(cwd: string): void {
	git(["config", "user.name", "agent-test"], cwd);
	git(["config", "user.email", "agent-test@pi.local"], cwd);
}

function commit(cwd: string, file: string, content: string, message: string): void {
	fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
	fs.writeFileSync(path.join(cwd, file), content);
	git(["add", "-A"], cwd);
	git(["commit", "-m", message], cwd);
}

// ─── Config ──────────────────────────────────────────────────────────────────────

{
	const env = makeEnv();
	const def = loadSyncConfig(env);
	assert.deepEqual(def, DEFAULT_SYNC_CONFIG);
	assert.equal(isSyncEnabled(def), false, "sync off when no server_url");

	assert.ok(saveSyncConfig(env, { server_url: "ssh://host/mem", push_on_commit: true, pull_on_start: false }));
	const loaded = loadSyncConfig(env);
	assert.equal(loaded.server_url, "ssh://host/mem");
	assert.equal(loaded.push_on_commit, true);
	assert.equal(loaded.pull_on_start, false);
	assert.equal(isSyncEnabled(loaded), true);

	const mode = fs.statSync(env.configPath).mode & 0o777;
	assert.equal(mode, 0o600, "config file is mode 600");
}

// corrupt config → defaults, no throw
{
	const env = makeEnv();
	fs.writeFileSync(env.configPath, "{ not json");
	assert.deepEqual(loadSyncConfig(env), DEFAULT_SYNC_CONFIG);
}

// ─── URL derivation ─────────────────────────────────────────────────────────────

{
	assert.equal(agentRepoUrl("ssh://host/mem", "abc"), "ssh://host/mem/abc.git");
	assert.equal(agentRepoUrl("ssh://host/mem/", "abc"), "ssh://host/mem/abc.git");

	assert.deepEqual(parseSshRemote("ssh://host/mem"), { host: "host", repoPath: "/mem" });
	assert.deepEqual(parseSshRemote("ssh://mojah2/var/www/private/pi-agent-memory"), { host: "mojah2", repoPath: "/var/www/private/pi-agent-memory" });
	assert.deepEqual(parseSshRemote("git@host:mem/x.git"), { host: "git@host", repoPath: "mem/x.git" });
	assert.deepEqual(parseSshRemote("mojah2:/var/www/private/x.git"), { host: "mojah2", repoPath: "/var/www/private/x.git" });
	assert.equal(parseSshRemote("https://host/x"), null);

	assert.equal(localRemotePath("/tmp/x.git"), "/tmp/x.git");
	assert.equal(localRemotePath("file:///tmp/x.git"), "/tmp/x.git");
	assert.equal(localRemotePath("ssh://host/x"), null);
	assert.equal(localRemotePath("git@host:x.git"), null);
	assert.equal(localRemotePath("https://host/x"), null);
}

// ─── first push provisions the bare repo ────────────────────────────────────────

{
	const env = makeEnv();
	const serverDir = mkTmp();
	const uuid = "11111111-2222-3333-4444-555555555555";
	const remote = path.join(serverDir, `${uuid}.git`); // does not exist yet

	const work = mkTmp();
	git(["init"], work);
	author(work);
	commit(work, "system.md", "# hi\n", "init");

	const res = syncOnce(env, work, remote, 60000);
	assert.equal(res.ok, true, res.message);
	assert.equal(res.pushed, true);
	assert.ok(fs.existsSync(path.join(remote, "HEAD")), "bare repo provisioned on first push");
	assert.equal(git(["log", "--format=%s"], remote).stdout.trim(), "init");
}

// ─── pull --rebase resolves divergence, then pushes ─────────────────────────────

{
	const env = makeEnv();
	const serverDir = mkTmp();
	const remote = path.join(serverDir, "repo.git");

	const dev1 = mkTmp();
	git(["init"], dev1);
	author(dev1);
	commit(dev1, "a.md", "from dev1\n", "c1");
	assert.equal(syncOnce(env, dev1, remote, 60000).ok, true);

	// device 2 clones and pushes a different file
	const dev2 = mkTmp();
	git(["clone", remote, dev2], os.tmpdir());
	author(dev2);
	commit(dev2, "b.md", "from dev2\n", "c2");
	assert.equal(syncOnce(env, dev2, remote, 60000).ok, true);

	// device 1 makes an independent commit (no conflict — different file)
	commit(dev1, "c.md", "from dev1\n", "c3");
	const res = syncOnce(env, dev1, remote, 60000);
	assert.equal(res.ok, true, res.message);
	assert.equal(res.pulled, true, "pull --rebase fast-forwarded dev2's commit");
	assert.equal(res.pushed, true);

	const subjects = git(["log", "--format=%s"], remote).stdout.trim().split("\n");
	assert.deepEqual(subjects, ["c3", "c2", "c1"]);
}

// ─── same-file conflict → abort, both sides intact, never force ─────────────────

{
	const env = makeEnv();
	const serverDir = mkTmp();
	const remote = path.join(serverDir, "repo.git");

	const dev1 = mkTmp();
	git(["init"], dev1);
	author(dev1);
	commit(dev1, "x.md", "original\n", "c1");
	assert.equal(syncOnce(env, dev1, remote, 60000).ok, true);

	const dev2 = mkTmp();
	git(["clone", remote, dev2], os.tmpdir());
	author(dev2);
	commit(dev2, "x.md", "changed by dev2\n", "c2");
	assert.equal(syncOnce(env, dev2, remote, 60000).ok, true);

	// dev1 edits the SAME file to different content, commits locally
	commit(dev1, "x.md", "changed by dev1\n", "c3");

	const res = syncOnce(env, dev1, remote, 60000);
	assert.equal(res.ok, false);
	assert.equal(res.conflict, true, "same-file divergence reports conflict");
	assert.equal(res.pushed, false, "conflict aborts the push");

	// remote intact (still ends at dev2's c2, dev1's c3 did NOT land)
	assert.equal(git(["log", "--format=%s"], remote).stdout.trim().split("\n")[0], "c2");

	// dev1 intact: local commit preserved, working tree clean (no rebase in progress)
	assert.equal(git(["log", "--format=%s"], dev1).stdout.trim().split("\n")[0], "c3");
	assert.equal(git(["status", "--porcelain"], dev1).stdout.trim(), "", "rebased state cleaned up");
	assert.equal(fs.readFileSync(path.join(dev1, "x.md"), "utf-8"), "changed by dev1\n");
}

// ─── pullOnce: empty remote is a no-op (first run) ──────────────────────────────

{
	const env = makeEnv();
	const serverDir = mkTmp();
	const remote = path.join(serverDir, "repo.git");
	git(["init", "--bare", remote], serverDir); // empty, no commits

	const work = mkTmp();
	git(["init"], work);
	author(work);
	commit(work, "a.md", "x\n", "c1");

	const res = pullOnce(env, work, remote, 5000);
	assert.equal(res.ok, true, "empty remote → nothing to pull, not an error");
	assert.equal(res.pulled, false);
	assert.equal(res.conflict, false);
}

// ─── unreachable server → fail-fast, ok:false, no throw ─────────────────────────

{
	const env = makeEnv();
	let lastArgs: string[] = [];
	env.git = ((args: string[], _cwd: string, _t?: number) => {
		lastArgs = args;
		return { stdout: "", stderr: "fatal: Could not resolve host: unreachable.invalid", code: 1 };
	}) as GitFn;

	const work = mkTmp();
	const res = syncOnce(env, work, "ssh://unreachable.invalid/mem/x.git", 2500);
	assert.equal(res.ok, false);
	assert.equal(res.conflict, false);
	assert.ok(res.message.includes("Could not resolve host"));
	assert.deepEqual(lastArgs.slice(0, 2), ["pull", "--rebase"], "pull was attempted, push was not");
}

// ─── ssh provisioning ───────────────────────────────────────────────────────────

{
	const env = makeEnv();
	let sshArgs: string[] | null = null;
	env.spawnSync = ((cmd: string, args: string[], _opts?: any) => {
		if (cmd === "ssh") sshArgs = args;
		return { status: 0 };
	}) as any;

	assert.equal(provisionRemote(env, "ssh://host/mem/repo.git"), true);
	assert.deepEqual(sshArgs, ["host", "git init --bare /mem/repo.git"]);
}

// ─── pushAsync spawns a detached child with the right env ───────────────────────

{
	const env = makeEnv();
	let captured: any = null;
	env.spawn = ((cmd: string, args: string[], opts: any) => {
		captured = { cmd, args, opts };
		return { unref() {} } as any;
	}) as any;

	pushAsync(env, "/repo", "ssh://host/mem/x.git");
	assert.equal(captured.cmd, process.execPath);
	assert.deepEqual(captured.args, ["-e", PUSH_CHILD_SCRIPT]);
	assert.equal(captured.opts.detached, true);
	assert.equal(captured.opts.env.PI_SYNC_REPO, "/repo");
	assert.equal(captured.opts.env.PI_SYNC_REMOTE, "ssh://host/mem/x.git");
	assert.equal(captured.opts.env.PI_SYNC_LOG, env.logPath);
}

// ─── detached child script end-to-end (async push actually lands) ───────────────

{
	const env = makeEnv();
	const serverDir = mkTmp();
	const remote = path.join(serverDir, "repo.git");
	git(["init", "--bare", remote], serverDir);

	const work = mkTmp();
	git(["init"], work);
	author(work);
	commit(work, "a.md", "hello\n", "c1");

	// run the exact child the async path spawns, synchronously
	cp.execFileSync(process.execPath, ["-e", PUSH_CHILD_SCRIPT], {
		env: { ...process.env, PI_SYNC_REPO: work, PI_SYNC_REMOTE: remote, PI_SYNC_LOG: env.logPath },
		encoding: "utf-8",
		timeout: 30000,
	});

	assert.equal(git(["log", "--format=%s"], remote).stdout.trim(), "c1", "async push landed on the server");
}

console.log("sync.test.ts — all assertions passed");
