/**
 * Tests for handoff.ts — run with: node test/handoff.test.ts
 * #50: the /endwork → /startwork loop contract (session/latest.md).
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseHandoff, loadSessionHandoff, SESSION_HANDOFF_PATH } from "../handoff.ts";

const TODAY = "2026-08-24";

// ─── parseHandoff ────────────────────────────────────────────────────────────

{
	// #50 schema: body carries Decisions made / Open threads / Next actions;
	// date comes from frontmatter updated (memory_write stamps it).
	const raw = [
		"---",
		'description: "Session handoff"',
		"importance: 3",
		"tags: [\"session\"]",
		"agent_id: 24168a68-e50c-41a9-a9fe-a4e628643a02",
		`created: ${TODAY}`,
		`updated: ${TODAY}`,
		"---",
		"# Session Handoff",
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
	assert.ok(h.content.includes("## Decisions made"), "body keeps the schema sections");
	assert.ok(!h.content.includes("updated:"), "frontmatter stripped from body");
	assert.ok(h.content.includes("1. #47"), "next actions preserved");
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
}

console.log("handoff.test.ts — all assertions passed");
