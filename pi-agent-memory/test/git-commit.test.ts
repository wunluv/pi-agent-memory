/**
 * Tests for git-commit.ts — commit outcome reporting (#103).
 * Run with: node test/git-commit.test.ts
 *
 * Real git against sandboxed tmp dirs, same approach as gitignore.test.ts. The point is that the three
 * outcomes are distinguished from git's own behaviour, not from a stub that agrees with us.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cp from "node:child_process";
import { commitFile, commitReply, type GitRunner } from "../git-commit.ts";

const git: GitRunner = (args, cwd) => {
	const r = cp.spawnSync("git", args, { cwd, encoding: "utf-8" });
	return { stdout: r.stdout || "", stderr: r.stderr || "", code: r.status ?? 1 };
};

function tmpRepo(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-commit-"));
	git(["init", "-q"], root);
	git(["config", "user.email", "test@example.com"], root);
	git(["config", "user.name", "test"], root);
	return root;
}

const write = (root: string, rel: string, body: string) => {
	const full = path.join(root, rel);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, body, "utf-8");
	return full;
};

let passed = 0;
function test(name: string, fn: () => void) {
	fn();
	passed++;
	console.log(`  ok  ${name}`);
}

test("new content is committed, and git log shows the file", () => {
	const root = tmpRepo();
	const file = write(root, "note.md", "first\n");

	const outcome = commitFile(git, file, "note: first", root);
	assert.equal(outcome.status, "committed");

	const log = git(["log", "-1", "--stat", "--oneline"], root);
	assert.match(log.stdout, /note\.md/);
	assert.equal(commitReply("note.md", outcome), "\uD83D\uDCDD wrote note.md and committed.");
});

test("identical content is unchanged, not a failure and not a commit", () => {
	const root = tmpRepo();
	const file = write(root, "note.md", "first\n");
	commitFile(git, file, "note: first", root);

	write(root, "note.md", "first\n");
	const outcome = commitFile(git, file, "note: first again", root);

	assert.equal(outcome.status, "unchanged");
	assert.equal(git(["rev-list", "--count", "HEAD"], root).stdout.trim(), "1", "no second commit was made");
	assert.match(commitReply("note.md", outcome), /Unchanged, so there was nothing to commit/);
});

test("an ignored path fails at the add step and says so", () => {
	const root = tmpRepo();
	write(root, ".gitignore", "project_insights/\n");
	commitFile(git, path.join(root, ".gitignore"), "ignore", root);

	const file = write(root, "project_insights/proposals.md", "measured\n");
	const outcome = commitFile(git, file, "proposals", root);

	assert.equal(outcome.status, "failed");
	if (outcome.status !== "failed") throw new Error("unreachable");
	assert.equal(outcome.step, "add");
	assert.match(outcome.detail, /ignored/i);
	const reply = commitReply("project_insights/proposals.md", outcome);
	assert.match(reply, /would not stage it/);
	assert.match(reply, /on disk and not versioned/);
	assert.equal(fs.existsSync(file), true, "the file stays on disk");
});

test("a commit failure reports the commit step, not the add step", () => {
	const root = tmpRepo();
	const file = write(root, "note.md", "first\n");
	commitFile(git, file, "note: first", root);
	write(root, "note.md", "second\n");

	// A failing pre-commit hook is the everyday case: staging works, committing does not.
	const hookDir = path.join(root, ".git", "hooks");
	fs.writeFileSync(path.join(hookDir, "pre-commit"), "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n");
	fs.chmodSync(path.join(hookDir, "pre-commit"), 0o755);

	const outcome = commitFile(git, file, "note: second", root);
	assert.equal(outcome.status, "failed");
	if (outcome.status !== "failed") throw new Error("unreachable");
	assert.equal(outcome.step, "commit");
	assert.match(outcome.detail, /hook says no/);
	assert.match(commitReply("note.md", outcome), /on disk and uncommitted/);
});

test("detail ignores git's hint lines and keeps the reason", () => {
	const root = tmpRepo();
	write(root, ".gitignore", "blocked/\n");
	commitFile(git, path.join(root, ".gitignore"), "ignore", root);
	const file = write(root, "blocked/x.md", "x\n");

	const outcome = commitFile(git, file, "x", root);
	if (outcome.status !== "failed") throw new Error("expected a failure");
	assert.doesNotMatch(outcome.detail, /^hint:/i);
	assert.match(outcome.detail, /ignored/i);
});

console.log(`\n${passed} passed`);
