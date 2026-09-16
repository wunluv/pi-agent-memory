/**
 * Tests for scope.ts — run with: node test/scope.test.ts
 * Node 22+ strips types natively; no test runner, just node:assert/strict.
 *
 * Pure module: the ladder, the drift gate, and the two renderers. The wiring
 * into the real tool handlers is covered by test/scope-results.test.ts.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { renderScope, renderScopeBlock, resolveScope, scopeDetails, shortenHome } from "../scope.ts";

function test(name: string, fn: () => void): void {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (error) {
		console.error(`not ok - ${name}`);
		throw error;
	}
}

function tempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "scope-test-"));
}

/** A project directory with a real .memory/, plus HOME standing in for the agent root. */
function fixture() {
	const home = tempDir();
	const project = path.join(home, "DEV", "proj");
	const projectMemory = path.join(project, ".memory");
	const agentRoot = path.join(home, ".pi", "agents", "testagent", "memory");
	fs.mkdirSync(projectMemory, { recursive: true });
	fs.mkdirSync(agentRoot, { recursive: true });
	return { home, project, projectMemory, agentRoot, nested: path.join(project, "src") };
}

test("the ladder prefers an explicit root over session, discovery and agent", () => {
	const f = fixture();
	const scope = resolveScope({
		explicitRoot: f.projectMemory,
		sessionRoot: path.join(tempDir(), "other", ".memory"),
		autoDiscoveredRoot: path.join(tempDir(), "third", ".memory"),
		agentRoot: f.agentRoot,
		cwd: f.project,
		home: f.home,
	});
	assert.equal(scope?.root, f.projectMemory);
	assert.equal(scope?.kind, "override");
	assert.equal(scope?.zone, "Zone B (override)");
});

test("the ladder falls through to the agent root when nothing else resolves", () => {
	const f = fixture();
	const scope = resolveScope({
		explicitRoot: null,
		sessionRoot: null,
		autoDiscoveredRoot: null,
		agentRoot: f.agentRoot,
		cwd: f.project,
		home: f.home,
	});
	assert.equal(scope?.root, f.agentRoot);
	assert.equal(scope?.kind, "agent");
	assert.equal(scope?.zone, "Zone A (agent)");
});

test("the ladder returns null when no root resolves at all", () => {
	const scope = resolveScope({
		explicitRoot: null,
		sessionRoot: null,
		autoDiscoveredRoot: null,
		agentRoot: null,
		cwd: "/tmp",
		home: "/home/nobody",
	});
	assert.equal(scope, null);
});

test("a session root is Zone B (session) and carries its origin", () => {
	const f = fixture();
	const scope = resolveScope({
		explicitRoot: null,
		sessionRoot: f.projectMemory,
		autoDiscoveredRoot: null,
		agentRoot: f.agentRoot,
		cwd: f.project,
		home: f.home,
	});
	assert.equal(scope?.zone, "Zone B (session)");
	assert.match(scope!.origin, /startwork/);
});

test("no drift when cwd is the owning project or inside it", () => {
	const f = fixture();
	for (const cwd of [f.project, f.nested]) {
		const scope = resolveScope({
			explicitRoot: null,
			sessionRoot: f.projectMemory,
			autoDiscoveredRoot: null,
			agentRoot: f.agentRoot,
			cwd,
			home: f.home,
		});
		assert.equal(scope?.drift, null, `no drift for ${cwd}`);
	}
});

test("drift is reported when cwd has left the bound project, naming both paths", () => {
	const f = fixture();
	const elsewhere = path.join(f.home, "somewhere-else");
	fs.mkdirSync(elsewhere, { recursive: true });
	const scope = resolveScope({
		explicitRoot: null,
		sessionRoot: f.projectMemory,
		autoDiscoveredRoot: null,
		agentRoot: f.agentRoot,
		cwd: elsewhere,
		home: f.home,
	});
	assert.ok(scope?.drift, "drift reported");
	assert.ok(scope!.drift!.includes(elsewhere), "names cwd");
	assert.ok(scope!.drift!.includes("outside"), "explains the drift");
	assert.ok(scope!.drift!.includes("root=<path>"), "names the one-off escape for the model");
	assert.ok(scope!.drift!.includes("/startwork"), "names the rebind for the human");
});

test("an explicit root never reports drift, even from a distant cwd", () => {
	const f = fixture();
	const scope = resolveScope({
		explicitRoot: f.projectMemory,
		sessionRoot: null,
		autoDiscoveredRoot: null,
		agentRoot: f.agentRoot,
		cwd: path.join(f.home, "elsewhere"),
		home: f.home,
	});
	assert.equal(scope?.drift, null, "root= is a deliberate choice");
});

test("the agent root never reports drift — its owner is not a place cwd sits", () => {
	const f = fixture();
	const scope = resolveScope({
		explicitRoot: null,
		sessionRoot: null,
		autoDiscoveredRoot: null,
		agentRoot: f.agentRoot,
		cwd: path.join(f.home, "elsewhere"),
		home: f.home,
	});
	assert.equal(scope?.drift, null, "Zone A would otherwise warn on every read");
});

test("renderScope is one compact line and shortens home", () => {
	const f = fixture();
	const scope = resolveScope({
		explicitRoot: null,
		sessionRoot: f.projectMemory,
		autoDiscoveredRoot: null,
		agentRoot: f.agentRoot,
		cwd: f.project,
		home: f.home,
	})!;
	assert.equal(renderScope(scope), `scope: Zone B (session) · ~/DEV/proj/.memory`);
	assert.equal(renderScope(scope, "Searched"), `Searched: Zone B (session) · ~/DEV/proj/.memory`);
});

test("renderScopeBlock appends a blank line and the drift warning when drifted", () => {
	const f = fixture();
	const bound = resolveScope({
		explicitRoot: null,
		sessionRoot: f.projectMemory,
		autoDiscoveredRoot: null,
		agentRoot: f.agentRoot,
		cwd: f.project,
		home: f.home,
	})!;
	assert.equal(renderScopeBlock(bound), `\n\nscope: Zone B (session) · ~/DEV/proj/.memory`);

	const drifted = resolveScope({
		explicitRoot: null,
		sessionRoot: f.projectMemory,
		autoDiscoveredRoot: null,
		agentRoot: f.agentRoot,
		cwd: path.join(f.home, "elsewhere"),
		home: f.home,
	})!;
	assert.ok(renderScopeBlock(drifted).includes("⚠"), "warning glyph present");
});

test("scopeDetails mirrors the render without re-parsing text", () => {
	const f = fixture();
	const scope = resolveScope({
		explicitRoot: f.projectMemory,
		sessionRoot: null,
		autoDiscoveredRoot: null,
		agentRoot: f.agentRoot,
		cwd: f.project,
		home: f.home,
	})!;
	const details = scopeDetails(scope);
	assert.equal(details.root, f.projectMemory);
	assert.equal(details.zone, "Zone B (override)");
	assert.equal(details.kind, "override");
	assert.equal(details.drift, false);
});

test("shortenHome only touches the home prefix", () => {
	assert.equal(shortenHome("/home/san/DEV/x", "/home/san"), "~/DEV/x");
	assert.equal(shortenHome("/home/san", "/home/san"), "~");
	assert.equal(shortenHome("/home/sanx/DEV", "/home/san"), "/home/sanx/DEV", "prefix must be a path segment");
	assert.equal(shortenHome("/tmp/x", "/home/san"), "/tmp/x");
});

console.log("\nall scope tests passed");
