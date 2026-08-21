/**
 * Identity + org-registry concern for pi-agent-memory.
 *
 * Extracted from index.ts so it has a stable, testable public interface.
 * All filesystem access flows against an injected env (agentsDir + orgRoot)
 * and all git through an injected git function, so tests can run against
 * sandboxed tmp dirs with a recording git.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
}

export type GitFn = (args: string[], cwd: string) => GitResult;

export interface IdentityEnv {
	agentsDir: string; // ~/.pi/agents
	orgRoot: string;   // ~/.pi/org
	git: GitFn;
}

export interface ProjectRegistryEntry {
	name: string;
	path: string;
	humans: string[]; // membership ACL — open when empty
}

export interface MemberRegistryEntry {
	name: string;
	status: "ephemeral" | "member";
	memoryPath: string;
}

export interface HumanRegistryEntry {
	name: string;
	agents: string[]; // ownership binding — the agents serving this human
}

export interface OrgRegistry {
	version: number;
	updated: string;
	projects: Record<string, ProjectRegistryEntry>; // uuid → entry (v2)
	members: Record<string, MemberRegistryEntry>;   // uuid → entry (v2)
	humans: Record<string, HumanRegistryEntry>;     // uuid → entry (v2)
}

export interface IdentitySummary {
	uuid: string;
	isNew: boolean;
	kept: boolean;
	caughtUp: boolean;
	registered: boolean;
	status: "ephemeral" | "member";
}

/** Short form of a UUID for display and commit author names. */
export function shortUuid(uuid: string): string {
	return uuid.slice(0, 8);
}

/** Load the agent's identity (uuid) from agent.json in its Zone A root. Null-safe. */
export function loadAgentIdentity(env: IdentityEnv, agentName: string | null): string | null {
	if (!agentName) return null;
	try {
		const file = path.join(env.agentsDir, agentName, "memory", "agent.json");
		if (!fs.existsSync(file)) return null;
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
		return typeof parsed.uuid === "string" && parsed.uuid ? parsed.uuid : null;
	} catch {
		return null;
	}
}

function isGitRepo(repoPath: string): boolean {
	return fs.existsSync(path.join(repoPath, ".git"));
}

/** Set repo-local git author for a given identity; fall back to defaults. */
export function configureRepoAuthor(env: IdentityEnv, repoPath: string, uuid: string | null): void {
	if (uuid) {
		env.git(["config", "user.name", `agent-${shortUuid(uuid)}`], repoPath);
		env.git(["config", "user.email", `${uuid}@pi.local`], repoPath);
	} else {
		env.git(["config", "user.email", "agent-memory@pi"], repoPath);
		env.git(["config", "user.name", "Agent Memory"], repoPath);
	}
}

/** Initialize a git repo authored for the given identity (or default). */
function initRepo(env: IdentityEnv, repoPath: string, uuid: string | null): boolean {
	fs.mkdirSync(repoPath, { recursive: true });
	const r = env.git(["init"], repoPath);
	if (r.code !== 0) return false;
	configureRepoAuthor(env, repoPath, uuid);
	return true;
}

/** Run git with an explicit acting agent as author (shared repos like the org root). */
export function gitAs(env: IdentityEnv, args: string[], cwd: string, uuid: string | null): GitResult {
	const prefix = uuid ? ["-c", `user.name=agent-${shortUuid(uuid)}`, "-c", `user.email=${uuid}@pi.local`] : [];
	return env.git([...prefix, ...args], cwd);
}

