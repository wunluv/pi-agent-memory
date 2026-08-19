/**
 * Backlink resolution for pi-agent-memory.
 *
 * Wiki-links are forward-only today (memory_read lists links *out* of a file).
 * This module adds the reverse edge: given a target file, find every other file
 * that links *to* it. Computed lazily at read time — no persistent index, always
 * fresh, zero state.
 *
 * Link forms resolved (per SPEC_v4 §"[[path]] Wiki-Links" and WBS 1.4.2):
 *   [[reference/heavencrm/status.md]]    — exact, with extension
 *   [[reference/heavencrm/status]]       — exact, no extension
 *   [[status]]                           — suffix (basename) match
 *   [[reference/heavencrm/status|alias]] — alias after "|" ignored
 *
 * Node built-ins only. See docs/IMPROVEMENT-DRAFTS.md §2 and WBS 1.4.2.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

/** Extract [[wiki-link]] targets (raw, before normalization) from a body. */
export function extractWikiLinks(body: string): string[] {
	const links: string[] = [];
	let m: RegExpExecArray | null;
	WIKI_LINK_RE.lastIndex = 0;
	while ((m = WIKI_LINK_RE.exec(body)) !== null) {
		links.push(m[1]);
	}
	return links;
}

/**
 * Normalize a wiki-link target (or a file path) to a comparable key:
 *   - drop alias after "|"
 *   - normalize separators to "/"
 *   - strip leading "./" and "/" (links are memory-root-relative)
 *   - strip trailing slash
 *   - strip a single ".md" extension (case-insensitive)
 */
export function normalizeWikiTarget(target: string): string {
	return target
		.split("|")[0]
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.?\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.md$/i, "");
}

/** Dependency surface so this module stays testable in isolation. */
export interface BacklinkDeps {
	collectMdFiles: (dir: string) => string[];
}

/**
 * Find files that link *to* `targetPath`, relative to `root`.
 * Returns relative paths (sorted, one entry per linking file).
 */
export function findBacklinks(
	targetPath: string,
	root: string,
	deps: BacklinkDeps,
): string[] {
	const target = normalizeWikiTarget(targetPath);
	if (!target) return [];

	const files = deps.collectMdFiles(root);
	const rels = files.map((f) => path.relative(root, f).replace(/\\/g, "/"));

	// A bare [[name]] link (no directory) is ambiguous when several files share
	// that basename — e.g. status.md, WIP.md, WBS.md appear in every project.
	// Only honor a bare-name suffix match when the basename uniquely identifies
	// the target. Exact root-relative links and directory-qualified suffixes
	// are always honored (they carry enough context to be unambiguous).
	const targetBasename = target.split("/").pop() ?? "";
	const bareUnique =
		targetBasename !== "" &&
		rels.filter((r) => normalizeWikiTarget(r).split("/").pop() === targetBasename).length === 1;

	const backlinks: string[] = [];
	for (const file of files) {
		const rel = path.relative(root, file).replace(/\\/g, "/");
		if (normalizeWikiTarget(rel) === target) continue; // self-reference — skip

		let content: string;
		try {
			content = fs.readFileSync(file, "utf-8");
		} catch {
			continue;
		}

		for (const link of extractWikiLinks(content)) {
			const normalized = normalizeWikiTarget(link);
			if (!normalized) continue;
			const exact = normalized === target;
			const bare = !normalized.includes("/");
			const suffix = target.endsWith("/" + normalized) && (!bare || bareUnique);
			if (exact || suffix) {
				backlinks.push(rel);
				break; // one hit per file is enough
			}
		}
	}
	return backlinks.sort();
}
