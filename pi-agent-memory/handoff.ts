/**
 * #50: session handoff contract — `.memory/session/latest.md`.
 *
 * Rolling single file, overwritten each session; git holds the history.
 * Written by the agent via memory_write (frontmatter stamps date + agent_id).
 * `/endwork` gates on existence + currency (dated today) before clearing the
 * session root. `/startwork` surfaces it first.
 *
 * The frontmatter `updated` field (created fallback) is the machine-checkable
 * date; the body carries the human-curated schema: Decisions made, Open
 * threads, Next actions (top 3).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const SESSION_HANDOFF_PATH = "session/latest.md";

export interface SessionHandoff {
	content: string;   // body without frontmatter
	updated: string;   // YYYY-MM-DD from frontmatter updated (created fallback), "" when absent
	current: boolean;  // updated === today
}

/** Pure parse of a handoff file's raw text. Never throws. */
export function parseHandoff(raw: string, today: string): SessionHandoff {
	const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	const body = fmMatch ? fmMatch[2].trimStart() : raw;
	let updated = "";
	if (fmMatch) {
		for (const line of fmMatch[1].split("\n")) {
			const t = line.trim();
			if (t.startsWith("updated:")) {
				updated = t.slice("updated:".length).trim();
				break;
			}
			if (t.startsWith("created:") && !updated) {
				updated = t.slice("created:".length).trim();
			}
		}
	}
	return { content: body.trim(), updated, current: updated === today };
}

/** Read the handoff from a memory root. Null when absent. */
export function loadSessionHandoff(
	memoryRoot: string,
	today = new Date().toISOString().split("T")[0],
): SessionHandoff | null {
	const file = path.join(memoryRoot, SESSION_HANDOFF_PATH);
	if (!fs.existsSync(file)) return null;
	try {
		return parseHandoff(fs.readFileSync(file, "utf-8"), today);
	} catch {
		return null;
	}
}