/** Bootstrap the shared org root (~/.pi/org/) if missing. Idempotent. */
export function ensureOrgRoot(env: IdentityEnv, uuid: string | null): boolean {
	try {
		const registry = path.join(env.orgRoot, "registry.json");
		if (!fs.existsSync(env.orgRoot)) {
			fs.mkdirSync(path.join(env.orgRoot, "roles"), { recursive: true });
			fs.writeFileSync(path.join(env.orgRoot, "roles", ".gitkeep"), "");
			fs.writeFileSync(
				path.join(env.orgRoot, "README.md"),
				`# Org Root\n\nShared org-layer memory at ~/.pi/org/. Single-writer convention: registry.json is an aggregate file touched only at gated transitions (recruitment, promotion, project moves).\n\n- \`registry.json\` — uuid-keyed \`projects\` + \`members\` + \`humans\`\n- \`roles/\` — shared role specs, evolved by their wearers\n`,
			);
			const skeleton: OrgRegistry = { version: 2, updated: new Date().toISOString().split("T")[0], projects: {}, members: {}, humans: {} };
			fs.writeFileSync(registry, JSON.stringify(skeleton, null, 2) + "\n", "utf-8");
		}
		if (!isGitRepo(env.orgRoot)) {
			initRepo(env, env.orgRoot, uuid);
			gitAs(env, ["add", "-A"], env.orgRoot, uuid);
			gitAs(env, ["commit", "-m", "org: bootstrap org root (registry, roles, README)"], env.orgRoot, uuid);
		}
		return true;
	} catch {
		return false;
	}
}

/** Load the org registry, normalizing v1 (name-keyed) to v2 (uuid-keyed). Null-safe. */
export function loadOrgRegistry(env: IdentityEnv): OrgRegistry {
	const registry = path.join(env.orgRoot, "registry.json");
	try {
		if (fs.existsSync(registry)) {
			const parsed = JSON.parse(fs.readFileSync(registry, "utf-8"));
			if (parsed && typeof parsed === "object") {
				return normalizeRegistry(parsed);
			}
		}
	} catch {
		// fall through to skeleton
	}
	return { version: 2, updated: new Date().toISOString().split("T")[0], projects: {}, members: {}, humans: {} };
}

/**
 * Normalize a registry to v2 (uuid-keyed). Idempotent — v2 input round-trips,
 * v1 (name-keyed) input is re-keyed. v1 `projects` carried no uuid, so those
 * rows are dropped: legacy projects stay unidentifiable until #22 mints their
 * uuid (#13 design decision 5).
 */
function normalizeRegistry(parsed: Record<string, unknown>): OrgRegistry {
	const out: OrgRegistry = {
		version: 2,
		updated: typeof parsed.updated === "string" ? parsed.updated : new Date().toISOString().split("T")[0],
		projects: {},
		members: {},
		humans: {},
	};

	if (parsed.members && typeof parsed.members === "object") {
		for (const [key, raw] of Object.entries(parsed.members as Record<string, unknown>)) {
			if (!raw || typeof raw !== "object") continue;
			const val = raw as Record<string, unknown>;
			// v1: key = name, value carries uuid → re-key by uuid.
			// v2: key = uuid, value carries name only.
			const uuid = typeof val.uuid === "string" && val.uuid ? val.uuid : key;
			out.members[uuid] = {
				name: typeof val.name === "string" ? val.name : key,
				status: val.status === "member" ? "member" : "ephemeral",
				memoryPath: typeof val.memoryPath === "string" ? val.memoryPath : "",
			};
		}
	}

	if (parsed.projects && typeof parsed.projects === "object") {
		for (const [key, raw] of Object.entries(parsed.projects as Record<string, unknown>)) {
			// v2: uuid-keyed object { name, path, humans }. v1: name-keyed string path (no uuid → dropped).
			if (!raw || typeof raw !== "object") continue;
			const val = raw as Record<string, unknown>;
			out.projects[key] = {
				name: typeof val.name === "string" ? val.name : key,
				path: typeof val.path === "string" ? val.path : "",
				humans: Array.isArray(val.humans) ? (val.humans as string[]) : [],
			};
		}
	}

	if (parsed.humans && typeof parsed.humans === "object") {
		for (const [key, raw] of Object.entries(parsed.humans as Record<string, unknown>)) {
			if (!raw || typeof raw !== "object") continue;
			const val = raw as Record<string, unknown>;
			out.humans[key] = {
				name: typeof val.name === "string" ? val.name : key,
				agents: Array.isArray(val.agents) ? (val.agents as string[]) : [],
			};
		}
	}

	return out;
}

