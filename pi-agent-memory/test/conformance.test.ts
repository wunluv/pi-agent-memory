/**
 * Conformance test — governing docs must not instruct agents to use a
 * non-canonical spelling of a reserved memory filename.
 *
 * The canonical memory-file spellings live in paths.ts RESERVED_FILENAMES
 * (all lowercase). A reserved name used as a MEMORY PATH must be lowercase.
 * The repo-root namespace (README.md, AGENTS.md, ARCHITECTURE.md, STATUS.md,
 * docs/WBS.md) is a separate thing and may stay uppercase.
 *
 * Two tiers:
 *   Tier 1 (instruction docs — AGENTS.md, prompts/*.md, README.md):
 *     any reserved basename spelled with uppercase + ".md" is drift, except
 *     the explicit whitelist of legitimate repo-doc references.
 *   Tier 2 (ALL docs incl. SPEC_v4 + docs/):
 *     WIP.md / INDEX.md / STRATEGY.md have no repo-doc counterpart, so an
 *     uppercase spelling is ALWAYS drift.
 *
 * Run with: node test/conformance.test.ts
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RESERVED_FILENAMES, ZONE_A_TOP_LEVEL } from "../paths.ts";

const TEST_DIR = path.resolve(import.meta.dirname);
const PKG_DIR = path.resolve(TEST_DIR, ".."); // pi-agent-memory/
const REPO_ROOT = path.resolve(PKG_DIR, ".."); // agent_memory/

// Reserved names with no repo-doc counterpart — uppercase is drift everywhere.
const ALWAYS_LOWERCASE = new Set(["wip", "index", "strategy"]);

// Reserved names that collide with a repo-root doc — uppercase is drift only
// in instruction docs (Tier 1), not in the spec that documents the distinction.
const TIER1_ONLY = new Set(["status", "wbs"]);

const INSTRUCTION_DOCS = [
  path.join(REPO_ROOT, "AGENTS.md"),
  path.join(PKG_DIR, "README.md"),
  path.join(PKG_DIR, "prompts", "system.md"),
  path.join(PKG_DIR, "prompts", "startwork.md"),
  path.join(PKG_DIR, "prompts", "endwork.md"),
  path.join(PKG_DIR, "prompts", "init-memory.md"),
];

const ALL_DOCS = [
  ...INSTRUCTION_DOCS,
  path.join(REPO_ROOT, "SPEC_v4.md"),
  path.join(REPO_ROOT, "docs", "DATA-MODEL.md"),
  path.join(REPO_ROOT, "docs", "TECHNICAL.md"),
  path.join(REPO_ROOT, "docs", "EXPLAINED.md"),
  path.join(REPO_ROOT, "docs", "IMPROVEMENT-DRAFTS.md"),
];

// Legitimate uppercase repo-doc references. Each entry is an exact trimmed
// line; if a line shifts, the test fails and a human re-justifies it.
const WHITELIST: Array<{ file: string; line: string; reason: string }> = [
  {
    file: path.join(REPO_ROOT, "AGENTS.md"),
    line: "WBS.md                Work breakdown structure",
    reason: "docs/WBS.md repo doc in the Files map, not a memory path",
  },
];

// Old sync-config field name, renamed to push_on_commit (2026-08-14). Its
// appearance in a live (non-archive, non-session-export) doc is drift.
const STALE_CONFIG_FIELDS = ["push_on_write"];

type Hit = { file: string; lineNo: number; stem: string; text: string };

function uppercaseReservedHits(file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  const re = /\b([A-Za-z]+)\.md\b/g;
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const stem = m[1];
      const lower = stem.toLowerCase();
      if (RESERVED_FILENAMES.has(lower) && stem !== lower) {
        hits.push({ file, lineNo: i + 1, stem, text: line.trim() });
      }
    }
  });
  return hits;
}

function whitelisted(hit: Hit): boolean {
  return WHITELIST.some(
    (w) => w.file === hit.file && w.line === hit.text
  );
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

function formatHits(hits: Hit[]): string {
  return hits
    .map((h) => `    ${path.relative(REPO_ROOT, h.file)}:${h.lineNo}  "${h.stem}.md"`)
    .join("\n");
}

test("Tier 1: instruction docs use lowercase reserved memory filenames", () => {
  const bad: Hit[] = [];
  for (const file of INSTRUCTION_DOCS) {
    if (!fs.existsSync(file)) continue;
    for (const hit of uppercaseReservedHits(file)) {
      if (!whitelisted(hit)) bad.push(hit);
    }
  }
  assert.equal(
    bad.length,
    0,
    `Uppercase reserved memory filenames in instruction docs (canonical is lowercase):\n${formatHits(bad)}`
  );
});

test("Tier 2: WIP/INDEX/STRATEGY are never uppercase in any doc", () => {
  const bad: Hit[] = [];
  for (const file of ALL_DOCS) {
    if (!fs.existsSync(file)) continue;
    for (const hit of uppercaseReservedHits(file)) {
      if (ALWAYS_LOWERCASE.has(hit.stem.toLowerCase())) bad.push(hit);
    }
  }
  assert.equal(
    bad.length,
    0,
    `Uppercase spelling has no repo-doc counterpart and is always drift:\n${formatHits(bad)}`
  );
});

test("every whitelist entry is a real, still-present line", () => {
  for (const w of WHITELIST) {
    assert.ok(
      fs.existsSync(w.file),
      `Whitelisted file missing: ${w.file}`
    );
    const lines = fs.readFileSync(w.file, "utf-8").split("\n").map((l) => l.trim());
    assert.ok(
      lines.includes(w.line),
      `Whitelist line no longer present (update or remove it):\n  ${w.file}\n  "${w.line}"`
    );
  }
});

test("Tier 3: no stale sync-config field names in live docs", () => {
  const bad: string[] = [];
  for (const file of INSTRUCTION_DOCS.concat([
    path.join(REPO_ROOT, "SPEC_v4.md"),
    path.join(REPO_ROOT, "docs", "DATA-MODEL.md"),
    path.join(REPO_ROOT, "docs", "TECHNICAL.md"),
  ])) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    lines.forEach((line, i) => {
      for (const field of STALE_CONFIG_FIELDS) {
        if (line.includes(field)) {
          bad.push(`${path.relative(REPO_ROOT, file)}:${i + 1}  "${field}"`);
        }
      }
    });
  }
  assert.equal(
    bad.length,
    0,
    `Stale sync-config field name (renamed to push_on_commit) in live docs:\n${bad.map((b) => `    ${b}`).join("\n")}`
  );
});

test("Tier 4: Zone A on disk holds only system/ + knowledge/", () => {
  const activePath = path.join(os.homedir(), ".pi", "agents", "active");
  if (!fs.existsSync(activePath)) return; // no Zone A on this machine — skip
  const active = fs.readFileSync(activePath, "utf-8").trim();
  const zoneA = path.join(os.homedir(), ".pi", "agents", active, "memory");
  if (!fs.existsSync(zoneA)) return; // skip

  const bad: string[] = [];
  for (const entry of fs.readdirSync(zoneA)) {
    if (entry === ".git" || entry === "agent.json") continue; // pi-managed, not memory_write targets
    if (!ZONE_A_TOP_LEVEL.has(entry.toLowerCase())) bad.push(entry);
  }
  assert.equal(
    bad.length,
    0,
    `Zone A has non-whitelisted top-level entries (project content?): ${bad.join(", ")}`
  );
});
