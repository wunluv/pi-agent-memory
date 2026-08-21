/**
 * Memory path canonicalization — the single .md form for every memory file.
 *
 * Node built-ins only, zero deps, so it is unit-testable in isolation.
 * This is the write/read boundary that enforces #32: a memory file always has
 * exactly one canonical spelling (lowercase, .md), so extensionless or
 * case-variant writes cannot orphan themselves from memory_search/memory_tree.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Canonical filenames — case-insensitive, single home, no duplication. */
export const RESERVED_FILENAMES = new Set(["status", "wip", "index", "strategy", "wbs"]);

/**
 * Canonicalize a memory path to its single .md form.
 *
 * - appends `.md` when absent:  `reference/status`  → `reference/status.md`
 * - lowercases reserved basenames case-insensitively:
 *   `STATUS.md` → `status.md`, `WIP.md` → `wip.md`
 * - preserves case for non-reserved names: `MyNotes.md` stays `MyNotes.md`
 * - refuses non-`.md` extensions: `foo.json` → throws
 */
export function canonicalizeMemoryPath(filePath: string): string {
	const dir = path.dirname(filePath);
	let base = path.basename(filePath);

	const lower = base.toLowerCase();
	if (lower.endsWith(".md")) {
		base = base.slice(0, -3);
	} else if (base.includes(".")) {
		throw new Error(`Memory files must be .md — refused "${filePath}".`);
	}

	const stem = base.toLowerCase();
	if (RESERVED_FILENAMES.has(stem)) base = stem;

	return path.join(dir, base + ".md");
}

/** Write at the canonical .md form, creating directories as needed. Returns the canonical relative path, or null. */
export function writeMemoryFile(filePath: string, content: string, root: string): string | null {
	let canonical: string;
	try {
		canonical = canonicalizeMemoryPath(filePath);
	} catch {
		return null;
	}
	const full = path.join(root, canonical);
	try {
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, "utf-8");
		return canonical;
	} catch {
		return null;
	}
}

/** Read a file relative to a root, resolving to its canonical .md form and detecting ambiguous extension/case siblings. */
export function readMemoryFile(filePath: string, root: string): { content: string; ambiguity: string | null } | null {
	let canonical: string;
	try {
		canonical = canonicalizeMemoryPath(filePath);
	} catch {
		return null;
	}
	const full = path.join(root, canonical);
	let content: string;
	try {
		content = fs.readFileSync(full, "utf-8");
	} catch {
		return null;
	}
	let ambiguity: string | null = null;
	if (canonical !== filePath) {
		const bare = path.join(root, filePath);
		if (bare !== full && fs.existsSync(bare)) {
			ambiguity = `Both "${filePath}" and "${canonical}" exist on disk (differ only by extension/case). Returning "${canonical}".`;
		}
	}
	return { content, ambiguity };
}
