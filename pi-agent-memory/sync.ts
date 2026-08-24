/**
 * Zone A memory sync engine — issue #8.
 *
 * Extension-level async push (no git hooks), pull --rebase --autostash,
 * never force. Config at ~/.pi/memory-sync.json (mode 600). Server repos
 * named by agent UUID. See SPEC_v4 §2.2.
 *
 * Extracted from index.ts as a stable, testable public interface. All git
 * flows through an injected GitFn and all process spawning through injected
 * spawn/spawnSync so tests can run against a local bare repo (mock server).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as cp from "node:child_process";

export interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
}

/** Git with an optional per-call timeout (ms). Defaults to the caller's choice. */
export type GitFn = (args: string[], cwd: string, timeoutMs?: number) => GitResult;

export interface SyncConfig {
	server_url: string;
	push_on_commit: boolean;
	pull_on_start: boolean;
}

export interface SyncEnv {
	configPath: string; // ~/.pi/memory-sync.json
	logPath: string; // async push log (memory-repository-push.log)
	git: GitFn;
	spawn: typeof cp.spawn;
	spawnSync: typeof cp.spawnSync;
	nodePath: string; // process.execPath, for the detached child
}

export interface SyncResult {
	ok: boolean;
	pulled: boolean;
	pushed: boolean;
	conflict: boolean;
	message: string;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
	server_url: "",
	push_on_commit: true,
	pull_on_start: true,
};

// ─── Config ──────────────────────────────────────────────────────────────────────

/** Load config from disk. Missing/corrupt → defaults. Never throws. */
export function loadSyncConfig(env: SyncEnv): SyncConfig {
	try {
		if (fs.existsSync(env.configPath)) {
			const parsed = JSON.parse(fs.readFileSync(env.configPath, "utf-8"));
			return {
				server_url: typeof parsed.server_url === "string" ? parsed.server_url : "",
				push_on_commit: parsed.push_on_commit !== false, // default true
				pull_on_start: parsed.pull_on_start !== false, // default true
			};
		}
	} catch {
		// fall through to defaults
	}
	return { ...DEFAULT_SYNC_CONFIG };
}

