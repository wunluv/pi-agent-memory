#!/usr/bin/env node
/**
 * ss — BM25 session search CLI.
 *
 * Terminal access to Zone C recall. Same engine as the memory_recall tool
 * (searchSessionMessages → rankedSearchDocuments, Okapi BM25 + recency boost).
 * Re-tokenizes the session corpus per query; no persistent index required.
 *
 * Usage:
 *   ss "search text" [count] [--project slug]
 *
 * Examples:
 *   ss "zone a pruning" 5
 *   ss "negotiation" --project --home-wunluv-Desktop-Projects-BTTN--
 *   ss "prompt vault" 20
 */
import * as path from "node:path";
import { searchSessionMessages } from "./session-search.ts";

const SESSIONS_DIR = path.join(process.env.HOME ?? "", ".pi", "agent", "sessions");

function usage(): void {
	console.log(`ss — BM25 session search

Usage:
  ss "search text" [count] [--project slug]

Args:
  query          required. Free-text search across all session JSONL.
  count          optional. Number of hits (default 8).
  --project slug optional. Only hits whose project slug starts with this.

Sessions dir: ${SESSIONS_DIR}`);
}

const args = process.argv.slice(2);
let query = "";
let topN = 8;
let project = "";

for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--project") {
		project = args[++i] ?? "";
	} else if (a === "--help" || a === "-h") {
		usage();
		process.exit(0);
	} else if (/^\d+$/.test(a)) {
		topN = Number(a);
	} else if (!query) {
		query = a;
	}
}

if (!query) {
	usage();
	process.exit(1);
}

const hits = searchSessionMessages(query, SESSIONS_DIR, { topN });
const filtered = project ? hits.filter((h) => h.path.startsWith(project)) : hits;

if (!filtered.length) {
	console.log(`No matches for "${query}"${project ? ` in ${project}` : ""}.`);
	process.exit(0);
}

for (const h of filtered) {
	console.log(`${h.score.toFixed(2)}  ${h.updated}  ${h.path}`);
	console.log(`    ${h.snippet.replace(/\n/g, " ").slice(0, 160)}`);
}
console.log(`\n${filtered.length} hit${filtered.length === 1 ? "" : "s"} (${hits.length} before project filter)`);
