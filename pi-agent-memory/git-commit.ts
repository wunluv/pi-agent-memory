/**
 * Commit outcome reporting (#103).
 *
 * `gitCommit` returned a bare boolean that every caller discarded, so `memory_write` replied
 * "wrote X and committed" whether or not a commit happened. Two ways that happened with no
 * misconfiguration at all: the body was byte-identical to HEAD, so git had nothing to commit, or the
 * path was gitignored, so `git add` refused. Both left the file on disk and reported success.
 *
 * This module separates two questions that were previously one:
 *   - what did git actually do (`commitFile`)
 *   - what is the agent told (`commitReply`)
 *
 * Splitting them means both can be tested against real git without booting the extension, and the
 * reply wording lives in one place instead of being rebuilt at each call site.
 *
 * "Nothing to commit" is reported as `unchanged`, not as a failure: git signals it with a failing exit
 * code, but a write that changed nothing is not an error the caller needs to act on.
 */

import * as path from "node:path";

export type CommitOutcome =
	| { status: "committed" }
	| { status: "unchanged" }
	| { status: "failed"; step: "add" | "commit"; detail: string };

export interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
}

/** The shape of the injected git runner (see `git()` in index.ts), kept narrow for testing. */
export type GitRunner = (args: string[], cwd: string, timeoutMs?: number) => GitResult;

const NOTHING_TO_COMMIT = /nothing to commit|no changes added to commit|nothing added to commit/i;
const DETAIL_LIMIT = 200;

/**
 * The one useful line out of a git failure. git puts the reason on stderr and follows it with `hint:`
 * lines that say what to do next; the reason is what the caller needs, the advice is not.
 */
function detailOf(result: GitResult): string {
	const lines = `${result.stderr}\n${result.stdout}`.split("\n").map((line) => line.trim());
	const reason = lines.find((line) => line !== "" && !line.toLowerCase().startsWith("hint:"));
	if (!reason) return "git gave no output";
	return reason.length > DETAIL_LIMIT ? `${reason.slice(0, DETAIL_LIMIT)}…` : reason;
}

export function commitFile(git: GitRunner, filePath: string, message: string, root: string): CommitOutcome {
	const relPath = path.relative(root, filePath);

	const add = git(["add", relPath], root);
	if (add.code !== 0) return { status: "failed", step: "add", detail: detailOf(add) };

	const commit = git(["commit", "-m", message], root);
	if (commit.code === 0) return { status: "committed" };
	if (NOTHING_TO_COMMIT.test(`${commit.stdout}\n${commit.stderr}`)) return { status: "unchanged" };

	return { status: "failed", step: "commit", detail: detailOf(commit) };
}

/**
 * The reply the agent sees. Stated affirmatively about what did happen, and explicit about what did
 * not: on failure the reader is told where the content actually is, because the file is on disk.
 */
export function commitReply(displayPath: string, outcome: CommitOutcome): string {
	switch (outcome.status) {
		case "committed":
			return `\uD83D\uDCDD wrote ${displayPath} and committed.`;
		case "unchanged":
			return `\uD83D\uDCDD wrote ${displayPath}. Unchanged, so there was nothing to commit.`;
		case "failed":
			return outcome.step === "add"
				? `\u26A0\uFE0F wrote ${displayPath} but git would not stage it: ${outcome.detail}. The file is on disk and not versioned.`
				: `\u26A0\uFE0F wrote ${displayPath} but the commit failed: ${outcome.detail}. The file is on disk and uncommitted.`;
	}
}
