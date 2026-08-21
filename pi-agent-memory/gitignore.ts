/**
 * The methodology's hard boundary: `.memory/` (agent working memory) must
 * never be committed to a project's public repo. This is the enforcement core
 * for #38 — ensure the project root `.gitignore` excludes `.memory/`, and
 * refuse if `.memory/` is already git-tracked.
 *
 * Node built-ins only, zero deps, so it is unit-testable in isolation.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const MEMORY_IGNORE_ENTRY = ".memory/";
export const MEMORY_IGNORE_HEADER = "# Private agent working memory — never commit, never push.";

/** Minimal git shape this module needs. */
export type IgnoreGit = (args: string[], cwd: string) => { code: number };

export interface IgnoreOutcome {
	ok: boolean;
	/** true if the .gitignore entry was appended just now. */
	added: boolean;
	/** true if `.memory/` was already in the project index → must refuse. */
	tracked: boolean;
}

/**
 * Ensure the project root .gitignore excludes `.memory/`.
 *
 * - If the project is a git repo and `.memory/` is already in its index
 *   (including staged-but-deleted), refuse: `ok: false, tracked: true`.
 * - Otherwise append a `.memory/` entry to `.gitignore` (creating the file
 *   with the header when absent). Idempotent: if the entry is present, no-op.
 */
export function ensureMemoryIgnored(
	projectPath: string,
	git: IgnoreGit,
	isRepo: (p: string) => boolean,
): IgnoreOutcome {
	if (isRepo(projectPath)) {
		const cached = git(["ls-files", "--cached", "--error-unmatch", ".memory", ".memory/"], projectPath);
		if (cached.code === 0) {
			return { ok: false, added: false, tracked: true };
		}
	}

	const gitignorePath = path.join(projectPath, ".gitignore");
	let content = "";
	if (fs.existsSync(gitignorePath)) {
		content = fs.readFileSync(gitignorePath, "utf-8");
	}
	const present = content.split("\n").map((l) => l.trim()).includes(MEMORY_IGNORE_ENTRY);
	if (!present) {
		const block = `${MEMORY_IGNORE_HEADER}\n${MEMORY_IGNORE_ENTRY}\n`;
		fs.appendFileSync(gitignorePath, block, "utf-8");
	}
	return { ok: true, added: !present, tracked: false };
}