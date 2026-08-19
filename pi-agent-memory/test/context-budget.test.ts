/**
 * Tests for context-budget.ts — run with: node test/context-budget.test.ts
 * Node 22+ strips types natively; no test runner, just node:assert.
 */

import * as assert from "node:assert/strict";
import {
	budgetSystemInjection,
	estimateTokens,
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
});

console.log("context-budget.test.ts — all assertions passed");