/** Persist the registry and commit it in the org root repo. */
export function saveOrgRegistry(env: IdentityEnv, reg: OrgRegistry, uuid: string | null): boolean {
	const registry = path.join(env.orgRoot, "registry.json");
	try {
		reg.version = 2;
		reg.updated = new Date().toISOString().split("T")[0];
		fs.writeFileSync(registry, JSON.stringify(reg, null, 2) + "\n", "utf-8");
		const staged = env.git(["status", "--porcelain"], env.orgRoot);
		if (staged.stdout.trim()) {
			gitAs(env, ["add", registry], env.orgRoot, uuid);
			gitAs(env, ["commit", "-m", "org: update registry"], env.orgRoot, uuid);
		}
		return true;
	} catch {
		return false;
	}
}

/** Upsert a member row in the org registry, keyed by uuid (rename-proof). Thin index — identity content stays in agent.json. */
export function registerMember(env: IdentityEnv, name: string, uuid: string, status: "ephemeral" | "member"): boolean {
	if (!ensureOrgRoot(env, uuid)) return false;
	const reg = loadOrgRegistry(env);
	reg.members[uuid] = { name, status, memoryPath: `~/.pi/agents/${name}/memory` };
	return saveOrgRegistry(env, reg, uuid);
}

/** Upsert a project row, keyed by its immutable uuid. `actorUuid` authors the org-root commit. */
export function registerProject(
	env: IdentityEnv,
	uuid: string,
	name: string,
	projectPath: string,
	humans: string[] = [],
	actorUuid: string | null = null,
): boolean {
	if (!ensureOrgRoot(env, actorUuid)) return false;
	const reg = loadOrgRegistry(env);
	reg.projects[uuid] = { name, path: projectPath, humans };
	return saveOrgRegistry(env, reg, actorUuid);
}

/** Look up a project's registry entry by its uuid. Null if unknown. */
export function lookupProject(env: IdentityEnv, uuid: string): ProjectRegistryEntry | null {
	const reg = loadOrgRegistry(env);
	const p = reg.projects[uuid];
	return p && typeof p.path === "string" && p.path ? p : null;
}

/** Find a project's entry by mutable name (scan; name is a registry field, not a key). Null if unknown. */
export function findProjectByName(env: IdentityEnv, name: string): { uuid: string; name: string; path: string } | null {
	const reg = loadOrgRegistry(env);
	for (const [uuid, p] of Object.entries(reg.projects)) {
		if (p.name === name && p.path) return { uuid, name: p.name, path: p.path };
	}
	return null;
}

/** Find a member's uuid by name (name is a mutable registry field). Null if unknown. */
export function findMemberUuid(env: IdentityEnv, name: string): string | null {
	const reg = loadOrgRegistry(env);
	for (const [uuid, m] of Object.entries(reg.members)) {
		if (m.name === name) return uuid;
	}
	return null;
}

/** Read a project's immutable uuid from project.json in its .memory/ root. Null if absent (legacy). */
export function readProjectUuid(memoryPath: string): string | null {
	try {
		const file = path.join(memoryPath, "project.json");
		if (!fs.existsSync(file)) return null;
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
		return typeof parsed.uuid === "string" && parsed.uuid ? parsed.uuid : null;
	} catch {
		return null;
	}
}

/** Read project.json's uuid, minting a fresh one when absent (bootstrap). Idempotent — never regenerates. */
export function ensureProjectUuid(memoryPath: string): string {
	const existing = readProjectUuid(memoryPath);
	return existing ?? mintProjectUuid(memoryPath);
}

/** Force-mint a fresh uuid into project.json (fork action — a copy carried the old uuid). */
export function mintProjectUuid(memoryPath: string): string {
	const uuid = randomUUID();
	fs.writeFileSync(path.join(memoryPath, "project.json"), JSON.stringify({ uuid }, null, 2) + "\n", "utf-8");
	return uuid;
}

