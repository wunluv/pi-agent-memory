/**
 * #48: memory + sync health status.
 *
 * One read-only surface answering: which root am I on, what zone, is this soul
 * registered, what is the sync config, what is the local git state, and what
 * was the last sync result. The place where non-fatal sync failures become
 * visible (silent local-only writes, dead remotes, 0-byte FETCH_HEADs).
 *
 * No network on the hot path — the only network op is an explicit
 * `checkRemote` (git ls-remote against the derived URL).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as cp from "node:child_process";
import {
	loadAgentIdentity,
	loadOrgRegistry,
	lookupProject,
	readProjectUuid,
	type GitFn,
} from "./identity.ts";
import {
	loadSyncConfig,
	isSyncEnabled,
	agentRepoUrl,
	projectRepoUrl,
	orgRepoUrl,
	isPrivateMemoryRemote,
} from "./sync.ts";

export interface StatusEnv {
	git: GitFn;
	spawnSync: typeof cp.spawnSync;
	configPath: string; // ~/.pi/memory-sync.json
	logPath: string;    // ~/.pi/agent/memory-repository-push.log
	agentsDir: string;  // ~/.pi/agents
	orgRoot: string;    // ~/.pi/org
}

export interface StatusReport {
	root: string | null;
	zone: "agent" | "project" | "org" | "none";
	uuid: string | null;
	registered: boolean;
	registrationDetail: string;
	syncEnabled: boolean;
	serverUrl: string;
	pushOnCommit: boolean;
	pullOnStart: boolean;
	remoteUrl: string | null;
	gitRepo: boolean;
	branch: string | null;
	aheadBehind: string | null;
	lastCommit: string | null;
	lastSync: string[];  // attributed log lines for this root (tail)
	logEntries: number;  // total lines in the push log
	checkRemote: { ok: boolean; message: string } | null;
}

export interface StatusOptions {
	root: string | null;             // already resolved by the caller
	activeAgent: string | null;      // for agent-zone detection + identity
	checkRemote?: boolean;           // network op — off by default
}

const NO_ROOT: StatusReport = {
	root: null,
	zone: "none",
	uuid: null,
	registered: false,
	registrationDetail: "no memory root resolved",
	syncEnabled: false,
	serverUrl: "",
	pushOnCommit: false,
	pullOnStart: false,
	remoteUrl: null,
	gitRepo: false,
	branch: null,
	aheadBehind: null,
	lastCommit: null,
	lastSync: [],
	logEntries: 0,
	checkRemote: null,
};

/** Resolve the zone a root belongs to, and its soul identity. */
function resolveSoul(env: StatusEnv, root: string, activeAgent: string | null) {
	const agentRoot = activeAgent ? path.join(env.agentsDir, activeAgent, "memory") : null;
	if (agentRoot && path.resolve(root) === path.resolve(agentRoot)) {
		const uuid = loadAgentIdentity(env, activeAgent);
		const reg = loadOrgRegistry(env);
		const member = uuid ? reg.members[uuid] : undefined;
		return {
			zone: "agent" as const,
			uuid,
			registered: !!member,
			registrationDetail: member
				? `agent "${member.name}" (${member.status})`
				: uuid
					? `agent uuid ${uuid.slice(0, 8)} — NOT in org registry`
					: "no agent.json identity",
		};
	}
	if (path.resolve(root) === path.resolve(env.orgRoot)) {
		return {
			zone: "org" as const,
			uuid: null,
			registered: true,
			registrationDetail: "shared org root",
		};
	}
	// project soul (Zone B)
	const uuid = readProjectUuid(root);
	if (uuid) {
		const row = lookupProject(env, uuid);
		return {
			zone: "project" as const,
			uuid,
			registered: !!row,
			registrationDetail: row
				? `"${row.name}" @ ${row.path}`
				: `project.json present (${uuid.slice(0, 8)}) — NOT in org registry`,
		};
	}
	return {
		zone: "project" as const,
		uuid: null,
		registered: false,
		registrationDetail: "NO project.json — writes will not sync (run /startwork to register)",
	};
}

/** Derive the sync remote for a root, or null when inapplicable. */
function deriveRemote(
	env: StatusEnv,
	root: string,
	serverUrl: string,
	soul: ReturnType<typeof resolveSoul>,
): string | null {
	if (!serverUrl) return null;
	try {
		if (soul.zone === "agent" && soul.uuid) {
			return agentRepoUrl(serverUrl, soul.uuid);
		}
		if (soul.zone === "org") {
			return orgRepoUrl(serverUrl);
		}
		if (soul.zone === "project") {
			const row = soul.uuid ? lookupProject(env, soul.uuid) : null;
			const name = row?.name || path.basename(path.dirname(root));
			return projectRepoUrl(serverUrl, name);
		}
	} catch {
		return null;
	}
	return null;
}

