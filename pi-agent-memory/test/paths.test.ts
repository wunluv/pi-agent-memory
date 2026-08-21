/**
 * Tests for paths.ts — the canonical .md form (#32).
 * Run with: node test/paths.test.ts
 */
import * as assert from "node:assert/strict";
import { canonicalizeMemoryPath, RESERVED_FILENAMES } from "../paths.ts";

function test(name: string, fn: () => void) {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (err) {
		console.error(`not ok - ${name}`);
		throw err;
	}
}

test("appends .md when absent", () => {
	assert.equal(canonicalizeMemoryPath("reference/status"), "reference/status.md");
	assert.equal(canonicalizeMemoryPath("status"), "status.md");
	assert.equal(canonicalizeMemoryPath("reference/heavenletters/status"), "reference/heavenletters/status.md");
});

test("passes through an existing .md path", () => {
	assert.equal(canonicalizeMemoryPath("reference/status.md"), "reference/status.md");
	assert.equal(canonicalizeMemoryPath("foo.md"), "foo.md");
});

test("lowercases reserved filenames case-insensitively", () => {
	assert.equal(canonicalizeMemoryPath("STATUS.md"), "status.md");
	assert.equal(canonicalizeMemoryPath("Status.md"), "status.md");
	assert.equal(canonicalizeMemoryPath("WIP.md"), "wip.md");
	assert.equal(canonicalizeMemoryPath("STRATEGY"), "strategy.md");
	assert.equal(canonicalizeMemoryPath("reference/INDEX"), "reference/index.md");
	assert.equal(canonicalizeMemoryPath("WBS.md"), "wbs.md");
});

test("preserves case for non-reserved names", () => {
	assert.equal(canonicalizeMemoryPath("MyNotes.md"), "MyNotes.md");
	assert.equal(canonicalizeMemoryPath("README.md"), "README.md");
	assert.equal(canonicalizeMemoryPath("MyNotes"), "MyNotes.md");
});

test("refuses non-.md extensions", () => {
	assert.throws(() => canonicalizeMemoryPath("foo.json"));
	assert.throws(() => canonicalizeMemoryPath("data.txt"));
	assert.throws(() => canonicalizeMemoryPath("archive/notes.pdf"));
});

test("reserved set is the documented five", () => {
	assert.deepEqual([...RESERVED_FILENAMES].sort(), ["index", "status", "strategy", "wbs", "wip"]);
});
