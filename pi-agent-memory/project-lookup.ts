/**
 * Zone A `system/projects.md` fallback lookup — the parse and the miss-diagnosis.
 *
 * The org registry (uuid-keyed, see identity.ts `findProjectByName`) is the
 * authoritative name → path source. `system/projects.md` is the demoted
 * human-readable index kept for legacy and hand-authored entries, so it is
 * allowed to be incomplete (#65).
 *
 * Two entry shapes exist in the wild, one complete and one status-only:
 *
 *   - **Godwriting** — Late friend's methodology. Promise to take it online.
 *     Active | Project root: `~/DEV/Heaven/godwriting/` | Project memory: `.../.memory/`
 *   - **Godwriting** — Late friend's methodology. Research phase
 *
 * The second carries no path, which used to interpolate an empty string into a
 * "registered at , but .memory/ wasn't found" warning and then probe
 * path.join("", ".memory") against process cwd — a check that can never be
 * right. Parsing stays pure and the messages live here so both are testable
 * without a live agent root.
 */
import * as os from "node:os";

export interface ProjectEntry {
	name: string;
	path: string;
}

/**
 * Find a project entry by name in the body of `system/projects.md`.
 *
 * Entries begin with `- **Name**`; the path is the first path-like backtick
 * token on a following line (the "Project root: <path>" convention). An entry
 * with no such token is returned with `path: ""` so the caller can name the
 * real cause instead of fabricating one. Does NOT substring-match over prose.
 */
export function findProjectEntryInBody(body: string, name: string, home = os.homedir()): ProjectEntry | null {
	const target = name.toLowerCase();
	let current: ProjectEntry | null = null;

	for (const line of body.split("\n")) {
		// A new project entry begins with "- **Name**"
		const headerMatch = line.match(/^\s*-\s*\*\*(.+?)\*\*/);
		if (headerMatch) {
			if (current && current.name.toLowerCase() === target) return current;
			current = { name: headerMatch[1].split("/")[0].trim(), path: "" };
			continue;
		}
		// First path-looking backtick token on a continuation line under the entry
		if (current && !current.path) {
			const pathMatch = line.match(/`([^`]+)`/);
			if (pathMatch && (pathMatch[1].includes("/") || pathMatch[1].includes("\\"))) {
				current.path = pathMatch[1].replace(/^~/, home);
			}
		}
	}

	if (current && current.name.toLowerCase() === target) return current;
	return null;
}

/** The entry exists but names no path — it cannot be resolved, and never moved. */
export function pathlessEntryMessage(name: string): string {
	return (
		`"${name}" is listed in system/projects.md but has no project path.\n` +
		`Add a "Project root: \`<path>\`" line to its entry, or run /startwork <path-to-project> to register it.`
	);
}

/** The entry names a path, but no `.memory/` lives there. The path is stale. */
export function movedProjectMessage(name: string, entryPath: string): string {
	return (
		`"${name}" is registered at ${entryPath}, but .memory/ wasn't found there.\n` +
		`The project may have moved — cd into it and run /startwork . to reconcile the path.`
	);
}