/** Strip Letta-era cruft (hooks, config, remotes) from an existing memory repo. Idempotent. */
export function stripLegacyCruft(env: IdentityEnv, memoryRoot: string): void {
	// Letta hooks: pre-commit rejects our frontmatter schema; post-commit pushes to the dead memfs server
	for (const hook of ["pre-commit", "post-commit"]) {
		const p = path.join(memoryRoot, ".git", "hooks", hook);
		if (fs.existsSync(p)) fs.rmSync(p);
	}
	// Letta config section + any credential helpers in repo-local config
	env.git(["config", "--remove-section", "letta"], memoryRoot);
	const cred = env.git(["config", "--local", "--get-regexp", "^credential\\."], memoryRoot);
	for (const line of cred.stdout.split("\n").filter(Boolean)) {
		const key = line.split(" ")[0];
		if (key) env.git(["config", "--unset-all", key], memoryRoot);
	}
	// Letta-era remotes: origin (dead memfs URL) and github (letta backup)
	for (const remote of ["origin", "github"]) {
		const url = env.git(["remote", "get-url", remote], memoryRoot).stdout.trim();
		if (url) env.git(["remote", "remove", remote], memoryRoot);
	}
}

/**
 * Ensure an agent has identity + a clean, committed repo. Shared by /agent:init
 * and the session_start auto-backfill. Idempotent: UUID kept, Letta cruft
 * stripped, accumulated memory committed (catch-up), member registered.
 * Returns a summary for notification, or null on failure.
 */
export function ensureAgentIdentity(env: IdentityEnv, name: string, isNew: boolean): IdentitySummary | null {
	try {
		const agentDir = path.join(env.agentsDir, name);
		const memoryRoot = path.join(agentDir, "memory");
		const agentJsonPath = path.join(memoryRoot, "agent.json");

		// Identity: keep existing UUID (idempotent, never regenerated),
		// backfill legacy agents (no agent.json), create for new agents.
		let uuid: string | null = null;
		let status: "ephemeral" | "member" = "ephemeral";
		if (fs.existsSync(agentJsonPath)) {
			try {
				const parsed = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"));
				uuid = typeof parsed.uuid === "string" && parsed.uuid ? parsed.uuid : null;
				status = parsed.status === "member" ? "member" : "ephemeral";
			} catch {
				// corrupt agent.json → regenerate below
			}
		}
		const kept = !!uuid;
		if (!uuid) {
			uuid = randomUUID();
			fs.mkdirSync(memoryRoot, { recursive: true });
		}

		// Agent's own repo: clean, then authored as agent-<short-uuid>
		if (!isGitRepo(memoryRoot)) initRepo(env, memoryRoot, uuid);
		stripLegacyCruft(env, memoryRoot); // remove Letta hooks/config/remotes (idempotent)
		env.git(["config", "user.name", `agent-${shortUuid(uuid)}`], memoryRoot);
		env.git(["config", "user.email", `${uuid}@pi.local`], memoryRoot);

		// agent.json — stable identity (UUID kept, never regenerated)
		fs.writeFileSync(agentJsonPath, JSON.stringify({ uuid, name, status }, null, 2) + "\n", "utf-8");

		// Commit; skip when nothing changed (idempotent re-init).
		// Backfill path: accumulated memory lands in its own catch-up commit first.
		// The split restores agent.json from HEAD, so it needs an existing HEAD;
		// on an unborn HEAD (fresh git init) fall back to a single combined commit.
		let caughtUp = false;
		env.git(["add", "-A"], memoryRoot);
		const staged = env.git(["status", "--porcelain"], memoryRoot);
		if (staged.stdout.trim()) {
			const hasHead = env.git(["rev-parse", "--verify", "HEAD"], memoryRoot).code === 0;
			if (!isNew && hasHead) {
				env.git(["restore", "--staged", "agent.json"], memoryRoot);
				const memoryOnly = env.git(["status", "--porcelain"], memoryRoot).stdout.trim();
				if (memoryOnly) {
					env.git(["commit", "-m", "memory: catch-up commit (accumulated agent memory)"], memoryRoot);
					caughtUp = true;
				}
				env.git(["add", "agent.json"], memoryRoot);
			}
			env.git(["commit", "-m", isNew ? `init: Agent "${name}" memory system setup` : `identity: backfill agent.json for ${name}`], memoryRoot);
		}

		// Org registry: member row; /agent:promote flips ephemeral → member
		const registered = registerMember(env, name, uuid, status);

		return { uuid, isNew, kept, caughtUp, registered, status };
	} catch {
		return null;
	}
}
