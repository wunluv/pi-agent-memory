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

export interface OrgRegistry {
	version: number;
	updated: string;
	projects: Record<string, unknown>;
	members: Record<string, { name: string; uuid: string; status: "ephemeral" | "member"; memoryPath: string }>;
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
				`# Org Root\n\nShared org-layer memory at ~/.pi/org/. Single-writer convention: registry.json is an aggregate file touched only at gated transitions (recruitment, promotion, project moves).\n\n- \`registry.json\` — \`projects\` (name → path) + \`members\` (name → identity)\n- \`roles/\` — shared role specs, evolved by their wearers\n`,
			);
			const skeleton: OrgRegistry = { version: 1, updated: new Date().toISOString().split("T")[0], projects: {}, members: {} };
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

/** Load the org registry; return a fresh skeleton when missing or corrupt. */
export function loadOrgRegistry(env: IdentityEnv): OrgRegistry {
	const registry = path.join(env.orgRoot, "registry.json");
	try {
		if (fs.existsSync(registry)) {
			const parsed = JSON.parse(fs.readFileSync(registry, "utf-8"));
			if (parsed && typeof parsed === "object" && typeof parsed.members === "object" && parsed.members) {
				return parsed as OrgRegistry;
			}
		}
	} catch {
		// fall through to skeleton
	}
	return { version: 1, updated: new Date().toISOString().split("T")[0], projects: {}, members: {} };
}

/** Persist the registry and commit it in the org root repo. */
export function saveOrgRegistry(env: IdentityEnv, reg: OrgRegistry, uuid: string | null): boolean {
	const registry = path.join(env.orgRoot, "registry.json");
	try {
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

/** Upsert a member row in the org registry (thin index — identity content stays in agent.json). */
export function registerMember(env: IdentityEnv, name: string, uuid: string, status: "ephemeral" | "member"): boolean {
	if (!ensureOrgRoot(env, uuid)) return false;
	const reg = loadOrgRegistry(env);
	reg.members[name] = { name, uuid, status, memoryPath: `~/.pi/agents/${name}/memory` };
	return saveOrgRegistry(env, reg, uuid);
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
		let caughtUp = false;
		env.git(["add", "-A"], memoryRoot);
		const staged = env.git(["status", "--porcelain"], memoryRoot);
		if (staged.stdout.trim()) {
			if (!isNew) {
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