/** Persist config, mode 600. Returns true on success. */
export function saveSyncConfig(env: SyncEnv, config: SyncConfig): boolean {
	try {
		fs.mkdirSync(path.dirname(env.configPath), { recursive: true });
		fs.writeFileSync(env.configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
		return true;
	} catch {
		return false;
	}
}

/** Sync is enabled only when a server_url is configured. */
export function isSyncEnabled(config: SyncConfig): boolean {
	return !!config.server_url.trim();
}

// ─── URL derivation ─────────────────────────────────────────────────────────────

/** <server_url>/<uuid>.git — rename-proof, matches the identity model (#7). */
export function agentRepoUrl(serverUrl: string, uuid: string): string {
	const base = serverUrl.replace(/\/+$/, "");
	return `${base}/${uuid}.git`;
}

/** Per-project private memory repo. Names are path-safe and human-readable. */
export function projectRepoUrl(serverUrl: string, projectName: string): string {
	const safeName = projectName.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
	if (!safeName) throw new Error("A project name is required for Zone B sync.");
	return `${serverUrl.replace(/\/+$/, "")}/${safeName}.git`;
}

/** Shared private org-layer repo. */
export function orgRepoUrl(serverUrl: string): string {
	return `${serverUrl.replace(/\/+$/, "")}/org.git`;
}

/** Guard for Zone B/org callers: only remotes derived from server_url are valid. */
export function isPrivateMemoryRemote(serverUrl: string, remoteUrl: string): boolean {
	const base = serverUrl.trim().replace(/\/+$/, "");
	return !!base && remoteUrl.startsWith(`${base}/`) && remoteUrl.endsWith(".git");
}

export function assertPrivateMemoryRemote(serverUrl: string, remoteUrl: string): void {
	if (!isPrivateMemoryRemote(serverUrl, remoteUrl)) {
		throw new Error("Zone B and org memory may sync only to a remote derived from server_url.");
	}
}

/** Local filesystem path for file:// or plain-path remotes; null otherwise. */
export function localRemotePath(url: string): string | null {
	if (url.startsWith("file://")) return url.slice("file://".length);
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return null; // http, ssh, git, etc.
	if (url.includes(":")) return null; // scp-like user@host:path (or Windows drive)
	return url; // plain absolute/relative path
}

/** {host, repoPath} for ssh://host/path and host:path remotes; null otherwise. */
export function parseSshRemote(url: string): { host: string; repoPath: string } | null {
	if (url.startsWith("ssh://")) {
		const rest = url.slice("ssh://".length);
		const slash = rest.indexOf("/");
		if (slash === -1) return null;
		// ssh:// paths are absolute on the remote — preserve the leading slash.
		return { host: rest.slice(0, slash), repoPath: rest.slice(slash) };
	}
	if (!url.includes("://") && url.includes(":")) {
		const colon = url.indexOf(":");
		return { host: url.slice(0, colon), repoPath: url.slice(colon + 1) };
	}
	return null;
}

// ─── Engine ──────────────────────────────────────────────────────────────────────

function currentBranch(env: SyncEnv, repoPath: string): string {
	const r = env.git(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
	if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
	return "main";
}

function isConflict(err: string): boolean {
	return (
		err.includes("conflict") ||
		err.includes("could not apply") ||
		err.includes("unmerged") ||
		err.includes("would be overwritten")
	);
}

function isNoRemoteRef(err: string): boolean {
	return (
		err.includes("couldn't find remote ref") ||
		err.includes("does not appear to be a git repository") ||
		err.includes("repository not found")
	);
}

/** Clean up after a failed rebase so the repo returns to a clean, intact state. */
function abortRebase(env: SyncEnv, repoPath: string): void {
	env.git(["rebase", "--abort"], repoPath); // no-op if no rebase in progress
	env.git(["stash", "pop"], repoPath); // restore --autostash changes (best-effort)
}

/**
 * Provision a bare repo on the server. Local paths (file:// or plain) init
 * locally; ssh remotes run `git init --bare` over ssh. GitHub-style remotes
 * must pre-exist and are never provisioned. Returns true on success.
 */
export function provisionRemote(env: SyncEnv, remoteUrl: string): boolean {
	const local = localRemotePath(remoteUrl);
	if (local) {
		return env.git(["init", "--bare", local], os.tmpdir()).code === 0;
	}
	const ssh = parseSshRemote(remoteUrl);
	if (ssh) {
		const r = env.spawnSync("ssh", [ssh.host, `git init --bare ${ssh.repoPath}`], {
			encoding: "utf-8",
			timeout: 15000,
		});
		return r.status === 0;
	}
	return false;
}

/**
 * Pull --rebase --autostash, then (unless opts.push === false) push. Never
 * force. Same-file conflict → abort rebase, leave both sides intact, report
 * conflict. First push (no remote ref) skips pull; provisioning inits the bare
 * repo when the push finds none.
 */
export function syncOnce(
	env: SyncEnv,
	repoPath: string,
	remoteUrl: string,
	timeoutMs: number,
	opts: { push?: boolean } = {},
): SyncResult {
	const branch = currentBranch(env, repoPath);

	const pull = env.git(["pull", "--rebase", "--autostash", remoteUrl, branch], repoPath, timeoutMs);
	let pulled = pull.code === 0;
	if (pull.code !== 0) {
		const err = (pull.stderr + pull.stdout).toLowerCase();
		if (isNoRemoteRef(err)) {
			pulled = false; // first push — remote has no refs yet, that's fine
		} else if (isConflict(err)) {
			abortRebase(env, repoPath);
			return { ok: false, pulled: false, pushed: false, conflict: true, message: "conflict on pull — both sides intact" };
		} else {
			return { ok: false, pulled: false, pushed: false, conflict: false, message: (pull.stderr || pull.stdout || "pull failed").trim() };
		}
	}

	if (opts.push === false) {
		return { ok: true, pulled, pushed: false, conflict: false, message: "pulled" };
	}

	let push = env.git(["push", remoteUrl, branch], repoPath, timeoutMs);
	if (push.code !== 0) {
		const err = (push.stderr + push.stdout).toLowerCase();
		if (isNoRemoteRef(err) && provisionRemote(env, remoteUrl)) {
			push = env.git(["push", remoteUrl, branch], repoPath, timeoutMs);
		}
	}
	if (push.code !== 0) {
		return { ok: false, pulled, pushed: false, conflict: false, message: (push.stderr || push.stdout || "push failed").trim() };
	}
	return { ok: true, pulled, pushed: true, conflict: false, message: "synced" };
}

/** Pull-only variant (session_start auto-pull). 2–3s fail-fast via timeoutMs. */
export function pullOnce(env: SyncEnv, repoPath: string, remoteUrl: string, timeoutMs: number): SyncResult {
	return syncOnce(env, repoPath, remoteUrl, timeoutMs, { push: false });
}

/** Pull/push a private Zone B or org repo after validating its derived remote. */
export function syncPrivateOnce(
	env: SyncEnv,
	repoPath: string,
	serverUrl: string,
	remoteUrl: string,
	timeoutMs: number,
	opts: { push?: boolean } = {},
): SyncResult {
	assertPrivateMemoryRemote(serverUrl, remoteUrl);
	return syncOnce(env, repoPath, remoteUrl, timeoutMs, opts);
}

// ─── Async push (fire-and-forget) ───────────────────────────────────────────────

/**
 * The detached child runs this self-contained script (no dependency on the
 * compiled module). It does pull --rebase --autostash then push, logs to the
 * log file, cleans up a failed rebase, and ALWAYS exits 0. 60s ceiling per git
 * op (execFileSync timeout sends SIGTERM, never SIGKILL).
 */
export const PUSH_CHILD_SCRIPT = [
	'const { execFileSync } = require("child_process");',
	'const fs = require("fs");',
	'const repo = process.env.PI_SYNC_REPO;',
	'const remote = process.env.PI_SYNC_REMOTE;',
	'const log = process.env.PI_SYNC_LOG;',
	'function w(s) { try { fs.appendFileSync(log, s + "\\n"); } catch (e) {} }',
	'let branch = "main";',
	'try {',
	'  const b = execFileSync("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf-8", timeout: 5000 }).trim();',
	'  if (b) branch = b;',
	'} catch (e) {}',
	'function run(args) {',
	'  try { execFileSync("git", ["-C", repo].concat(args), { timeout: 60000, stdio: "pipe" }); return true; }',
	'  catch (e) { w(String((e && e.stderr) || (e && e.message) || e)); return false; }',
	'}',
	'const pulled = run(["pull", "--rebase", "--autostash", remote, branch]);',
	'if (!pulled) { run(["rebase", "--abort"]); run(["stash", "pop"]); }',
	'run(["push", remote, branch]);',
	'process.exit(0);',
].join("\n");

/**
 * Fire-and-forget async push. Spawns a detached child; the caller returns
 * immediately and never waits on the network. The child always exits 0.
 */
export function pushAsync(env: SyncEnv, repoPath: string, remoteUrl: string): void {
	try {
		fs.mkdirSync(path.dirname(env.logPath), { recursive: true });
	} catch {
		// log dir may already exist or be unwritable; child handles its own errors
	}
	const child = env.spawn(
		env.nodePath,
		["-e", PUSH_CHILD_SCRIPT],
		{
			detached: true,
			stdio: ["ignore", "ignore", "ignore"],
			env: {
				...process.env,
				PI_SYNC_REPO: repoPath,
				PI_SYNC_REMOTE: remoteUrl,
				PI_SYNC_LOG: env.logPath,
			},
		},
	);
	if (child && typeof child.unref === "function") child.unref();
}
