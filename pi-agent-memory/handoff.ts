/**
 * #50 + #82: the state-file contract — `.memory/session/latest.md`.
 *
 * Rolling single file, overwritten each session; git holds the history.
 * Written by the agent via memory_write (frontmatter stamps date + agent_id).
 * `/endwork` gates on existence + currency (dated today) before clearing the
 * session root. `/startwork` surfaces it first.
 *
 * #82 made this the project's ONLY state file: `reference/status.md` retired, so
 * the durable "what is live / built / blocked" content that used to live there
 * now lives in `## Current state` here. That is a real risk on a file that gets
 * overwritten every session — if a session rewrites the body without carrying
 * the state forward, the file (not git) loses it. So the four section headings
 * are checked, not just the date: `missingSections` is reported by `/endwork`.
 *
 * The frontmatter `updated` field (created fallback) is the machine-checkable
 * date; the body carries the schema below.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const SESSION_HANDOFF_PATH = "session/latest.md";

/**
 * #82: the four sections the state file must carry. `## Current state` is the
 * durable half inherited from the retired `reference/status.md`; the other
 * three are #50's handoff schema. Order is the order they are reported in.
 */
export const REQUIRED_HANDOFF_SECTIONS = [
	"## Current state",
	"## Decisions made",
	"## Open threads",
	"## Next actions",
] as const;

export interface SessionHandoff {
	content: string;   // body without frontmatter
	updated: string;   // YYYY-MM-DD from frontmatter updated (created fallback), "" when absent
	current: boolean;  // updated === today
	/** Required headings absent from the body. Empty when the schema is complete. */
	missingSections: string[];
}

/**
 * Which required headings the body lacks. Case-insensitive, `##` level only,
 * and tolerant of a trailing qualifier (`## Current state (2026-09-29)`) so a
 * dated heading still counts. A missing section is a warning, never a refusal:
 * the file is overwritten wholesale, so an incomplete rewrite must be visible
 * rather than silently accepted.
 */
function findMissingSections(body: string): string[] {
	const headings = body
		.split("\n")
		.map((line) => line.trim().toLowerCase())
		.filter((line) => line.startsWith("## "));
	return REQUIRED_HANDOFF_SECTIONS.filter(
		(section) => !headings.some((heading) => heading.startsWith(section.toLowerCase())),
	);
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
	return {
		content: body.trim(),
		updated,
		current: updated === today,
		missingSections: findMissingSections(body),
	};
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
