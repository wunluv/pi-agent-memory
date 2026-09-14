/**
 * Session-time discovery of a project's Zone B memory root.
 *
 * Discovery is deliberately a pure filesystem operation. The extension calls
 * it once per session and caches the result, so changing cwd later cannot
 * silently move writes into another project's memory.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Find the nearest `.memory/` directory at or above startPath.
 *
 * The ~/.pi tree is excluded because it contains Zone A agent memory and
 * control-plane data. A project under ~/.pi is therefore required to use an
 * explicit root override rather than being mistaken for Zone B.
 */
export function findNearestMemoryRoot(startPath: string, piHome: string): string | null {
	let current = path.resolve(startPath);
	const excludedRoot = path.resolve(piHome);

	while (true) {
		if (current === excludedRoot || current.startsWith(excludedRoot + path.sep)) return null;

		const candidate = path.join(current, ".memory");
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate;
		} catch {
			// Candidate does not exist or is inaccessible; continue walking.
		}

		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/**
 * Whether discovery had to walk up from cwd to find the root (#66).
 *
 * The root's OWNER is the directory that holds `.memory/`. When the owner is
 * cwd, cwd is the project and the binding is unambiguous. When it is anything
 * else, discovery walked up, and in an org tree that means the root may belong
 * to a project that CONTAINS cwd rather than to cwd itself (the observed case:
 * cwd `~/DEV/Heaven/godwriting`, adopted root `~/DEV/Heaven/.memory`).
 *
 * The root cannot answer this question: `~/DEV/Heaven/.memory` is a sibling of
 * `godwriting`, not an ancestor of it, so testing "is the root an ancestor of
 * cwd" never fires for the incident that motivated the check.
 */
export function discoveredByWalkingUp(memoryRoot: string, cwd: string): boolean {
	return path.resolve(path.dirname(memoryRoot)) !== path.resolve(cwd);
}

/**
 * Project signals, used only to decide whether the notice should offer
 * "run /startwork . to create one". Purely advisory: nothing gates on this.
 */
export function looksLikeProjectDir(dir: string): boolean {
	return [".git", "package.json", "README.md", "AGENTS.md"].some((marker) => {
		try {
			return fs.existsSync(path.join(dir, marker));
		} catch {
			return false;
		}
	});
}

/**
 * The walked-up notice (#66). Names both paths so the human can see the
 * binding before it happens, and never blocks the ritual.
 */
export function walkedUpNotice(memoryRoot: string, cwd: string, cwdIsProject: boolean): string {
	const owner = path.dirname(memoryRoot);
	const hint = cwdIsProject
		? `\n${cwd} looks like a project of its own. Run /startwork . to give it its own .memory/, or /startwork <project-name> to bind a registered one.`
		: "";
	return (
		`Session root is ${memoryRoot} (parent memory at ${owner}).\n` +
		`${cwd} has no .memory/ of its own, so discovery walked up to find this one.` +
		hint
	);
}

/**
 * Whether a path is a project memory root the close ritual may target (#69).
 *
 * Project roots are named `.memory`. That single check already excludes the
 * agent root (`~/.pi/agents/<agent>/memory`) and the org root (`~/.pi/org`),
 * which is the guard #69 requires: `/endwork` must never consolidate Zone A as
 * if it were a project. `excluded` is belt-and-braces for future shapes.
 */
export function isProjectMemoryRoot(candidate: string | null, excluded: Array<string | null> = []): boolean {
	if (!candidate || path.basename(candidate) !== ".memory") return false;
	const resolved = path.resolve(candidate);
	for (const e of excluded) {
		if (e && path.resolve(e) === resolved) return false;
	}
	try {
		return fs.statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Notice when cwd has moved outside the bound project's tree (#69/#62).
 *
 * Returns null in the ordinary case (cwd inside the owning project). The
 * destination never changes mid-session; the point is that the human can see
 * which project was closed when their shell has moved somewhere else.
 */
export function scopeDriftNotice(memoryRoot: string, cwd: string): string | null {
	const owner = path.resolve(path.dirname(memoryRoot));
	const here = path.resolve(cwd);
	if (here === owner || here.startsWith(owner + path.sep)) return null;
	return `Note: cwd is ${here}, outside ${owner}. This session was bound to ${memoryRoot}, which is where its writes landed.`;
}
