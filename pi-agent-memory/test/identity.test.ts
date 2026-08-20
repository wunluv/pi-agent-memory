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
	lookupProject,
	registerProject,
	ensureProjectUuid,
	findMemberUuid,
	findProjectByName,
	mintProjectUuid,
	readProjectUuid,
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

	// thin index: org registry holds the member row, keyed by uuid, not name
	const reg = loadOrgRegistry(env);
	assert.ok(reg.members[res.uuid]);
	assert.equal(reg.members[res.uuid].name, "alpha");
	assert.equal(reg.members[res.uuid].status, "ephemeral");
	assert.equal(reg.members[res.uuid].memoryPath, "~/.pi/agents/alpha/memory");
	assert.equal(findMemberUuid(env, "alpha"), res.uuid, "name → uuid lookup");

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

	// backfilled agent is registered in the org too (keyed by uuid)
	assert.ok(loadOrgRegistry(env).members[res.uuid]);
}

// ─── legacy backfill on unborn HEAD (zero-commit repo) ───────────────────────
// #29: git restore --staged fails with no HEAD to restore from, which swept
// agent.json into the catch-up commit and silently no-opped the identity commit.
// Guard: skip the split, land a single combined commit.

{
	const env = makeEnv();
	const agentRepo = path.join(env.agentsDir, "delta", "memory");
	fs.mkdirSync(path.join(agentRepo, "system"), { recursive: true });
	fs.writeFileSync(path.join(agentRepo, "system", "persona.md"), "# Persona\n");
	git(["init"], agentRepo); // no commit — unborn HEAD
	git(["config", "user.name", "legacy-agent"], agentRepo);
	git(["config", "user.email", "legacy@pi.local"], agentRepo);

	const res = ensureAgentIdentity(env, "delta", false);
	assert.ok(res);
	assert.equal(res.caughtUp, false, "no catch-up split on unborn HEAD");

	// single combined commit (agent.json + memory), not a silent no-op
	const subjects = git(["log", "--format=%s"], agentRepo).stdout.trim().split("\n").filter(Boolean);
	assert.deepEqual(subjects, ["identity: backfill agent.json for delta"]);

	// agent.json actually landed (not swept into a phantom commit)
	assert.ok(JSON.parse(fs.readFileSync(path.join(agentRepo, "agent.json"), "utf-8")).uuid === res.uuid);
	const committedFiles = git(["show", "--name-only", "--format=", "HEAD"], agentRepo).stdout.trim().split("\n").filter(Boolean);
	assert.ok(committedFiles.includes("agent.json"));
	assert.ok(committedFiles.includes("system/persona.md"));
}

// ─── promote flip (registry is source of truth) ──────────────────────────────

{
	const env = makeEnv();
	const res = ensureAgentIdentity(env, "gamma", true);
	assert.ok(res);

	const reg = loadOrgRegistry(env);
	assert.equal(reg.members[res.uuid].status, "ephemeral");
	reg.members[res.uuid].status = "member";
	assert.ok(saveOrgRegistry(env, reg, res.uuid));

	assert.equal(loadOrgRegistry(env).members[res.uuid].status, "member");
}

// ─── loadAgentIdentity null cases ────────────────────────────────────────────

{
	const env = makeEnv();
	assert.equal(loadAgentIdentity(env, null), null);
	assert.equal(loadAgentIdentity(env, "does-not-exist"), null);
}

// ─── project.json identity: read / ensure / mint ────────────────────────────────

{
	const env = makeEnv();
	const mem = path.join(env.agentsDir, "proj", "memory");
	fs.mkdirSync(mem, { recursive: true });

	// absent → null (legacy, unidentifiable)
	assert.equal(readProjectUuid(mem), null);

	// ensure mints once, then round-trips (idempotent)
	const u1 = ensureProjectUuid(mem);
	assert.ok(u1, "mints a uuid");
	assert.equal(readProjectUuid(mem), u1);
	assert.equal(ensureProjectUuid(mem), u1, "ensure never regenerates");

	// mint force-replaces (fork action)
	const u2 = mintProjectUuid(mem);
	assert.notEqual(u2, u1, "mint gives a fresh uuid");
	assert.equal(readProjectUuid(mem), u2);

	// project.json carries ONLY the uuid — no name, no path
	const parsed = JSON.parse(fs.readFileSync(path.join(mem, "project.json"), "utf-8"));
	assert.deepEqual(Object.keys(parsed).sort(), ["uuid"]);
}

// ─── project registry round-trip (uuid-keyed) ──────────────────────────────────

{
	const env = makeEnv();
	const uuid = "11111111-2222-3333-4444-555555555555";
	assert.equal(lookupProject(env, uuid), null);
	assert.ok(registerProject(env, uuid, "bttn", "/abs/path/bttn"));
	assert.equal(lookupProject(env, uuid)!.path, "/abs/path/bttn");
	assert.equal(findProjectByName(env, "bttn")!.uuid, uuid, "name → uuid lookup");

	// reconcile (re-register) updates the path under the same uuid
	assert.ok(registerProject(env, uuid, "bttn", "/new/path/bttn"));
	assert.equal(lookupProject(env, uuid)!.path, "/new/path/bttn");

	// rename-proof: name is a mutable field, uuid is the stable key
	assert.ok(registerProject(env, uuid, "bttn-renamed", "/new/path/bttn"));
	assert.equal(findProjectByName(env, "bttn"), null);
	assert.equal(findProjectByName(env, "bttn-renamed")!.uuid, uuid);
	assert.equal(lookupProject(env, uuid)!.name, "bttn-renamed");
}

// ─── v1 → v2 migration: name-keyed registry normalizes to uuid-keyed ────────────

{
	const env = makeEnv();
	fs.mkdirSync(env.orgRoot, { recursive: true });
	const memberUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
	fs.writeFileSync(
		path.join(env.orgRoot, "registry.json"),
		JSON.stringify({
			version: 1,
			updated: "2026-08-20",
			projects: { heavencrm: "/home/u/DEV/Heaven/heavencrm", d5: "/home/u/DEV/Heaven/d5" },
			members: { pialph: { name: "pialph", uuid: memberUuid, status: "ephemeral", memoryPath: "~/.pi/agents/pialph/memory" } },
		}, null, 2) + "\n",
	);

	const reg = loadOrgRegistry(env);
	// members re-keyed by uuid
	assert.deepEqual(Object.keys(reg.members), [memberUuid]);
	assert.equal(reg.members[memberUuid].name, "pialph");
	assert.equal(reg.members[memberUuid].status, "ephemeral");
	// v1 projects carried no uuid → dropped (legacy, unidentifiable until #22)
	assert.deepEqual(reg.projects, {});
	assert.deepEqual(reg.humans, {});
	assert.equal(reg.version, 2);
}

console.log("identity.test.ts — all assertions passed");
