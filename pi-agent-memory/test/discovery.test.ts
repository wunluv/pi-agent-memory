/**
 * Tests for discovery.ts — run with: node test/discovery.test.ts
 * Node 22+ strips types natively; no test runner, just node:assert/strict.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findNearestMemoryRoot } from "../discovery.ts";

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

console.log("discovery.test.ts — all assertions passed");
