/**
 * Tests for discovery.ts — run with: node test/discovery.test.ts
 * Node 22+ strips types natively; no test runner, just node:assert/strict.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoveredByWalkingUp, findNearestMemoryRoot, isProjectMemoryRoot, looksLikeProjectDir, scopeDriftNotice, walkedUpNotice } from "../discovery.ts";

function tempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "discovery-test-"));
}

function test(name: string, fn: () => void): void {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (error) {
		console.error(`not ok - ${name}`);
		throw error;
	}
}

test("finds the nearest .memory while walking up from a nested directory", () => {
	const root = tempDir();
	const project = path.join(root, "project");
	const nested = path.join(project, "src", "feature");
	fs.mkdirSync(nested, { recursive: true });
	fs.mkdirSync(path.join(project, ".memory"));

	assert.equal(findNearestMemoryRoot(nested, path.join(root, ".pi")), path.join(project, ".memory"));
});

test("prefers the nearest memory root when nested projects exist", () => {
	const root = tempDir();
	const outer = path.join(root, "outer");
	const inner = path.join(outer, "inner");
	const nested = path.join(inner, "src");
	fs.mkdirSync(nested, { recursive: true });
	fs.mkdirSync(path.join(outer, ".memory"));
	fs.mkdirSync(path.join(inner, ".memory"));

	assert.equal(findNearestMemoryRoot(nested, path.join(root, ".pi")), path.join(inner, ".memory"));
});

test("returns null when no memory root exists", () => {
	const root = tempDir();
	const nested = path.join(root, "project", "src");
	fs.mkdirSync(nested, { recursive: true });

	assert.equal(findNearestMemoryRoot(nested, path.join(root, ".pi")), null);
});

test("never discovers Zone A under ~/.pi", () => {
	const root = tempDir();
	const piHome = path.join(root, ".pi");
	const nested = path.join(piHome, "agents", "pialph");
	fs.mkdirSync(path.join(nested, ".memory"), { recursive: true });

	assert.equal(findNearestMemoryRoot(nested, piHome), null);
});

// ─── #66: walking up must be detectable from the root's OWNER ──────────────────

test("walking up is detected when cwd is the .memory owner's sibling", () => {
	// The incident: cwd is a sub-project of an org root that owns .memory/.
	const root = tempDir();
	const org = path.join(root, "Heaven");
	const subProject = path.join(org, "godwriting");
	fs.mkdirSync(subProject, { recursive: true });
	fs.mkdirSync(path.join(org, ".memory"));

	const discovered = findNearestMemoryRoot(subProject, path.join(root, ".pi"));
	assert.equal(discovered, path.join(org, ".memory"), "walks up to the org root");
	assert.equal(discoveredByWalkingUp(discovered!, subProject), true, "and says so");
});

test("walking up is NOT reported when cwd owns the root", () => {
	const root = tempDir();
	const project = path.join(root, "project");
	fs.mkdirSync(project, { recursive: true });
	fs.mkdirSync(path.join(project, ".memory"));

	assert.equal(discoveredByWalkingUp(path.join(project, ".memory"), project), false);
});

test("walking up is reported for a nested subdirectory of the owning project", () => {
	// Also true, and harmless: the notice text stays factual in both cases.
	const root = tempDir();
	const project = path.join(root, "project");
	const nested = path.join(project, "src");
	fs.mkdirSync(nested, { recursive: true });
	fs.mkdirSync(path.join(project, ".memory"));

	assert.equal(discoveredByWalkingUp(path.join(project, ".memory"), nested), true);
});

test("a copied memory root does not confuse the owner check", () => {
	// The earlier proposal tested whether the ROOT was an ancestor of cwd. For
	// the incident root it never was, so the check never fired. Guard the shape.
	const root = tempDir();
	const org = path.join(root, "Heaven");
	const subProject = path.join(org, "godwriting");
	fs.mkdirSync(subProject, { recursive: true });
	const memoryRoot = path.join(org, ".memory");
	fs.mkdirSync(memoryRoot);

	assert.equal(subProject.startsWith(memoryRoot), false, "root is a sibling, not an ancestor");
	assert.equal(discoveredByWalkingUp(memoryRoot, subProject), true);
});

// ─── #66: project signals drive only the hint line ────────────────────────────

test("project signals are detected from a single marker", () => {
	const dir = tempDir();
	assert.equal(looksLikeProjectDir(dir), false, "empty dir is not a project");
	fs.writeFileSync(path.join(dir, "README.md"), "# x");
	assert.equal(looksLikeProjectDir(dir), true);

	const gitDir = tempDir();
	fs.mkdirSync(path.join(gitDir, ".git"));
	assert.equal(looksLikeProjectDir(gitDir), true);
});

test("the notice names both paths and only hints at /startwork . for a project", () => {
	const memoryRoot = "/tmp/Heaven/.memory";
	const cwd = "/tmp/Heaven/godwriting";

	const withHint = walkedUpNotice(memoryRoot, cwd, true);
	assert.ok(withHint.includes(memoryRoot), withHint);
	assert.ok(withHint.includes("/tmp/Heaven"), "names the owner");
	assert.ok(withHint.includes(cwd), "names cwd");
	assert.ok(withHint.includes("/startwork ."), withHint);

	const withoutHint = walkedUpNotice(memoryRoot, cwd, false);
	assert.ok(!withoutHint.includes("/startwork ."), "no hint without a project signal");
	assert.ok(withoutHint.includes(cwd), "still names both paths");
});

// ─── #69: which roots the close ritual may target ─────────────────────────────

test("a project .memory/ is a closable root", () => {
	const project = tempDir();
	const memory = path.join(project, ".memory");
	fs.mkdirSync(memory);
	assert.equal(isProjectMemoryRoot(memory), true);
});

test("the agent root and the org root are never closable as a project", () => {
	// /endwork must never consolidate Zone A or the shared org layer.
	const home = tempDir();
	const agentRoot = path.join(home, ".pi", "agents", "pialph", "memory");
	const orgRoot = path.join(home, ".pi", "org");
	fs.mkdirSync(agentRoot, { recursive: true });
	fs.mkdirSync(orgRoot, { recursive: true });

	assert.equal(isProjectMemoryRoot(agentRoot, [agentRoot, orgRoot]), false);
	assert.equal(isProjectMemoryRoot(orgRoot, [agentRoot, orgRoot]), false);
	// The basename check alone already excludes both.
	assert.equal(isProjectMemoryRoot(agentRoot), false);
	assert.equal(isProjectMemoryRoot(orgRoot), false);
});

test("a missing or non-directory root is not closable", () => {
	const dir = tempDir();
	const missing = path.join(dir, ".memory");
	assert.equal(isProjectMemoryRoot(missing), false, "absent");
	assert.equal(isProjectMemoryRoot(null), false, "null");

	const file = path.join(dir, ".memory");
	fs.writeFileSync(file, "not a directory");
	assert.equal(isProjectMemoryRoot(file), false, "a file named .memory");
});

// ─── #69/#62: scope drift is stated, not silent ──────────────────────────────

test("no drift notice when cwd is the owning project or inside it", () => {
	const root = tempDir();
	const project = path.join(root, "project");
	const nested = path.join(project, "src");
	fs.mkdirSync(nested, { recursive: true });
	const memory = path.join(project, ".memory");
	fs.mkdirSync(memory);

	assert.equal(scopeDriftNotice(memory, project), null);
	assert.equal(scopeDriftNotice(memory, nested), null);
});

test("cwd outside the bound project is reported with both paths", () => {
	const root = tempDir();
	const project = path.join(root, "project");
	const elsewhere = path.join(root, "elsewhere");
	fs.mkdirSync(project, { recursive: true });
	fs.mkdirSync(elsewhere, { recursive: true });
	const memory = path.join(project, ".memory");
	fs.mkdirSync(memory);

	const notice = scopeDriftNotice(memory, elsewhere);
	assert.ok(notice, "drift reported");
	assert.ok(notice!.includes(elsewhere), notice!);
	assert.ok(notice!.includes(memory), notice!);
});

console.log("discovery.test.ts — all assertions passed");
