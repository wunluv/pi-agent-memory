/**
 * Tests for identity.ts — run with: node test/identity.test.ts
 * Node 22+ strips types natively; no test runner, just node:assert/strict.
 *
 * Uses real git against sandboxed tmp dirs so commit authorship (the
 * provenance contract) is actually exercised, not mocked.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cp from "node:child_process";
import {
	shortUuid,
	loadAgentIdentity,
	loadOrgRegistry,
	saveOrgRegistry,
	ensureAgentIdentity,
	type IdentityEnv,
	type GitFn,
} from "../identity.ts";

const git: GitFn = (args, cwd) => {
	const r = cp.spawnSync("git", args, { cwd, encoding: "utf-8" });
	return { stdout: r.stdout || "", stderr: r.stderr || "", code: r.status ?? 1 };
};

function makeEnv(): IdentityEnv {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "identity-"));
	return {
		agentsDir: path.join(root, "agents"),
		orgRoot: path.join(root, "org"),
		git,
	};
}

function lastCommit(cwd: string): { author: string; subject: string } {
	const author = git(["log", "-1", "--format=%an <%ae>"], cwd).stdout.trim();
	const subject = git(["log", "-1", "--format=%s"], cwd).stdout.trim();
	return { author, subject };
}

function subjects(cwd: string): string[] {
	return git(["log", "--format=%s"], cwd).stdout.trim().split("\n").filter(Boolean);
}

// ─── shortUuid ────────────────────────────────────────────────────────────────

assert.equal(shortUuid("550e8400-e29b-41d4-a716-446655440000"), "550e8400");

// ─── fresh init (isNew=true) ─────────────────────────────────────────────────

{
	const env = makeEnv();
	const res = ensureAgentIdentity(env, "alpha", true);
	assert.ok(res, "ensureAgentIdentity returns a summary");
	assert.ok(res.uuid, "generates a uuid");
	assert.equal(res.kept, false);
	assert.equal(res.isNew, true);
	assert.equal(res.registered, true);
	assert.equal(res.status, "ephemeral");

	// agent.json written with the uuid
	const agentJson = JSON.parse(
		fs.readFileSync(path.join(env.agentsDir, "alpha", "memory", "agent.json"), "utf-8"),
	);
	assert.equal(agentJson.uuid, res.uuid);
	assert.equal(agentJson.name, "alpha");

	// thin index: org registry holds the member row, not the identity content
	const reg = loadOrgRegistry(env);
	assert.ok(reg.members.alpha);
	assert.equal(reg.members.alpha.uuid, res.uuid);
	assert.equal(reg.members.alpha.status, "ephemeral");
	assert.equal(reg.members.alpha.memoryPath, "~/.pi/agents/alpha/memory");

	// agent repo git author = agent-<short>
	const agentRepo = path.join(env.agentsDir, "alpha", "memory");
	assert.equal(git(["config", "user.name"], agentRepo).stdout.trim(), `agent-${shortUuid(res.uuid)}`);
	assert.equal(lastCommit(agentRepo).subject, 'init: Agent "alpha" memory system setup');

	// org root commit authored by the acting agent (provenance contract, #27)
	assert.equal(lastCommit(env.orgRoot).author, `agent-${shortUuid(res.uuid)} <${res.uuid}@pi.local>`);

	// roles/ is tracked (#26)
	assert.ok(fs.existsSync(path.join(env.orgRoot, "roles", ".gitkeep")));
}

// ─── re-init idempotency: UUID kept, no new commit ───────────────────────────

{
	const env = makeEnv();
	const first = ensureAgentIdentity(env, "alpha", true);
	assert.ok(first);
	const agentRepo = path.join(env.agentsDir, "alpha", "memory");
	const before = git(["rev-list", "--count", "HEAD"], agentRepo).stdout.trim();

	const second = ensureAgentIdentity(env, "alpha", false);
	assert.ok(second);
	assert.equal(second.uuid, first.uuid, "uuid is never regenerated");
	assert.equal(second.kept, true);

	const after = git(["rev-list", "--count", "HEAD"], agentRepo).stdout.trim();
	assert.equal(after, before, "re-init is a no-op commit-wise");
}

// ─── legacy backfill (existing system/, no agent.json) ───────────────────────

{
	const env = makeEnv();
	const agentRepo = path.join(env.agentsDir, "beta", "memory");
	fs.mkdirSync(path.join(agentRepo, "system", "human"), { recursive: true });
	fs.writeFileSync(path.join(agentRepo, "system", "persona.md"), "# Persona\n");
	git(["init"], agentRepo);
	git(["config", "user.name", "legacy-agent"], agentRepo);
	git(["config", "user.email", "legacy@pi.local"], agentRepo);
	git(["add", "-A"], agentRepo);
	git(["commit", "-m", "seed"], agentRepo);

	// accumulated, uncommitted memory (the 69-file live case, trimmed to 1)
	fs.writeFileSync(path.join(agentRepo, "system", "notes.md"), "# Notes\n");

	const res = ensureAgentIdentity(env, "beta", false);
	assert.ok(res);
	assert.equal(res.kept, false);
	assert.equal(res.caughtUp, true);

	// catch-up commit lands first (accumulated memory, NOT agent.json),
	// then the identity commit (#28)
	assert.deepEqual(subjects(agentRepo), [
		"identity: backfill agent.json for beta",
		"memory: catch-up commit (accumulated agent memory)",
		"seed",
	]);

	// agent.json was NOT swept into the catch-up commit
	const catchUpFiles = git(["show", "--name-only", "--format=", "HEAD~1"], agentRepo).stdout.trim().split("\n").filter(Boolean);
	assert.deepEqual(catchUpFiles, ["system/notes.md"]);

	// backfilled agent is registered in the org too
	assert.ok(loadOrgRegistry(env).members.beta);
}

// ─── promote flip (registry is source of truth) ──────────────────────────────

{
	const env = makeEnv();
	const res = ensureAgentIdentity(env, "gamma", true);
	assert.ok(res);

	const reg = loadOrgRegistry(env);
	assert.equal(reg.members.gamma.status, "ephemeral");
	reg.members.gamma.status = "member";
	assert.ok(saveOrgRegistry(env, reg, res.uuid));

	assert.equal(loadOrgRegistry(env).members.gamma.status, "member");
}

// ─── loadAgentIdentity null cases ────────────────────────────────────────────

{
	const env = makeEnv();
	assert.equal(loadAgentIdentity(env, null), null);
	assert.equal(loadAgentIdentity(env, "does-not-exist"), null);
}

console.log("identity.test.ts — all assertions passed");
