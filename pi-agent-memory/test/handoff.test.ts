/**
 * Tests for handoff.ts — run with: node test/handoff.test.ts
 * #50: the /endwork → /startwork loop contract (session/latest.md).
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseHandoff, loadSessionHandoff, SESSION_HANDOFF_PATH, REQUIRED_HANDOFF_SECTIONS } from "../handoff.ts";

const TODAY = "2026-08-24";

// ─── parseHandoff ────────────────────────────────────────────────────────────

{
	// #50 + #82 schema: the state file carries all four sections; the date comes
	// from frontmatter updated (memory_write stamps it).
	const raw = [
		"---",
		'description: "Session state and handoff"',
		"importance: 3",
		"tags: [\"session\"]",
		"agent_id: 24168a68-e50c-41a9-a9fe-a4e628643a02",
		`created: ${TODAY}`,
		`updated: ${TODAY}`,
		"---",
		"# Session state",
		"",
		"## Current state",
		"- Live: d5 in-page checkout",
		"",
		"## Decisions made",
		"- Shipped #51 and #46",
		"",
		"## Open threads",
		"- None",
		"",
		"## Next actions (top 3)",
		"1. #47",
		"2. #49",
		"3. #50",
		"",
	].join("\n");

	const h = parseHandoff(raw, TODAY);
	assert.equal(h.current, true);
	assert.equal(h.updated, TODAY);
	assert.deepEqual(h.missingSections, [], "complete schema reports nothing missing");
	assert.ok(h.content.includes("## Current state"), "body keeps the durable section");
	assert.ok(!h.content.includes("updated:"), "frontmatter stripped from body");
	assert.ok(h.content.includes("1. #47"), "next actions preserved");
}

{
	// #82: a pre-amendment handoff (the old 3-section schema) is readable but
	// reports the missing durable section rather than passing silently.
	const raw = [
		"---",
		`updated: ${TODAY}`,
		"---",
		"## Decisions made",
		"- old schema",
		"",
		"## Open threads",
		"- none",
		"",
		"## Next actions",
		"1. x",
		"",
	].join("\n");
	const h = parseHandoff(raw, TODAY);
	assert.equal(h.current, true, "still current — the date is what gates");
	assert.deepEqual(h.missingSections, ["## Current state"]);
}

{
	// #82: matching is case-insensitive and tolerant of a trailing qualifier, so
	// a dated heading still counts. A `###` heading does NOT satisfy a `##`
	// requirement — that is the level check, isolated by omitting the real one.
	const raw = [
		"---",
		`updated: ${TODAY}`,
		"---",
		"## Current State (2026-09-29)",
		"## DECISIONS MADE",
		"### open threads",
		"## Next actions (top 3)",
		"",
	].join("\n");
	const h = parseHandoff(raw, TODAY);
	assert.deepEqual(
		h.missingSections,
		["## Open threads"],
		"case variants satisfy the contract; a ### heading does not",
	);
}

{
	// Every required section is reported when there are no headings at all.
	const h = parseHandoff("just prose, no headings\n", TODAY);
	assert.deepEqual(h.missingSections, [...REQUIRED_HANDOFF_SECTIONS]);
}

{
	// stale handoff (yesterday) → current=false, updated preserved
	const raw = `---\ndescription: "old"\ncreated: 2026-08-23\nupdated: 2026-08-23\n---\n## Decisions made\n- old\n`;
	const h = parseHandoff(raw, TODAY);
	assert.equal(h.current, false);
	assert.equal(h.updated, "2026-08-23");
}

{
	// created fallback when updated is absent
	const raw = `---\ndescription: "no updated"\ncreated: ${TODAY}\n---\nbody\n`;
	const h = parseHandoff(raw, TODAY);
	assert.equal(h.updated, TODAY);
	assert.equal(h.current, true);
}

{
	// no frontmatter at all → body whole, updated empty, not current
	const h = parseHandoff("## Decisions made\n- x\n", TODAY);
	assert.equal(h.updated, "");
	assert.equal(h.current, false);
	assert.equal(h.content, "## Decisions made\n- x");
}

// ─── loadSessionHandoff ──────────────────────────────────────────────────────

{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
	fs.mkdirSync(path.join(root, "session"), { recursive: true });

	// absent → null
	assert.equal(loadSessionHandoff(root, TODAY), null);

	// present + current → surfaced with today's date
	const raw = `---\ndescription: "handoff"\ncreated: ${TODAY}\nupdated: ${TODAY}\n---\n## Open threads\n- ship ritual PR\n`;
	fs.writeFileSync(path.join(root, SESSION_HANDOFF_PATH), raw);
	const h = loadSessionHandoff(root, TODAY);
	assert.ok(h, "file exists → loaded");
	assert.equal(h!.current, true);
	assert.ok(h!.content.includes("ship ritual PR"));

	// garbage content → graceful: parsed, no date, not current (never throws)
	fs.writeFileSync(path.join(root, SESSION_HANDOFF_PATH), "\u0000\u0000\u0000");
	const g = loadSessionHandoff(root, TODAY);
	assert.ok(g, "garbage is still readable, never throws");
	assert.equal(g!.updated, "");
	assert.equal(g!.current, false);
	assert.deepEqual(g!.missingSections, [...REQUIRED_HANDOFF_SECTIONS]);
}

console.log("handoff.test.ts — all assertions passed");
