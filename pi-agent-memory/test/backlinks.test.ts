/**
 * Tests for backlinks.ts — run with: node test/backlinks.test.ts
 * Node 22+ strips types natively; no test runner, just node:assert.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	extractWikiLinks,
	findBacklinks,
	normalizeWikiTarget,
} from "../backlinks.ts";

// ─── Normalization ───────────────────────────────────────────────────────────

assert.equal(normalizeWikiTarget("reference/heavencrm/status.md"), "reference/heavencrm/status");
assert.equal(normalizeWikiTarget("reference/heavencrm/status"), "reference/heavencrm/status");
assert.equal(normalizeWikiTarget("/reference/heavencrm/status.md"), "reference/heavencrm/status");
assert.equal(normalizeWikiTarget("./reference/heavencrm/status.md"), "reference/heavencrm/status");
assert.equal(normalizeWikiTarget("reference/heavencrm/status|alias"), "reference/heavencrm/status");
assert.equal(normalizeWikiTarget("reference\\heavencrm\\status.md"), "reference/heavencrm/status");

// ─── Extraction ──────────────────────────────────────────────────────────────

assert.deepEqual(extractWikiLinks("a [[x]] b [[y|z]] c"), ["x", "y|z"]);
assert.deepEqual(extractWikiLinks("no links here"), []);

// ─── Backlinks over a fixture corpus ─────────────────────────────────────────

function makeCorpus(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backlinks-"));
	const write = (rel: string, body: string) => {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, body);
	};

	write("reference/heavencrm/status.md", "# Status\n\nsee [[reference/heavencrm/index]]\n");
	write(
		"reference/heavencrm/index.md",
		"# Index\n\n- [[reference/heavencrm/status.md]]\n- [[reference/heavencrm/status]]\n",
	);
	write("reference/strategy.md", "# Strategy\n\n[[status]]\n");
	write("system/persona.md", "# Persona\n\nno links here\n");
	return dir;
}

// Minimal recursive .md collector, mirroring collectMdFiles in index.ts.
function collectMdFiles(dir: string): string[] {
	const out: string[] = [];
	const walk = (p: string) => {
		for (const e of fs.readdirSync(p, { withFileTypes: true })) {
			const full = path.join(p, e.name);
			if (e.isDirectory()) {
				if (e.name !== ".git" && !e.name.startsWith(".")) walk(full);
			} else if (e.name.endsWith(".md")) {
				out.push(full);
			}
		}
	};
	walk(dir);
	return out;
}

const dir = makeCorpus();
const deps = { collectMdFiles };

const expected = ["reference/heavencrm/index.md", "reference/strategy.md"];

// exact (.md), no-ext, and suffix forms all resolve
assert.deepEqual(findBacklinks("reference/heavencrm/status.md", dir, deps), expected);
assert.deepEqual(findBacklinks("reference/heavencrm/status", dir, deps), expected);

// self-reference is excluded
assert.ok(!expected.includes("reference/heavencrm/status.md"));

// no one links to persona → empty
assert.deepEqual(findBacklinks("system/persona.md", dir, deps), []);

// ─── Ambiguous bare-name links are NOT credited ─────────────────────────────

function makeAmbiguousCorpus(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backlinks-amb-"));
	const write = (rel: string, body: string) => {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, body);
	};
	write("reference/heavencrm/status.md", "# A\n");
	write("reference/xlearn/status.md", "# B\n");
	write("reference/index.md", "# I\n\n[[status]]\n"); // ambiguous bare link
	write("reference/notes.md", "# N\n\n[[reference/heavencrm/status]]\n"); // exact link
	return dir;
}

const amb = makeAmbiguousCorpus();

// "status" is shared by two files → bare [[status]] is ambiguous, not credited;
// the exact link still resolves.
assert.deepEqual(findBacklinks("reference/heavencrm/status.md", amb, deps), ["reference/notes.md"]);
assert.deepEqual(findBacklinks("reference/xlearn/status.md", amb, deps), []);

console.log("backlinks.test.ts — all assertions passed");
