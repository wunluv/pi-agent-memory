/**
 * Tests for gitignore.ts — the .memory/ boundary (#38).
 * Run with: node test/gitignore.test.ts
 *
 * Uses real git against sandboxed tmp dirs to exercise the tracked-detection.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cp from "node:child_process";
import { ensureMemoryIgnored, MEMORY_IGNORE_ENTRY } from "../gitignore.ts";

const git = (args: string[], cwd: string) => {
	const r = cp.spawnSync("git", args, { cwd, encoding: "utf-8" });
	return { code: r.status ?? 1 };
};
const isRepo = (p: string) => fs.existsSync(path.join(p, ".git"));

function tmp(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "gitignore-"));
	cp.spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf-8" });
	return root;
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

test("creates .gitignore with the .memory/ entry when absent", () => {
	const root = tmp();
	const r = ensureMemoryIgnored(root, git, isRepo);
	assert.equal(r.ok, true);
	assert.equal(r.added, true);
	assert.equal(r.tracked, false);
	const content = fs.readFileSync(path.join(root, ".gitignore"), "utf-8");
	assert.match(content, /\.memory\//);
});

test("appends the entry to an existing .gitignore that lacks it", () => {
	const root = tmp();
	fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n.env\n", "utf-8");
	const r = ensureMemoryIgnored(root, git, isRepo);
	assert.equal(r.added, true);
	const content = fs.readFileSync(path.join(root, ".gitignore"), "utf-8");
	assert.match(content, /\.memory\//);
	assert.match(content, /dist\//); // preserved existing
});

test("no-op when the entry is already present", () => {
	const root = tmp();
	fs.writeFileSync(path.join(root, ".gitignore"), `${MEMORY_IGNORE_ENTRY}\n`, "utf-8");
	const r = ensureMemoryIgnored(root, git, isRepo);
	assert.equal(r.ok, true);
	assert.equal(r.added, false);
	assert.equal(r.tracked, false);
});

test("refuses when .memory/ is already git-tracked", () => {
	const root = tmp();
	fs.mkdirSync(path.join(root, ".memory"), { recursive: true });
	fs.writeFileSync(path.join(root, ".memory", "x.md"), "# x", "utf-8");
	cp.spawnSync("git", ["add", ".memory/x.md"], { cwd: root, encoding: "utf-8" });
	cp.spawnSync("git", ["commit", "-q", "-m", "track memory"], { cwd: root, encoding: "utf-8" });
	const r = ensureMemoryIgnored(root, git, isRepo);
	assert.equal(r.ok, false);
	assert.equal(r.tracked, true);
});

test("still writes .gitignore when the project is not a git repo", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "gitignore-norepo-"));
	const r = ensureMemoryIgnored(root, git, isRepo);
	assert.equal(r.ok, true);
	assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf-8"), /\.memory\//);
});