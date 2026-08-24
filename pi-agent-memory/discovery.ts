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
