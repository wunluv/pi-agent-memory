/**
 * Tests for paths.ts — the canonical .md form (#32).
 * Run with: node test/paths.test.ts
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { canonicalizeMemoryPath, readMemoryFile, writeMemoryFile, RESERVED_FILENAMES } from "../paths.ts";

function tmpRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "paths-test-"));
}

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

test("writeMemoryFile writes the canonical .md form", () => {
	const root = tmpRoot();
	const p = writeMemoryFile("reference/status", "# body", root);
	assert.equal(p, "reference/status.md");
	assert.equal(fs.readFileSync(path.join(root, "reference/status.md"), "utf-8"), "# body");
	assert.equal(fs.existsSync(path.join(root, "reference/status")), false);
});

test("writeMemoryFile lowercases reserved names", () => {
	const root = tmpRoot();
	const p = writeMemoryFile("WIP.md", "# wip", root);
	assert.equal(p, "wip.md");
	assert.equal(fs.existsSync(path.join(root, "wip.md")), true);
});

test("writeMemoryFile refuses a non-.md extension", () => {
	const root = tmpRoot();
	assert.equal(writeMemoryFile("foo.json", "x", root), null);
	assert.equal(fs.existsSync(path.join(root, "foo.json")), false);
});

test("readFile resolves a bare name to the canonical .md", () => {
	const root = tmpRoot();
	writeMemoryFile("status", "# status-only", root);
	const r = readMemoryFile("status", root);
	assert.notEqual(r, null);
	assert.equal(r!.content, "# status-only");
	assert.equal(r!.ambiguity, null);
});

test("readFile flags an extension/case sibling as ambiguous", () => {
	const root = tmpRoot();
	writeMemoryFile("status", "# canonical", root); // writes status.md
	fs.writeFileSync(path.join(root, "status"), "# legacy bare", "utf-8"); // bare sibling
	const r = readMemoryFile("status", root);
	assert.notEqual(r, null);
	assert.equal(r!.content, "# canonical"); // returns the .md canonical
	assert.notEqual(r!.ambiguity, null);
	assert.match(r!.ambiguity!, /both "status" and "status.md"/i);
});

test("readFile returns null when missing", () => {
	const root = tmpRoot();
	assert.equal(readMemoryFile("reference/nothing", root), null);
});