/** Collect the status report. Never throws — every subsystem degrades gracefully. */
export function gatherStatus(env: StatusEnv, opts: StatusOptions): StatusReport {
	if (!opts.root) return NO_ROOT;

	const soul = resolveSoul(env, opts.root, opts.activeAgent);
	const config = loadSyncConfig(env);
	const syncEnabled = isSyncEnabled(config);
	const remoteUrl = syncEnabled ? deriveRemote(env, opts.root, config.server_url, soul) : null;

	// Local git state
	let gitRepo = false;
	let branch: string | null = null;
	let aheadBehind: string | null = null;
	let lastCommit: string | null = null;
	try {
		gitRepo = fs.existsSync(path.join(opts.root, ".git"));
	} catch {
		gitRepo = false;
	}
	if (gitRepo) {
		const b = env.git(["rev-parse", "--abbrev-ref", "HEAD"], opts.root);
		if (b.code === 0 && b.stdout.trim()) branch = b.stdout.trim();
		const ab = env.git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], opts.root);
		if (ab.code === 0) {
			const [a, be] = ab.stdout.trim().split(/\s+/);
			if (a !== undefined && be !== undefined) aheadBehind = `ahead ${a}, behind ${be}`;
		}
		const lc = env.git(["log", "-1", "--date=short", "--pretty=format:%h %ad %s"], opts.root);
		if (lc.code === 0 && lc.stdout.trim()) lastCommit = lc.stdout.trim();
	}

	// Push log tail — attributed lines for this root (new format: "<repo> <line>")
	let lastSync: string[] = [];
	let logEntries = 0;
	try {
		const raw = fs.readFileSync(env.logPath, "utf-8");
		const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
		logEntries = lines.length;
		lastSync = lines.filter((l) => l.startsWith(opts.root + " ")).slice(-5);
	} catch {
		logEntries = 0;
	}

	// Optional network check (explicit only — never on the hot path)
	let checkRemote: StatusReport["checkRemote"] = null;
	if (opts.checkRemote && remoteUrl && isPrivateMemoryRemote(config.server_url, remoteUrl)) {
		const r = env.spawnSync("git", ["ls-remote", remoteUrl], { encoding: "utf-8", timeout: 10000 });
		if (r.status === 0) {
			const refs = (r.stdout || "").trim().split("\n").filter(Boolean).length;
			checkRemote = { ok: true, message: `reachable, ${refs} ref(s)` };
		} else {
			checkRemote = { ok: false, message: (r.stderr || r.stdout || "unreachable").trim() };
		}
	} else if (opts.checkRemote && !remoteUrl) {
		checkRemote = { ok: false, message: "no remote derivable (sync off or unregistered soul)" };
	}

	return {
		root: opts.root,
		zone: soul.zone,
		uuid: soul.uuid,
		registered: soul.registered,
		registrationDetail: soul.registrationDetail,
		syncEnabled,
		serverUrl: config.server_url,
		pushOnCommit: config.push_on_commit,
		pullOnStart: config.pull_on_start,
		remoteUrl,
		gitRepo,
		branch,
		aheadBehind,
		lastCommit,
		lastSync,
		logEntries,
		checkRemote,
	};
}

/** Render a status report for humans and agents alike. */
export function renderStatus(r: StatusReport): string {
	if (!r.root) return "Memory status: no root resolved.";
	const lines: string[] = [];
	lines.push(`Memory root: ${r.root}`);
	lines.push(`Zone: ${r.zone}`);
	lines.push(`Soul: ${r.registered ? "\u2705" : "\u26A0\uFE0F"} ${r.registrationDetail}`);
	if (r.uuid) lines.push(`UUID: ${r.uuid}`);
	lines.push(
		`Sync: ${r.syncEnabled ? "ENABLED" : "OFF (no server_url)"}` +
		(r.syncEnabled ? ` | server: ${r.serverUrl} | push_on_commit: ${r.pushOnCommit} | pull_on_start: ${r.pullOnStart}` : ""),
	);
	if (r.remoteUrl) lines.push(`Remote: ${r.remoteUrl}`);
	if (r.gitRepo) {
		lines.push(`Git: ${r.branch || "(no branch)"}${r.aheadBehind ? ` | ${r.aheadBehind}` : ""}`);
		if (r.lastCommit) lines.push(`Last commit: ${r.lastCommit}`);
	} else {
		lines.push("Git: not a repo (memory_write will init on first write)");
	}
	if (r.lastSync.length > 0) {
		lines.push("Last sync (this root):");
		for (const l of r.lastSync) lines.push(`  ${l}`);
	} else {
		lines.push(`Last sync: no recent entries attributed to this root (log has ${r.logEntries} line(s) total)`);
	}
	if (r.checkRemote) {
		lines.push(`Remote check: ${r.checkRemote.ok ? "\u2705" : "\u26A0\uFE0F"} ${r.checkRemote.message}`);
	}
	return lines.join("\n");
}
