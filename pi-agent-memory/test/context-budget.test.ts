/**
 * Tests for context-budget.ts — run with: node test/context-budget.test.ts
 * Node 22+ strips types natively; no test runner, just node:assert.
 */

import * as assert from "node:assert/strict";
import {
	budgetSystemInjection,
	estimateTokens,
	isPinnedSystemFile,
	PINNED_SYSTEM_BASENAMES,
	rankSystemFiles,
	type SystemFileEntry,
} from "../context-budget.ts";

// ─── estimateTokens ──────────────────────────────────────────────────────────

assert.equal(estimateTokens("abcd"), 1);
assert.equal(estimateTokens("abcde"), 2); // ceil(5/4) = 2
assert.equal(estimateTokens(""), 0);

// ─── rankSystemFiles: importance desc, then updated desc ────────────────────

const a: SystemFileEntry = { relPath: "a.md", content: "", importance: 3, updated: "2026-01-01" };
const b: SystemFileEntry = { relPath: "b.md", content: "", importance: 5, updated: "2026-01-01" };
const c: SystemFileEntry = { relPath: "c.md", content: "", importance: 3, updated: "2026-06-01" };
const d: SystemFileEntry = { relPath: "d.md", content: "", importance: 3, updated: "" };

assert.deepEqual(
	rankSystemFiles([a, b, c, d]).map((f) => f.relPath),
	["b.md", "c.md", "a.md", "d.md"], // b (5) first; c, a, d tie on 3 → recency desc, empty last
);

// ─── budgetSystemInjection: greedy fill, lowest cut first ───────────────────

const mk = (rel: string, chars: number, importance: number): SystemFileEntry => ({
	relPath: rel,
	content: "x".repeat(chars),
	importance,
	updated: "2026-01-01",
});

// 100 chars each → 25 tokens each (headerFor overridden to "" for clean math).
const files = [mk("r.md", 100, 3), mk("p.md", 100, 5), mk("q.md", 100, 4)];
const res = budgetSystemInjection(rankSystemFiles(files), 60, () => "");
assert.deepEqual(res.included.map((f) => f.relPath), ["p.md", "q.md"]); // 25 + 25 ≤ 60
assert.deepEqual(res.omitted.map((f) => f.relPath), ["r.md"]);
assert.equal(res.usedTokens, 50);

// ─── first-file guarantee: a single oversized file still gets included ──────

const huge = [mk("big.md", 10_000, 5), mk("small.md", 4, 4)];
const res2 = budgetSystemInjection(rankSystemFiles(huge), 50, () => "");
assert.deepEqual(res2.included.map((f) => f.relPath), ["big.md"]);
assert.deepEqual(res2.omitted.map((f) => f.relPath), ["small.md"]);

// ─── empty input ─────────────────────────────────────────────────────────────

assert.deepEqual(budgetSystemInjection([], 100, () => ""), {
	included: [],
	omitted: [],
	usedTokens: 0,
	pinnedTokens: 0,
});

// ─── pinned spine (#36): exempt from the budget, always in ──

assert.equal(isPinnedSystemFile({ relPath: "projects.md", content: "", importance: 3, updated: "" }), true);
assert.equal(isPinnedSystemFile({ relPath: "human/identity.md", content: "", importance: 4, updated: "" }), true);
assert.equal(isPinnedSystemFile({ relPath: "human/preferences.md", content: "", importance: 4, updated: "" }), false);
assert.equal(isPinnedSystemFile({ relPath: "craft/x.md", content: "", importance: 4, updated: "" }), false);

// A pinned file must survive a tiny budget, even with a huge budgeted file.
const pinch = [
	mk("preferences.md", 600, 4), // budgeted, huge
	mk("projects.md", 2000, 3), // pinned, low importance, large
	mk("index.md", 50, 5), // pinned
];
const pinchRes = budgetSystemInjection(rankSystemFiles(pinch), 100, () => "");
assert.ok(pinchRes.included.some((f) => f.relPath === "projects.md"), "pinned projects.md always injects");
assert.ok(pinchRes.included.some((f) => f.relPath === "index.md"), "pinned index.md always injects");

// Pinned spine is tracked separately and exempt from the budget usedTokens.
const onlyPinned = [mk("projects.md", 80, 3)];
const spineRes = budgetSystemInjection(rankSystemFiles(onlyPinned), 10, () => "");
assert.equal(spineRes.included.map((f) => f.relPath)[0], "projects.md");
assert.equal(spineRes.pinnedTokens, 20);
assert.equal(spineRes.usedTokens, 0);

// The concrete spine set is exactly the documented four.
assert.deepEqual([...PINNED_SYSTEM_BASENAMES].sort(), ["identity.md", "index.md", "persona.md", "projects.md"]);

console.log("context-budget.test.ts — all assertions passed");
