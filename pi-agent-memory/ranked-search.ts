/**
 * Ranked full-text retrieval for pi-agent-memory.
 *
 * BM25 (Okapi) scoring with importance + recency boosts and snippet extraction.
 * Dependency-free — Node built-ins only. No persistent index: the corpus is
 * re-tokenized per query, which is fast at memory scale (hundreds to
 * low-thousands of markdown files).
 *
 * See docs/IMPROVEMENT-DRAFTS.md §1 and docs/WBS.md 1.4.1.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Tokenization ──────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "nor", "of", "to", "in", "on",
  "at", "with", "this", "that", "is", "are", "was", "were", "be", "been",
  "being", "it", "its", "as", "by", "from", "not", "you", "we", "they",
  "i", "he", "she",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Light suffix-strip stemmer. Recall over precision; no deps.
 * Upgrade path: Porter2 (still dep-free) if merge collisions hurt.
 */
function stem(t: string): string {
  let s = t;
  if (s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.endsWith("sses")) s = s.slice(0, -2);
  else if (s.endsWith("ingly")) s = s.slice(0, -5);
  else if (s.endsWith("edly")) s = s.slice(0, -4);
  else if (s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.endsWith("ly")) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

// ─── Levenshtein (for optional fuzzy query expansion) ──────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Frontmatter {
  description: string;
  importance: number;
  tags: string[];
  created: string;
  updated: string;
  body: string;
}

export interface RankedSearchDeps {
  collectMdFiles: (dir: string) => string[];
  parseFrontmatter: (content: string) => Frontmatter;
}

export interface SearchHit {
  path: string;        // relative to root
  score: number;       // BM25 + boosts (higher = more relevant)
  importance: number;  // 1–5 from frontmatter
  updated: string;     // YYYY-MM-DD from frontmatter
  snippet: string;     // context window around first match
  matchedTerms: string[];
}

/** A searchable document independent of its storage backend. */
export interface RankedTextDocument {
  path: string;
  body: string;
  description?: string;
  importance?: number;
  updated?: string;
}

export interface RankedSearchOptions {
  topN?: number;           // default 10
  recencyHalfLife?: number; // days; default 180
  fuzzy?: boolean;         // expand query with near-miss vocab; default false
  fuzzyMaxDist?: number;   // default 2
}

// ─── Date helper ───────────────────────────────────────────────────────────────

function daysSince(isoDate: string, now = Date.now()): number {
  if (!isoDate) return 365; // unknown age → treat as old
  const d = Date.parse(isoDate + "T00:00:00Z");
  if (isNaN(d)) return 365;
  return Math.max(0, (now - d) / 86_400_000);
}

// ─── Core ──────────────────────────────────────────────────────────────────────

const K1 = 1.5; // term-frequency saturation
const B = 0.75; // length normalization

export function rankedSearch(
  query: string,
  root: string,
  deps: RankedSearchDeps,
  opts: RankedSearchOptions = {},
): SearchHit[] {
  const { collectMdFiles, parseFrontmatter } = deps;
  const files = collectMdFiles(root);
  if (files.length === 0) return [];

  const docs = files.map((f): RankedTextDocument => {
    const rel = path.relative(root, f);
    const content = fs.readFileSync(f, "utf-8");
    const fm = parseFrontmatter(content);
    return { path: rel, body: fm.body, description: fm.description, importance: fm.importance, updated: fm.updated };
  });
  return rankedSearchDocuments(query, docs, opts);
}

/** Rank an arbitrary in-memory corpus with the same BM25 used by memory_search. */
export function rankedSearchDocuments(
  query: string,
  documents: RankedTextDocument[],
  opts: RankedSearchOptions = {},
): SearchHit[] {
  const topN = opts.topN ?? 10;
  const recencyHalfLife = opts.recencyHalfLife ?? 180;
  const fuzzy = opts.fuzzy ?? false;
  const fuzzyMaxDist = opts.fuzzyMaxDist ?? 2;
  if (documents.length === 0) return [];

  const docs = documents.map((document) => {
    // Structure (directory path) is for browsing, not search. Rank on content,
    // description, and filename as a semi-semantic title.
    const filename = path.basename(document.path).replace(/\.md$/, "");
    const tokens = [
      ...tokenize(document.body),
      ...tokenize(document.description ?? ""),
      ...tokenize(filename),
    ].map(stem);
    return {
      path: document.path,
      body: document.body,
      tokens,
      importance: document.importance ?? 3,
      updated: document.updated ?? "",
    };
  });

  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.tokens.length, 0) / N;
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const idf = (term: string): number => {
    const n = df.get(term) ?? 0;
    if (n === 0) return 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  // Fuzzy expansion applies only to query terms absent from the vocabulary.
  let qTerms = [...new Set(tokenize(query).map(stem))];
  if (fuzzy && qTerms.length > 0) {
    const vocab = [...df.keys()];
    const expansions: string[] = [];
    for (const qt of qTerms) {
      if (df.get(qt) || qt.length < 4) continue;
      for (const v of vocab) {
        if (v.length >= 4 && Math.abs(v.length - qt.length) <= fuzzyMaxDist && levenshtein(qt, v) <= fuzzyMaxDist) {
          expansions.push(v);
        }
        if (expansions.length > 200) break;
      }
    }
    qTerms = [...new Set([...qTerms, ...expansions])];
  }

  const results: SearchHit[] = [];
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    const matchedTerms: string[] = [];
    for (const qt of qTerms) {
      const f = tf.get(qt) ?? 0;
      if (f === 0) continue;
      const idfVal = idf(qt);
      if (idfVal === 0) continue;
      const tfNorm = (f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.tokens.length / avgdl)));
      score += idfVal * tfNorm;
      matchedTerms.push(qt);
    }
    if (score === 0) continue;

    const importanceBoost = 1 + (d.importance - 3) * 0.15;
    const recencyBoost = Math.pow(0.5, daysSince(d.updated) / recencyHalfLife);
    score *= importanceBoost * (0.5 + recencyBoost);
    results.push({
      path: d.path,
      score,
      importance: d.importance,
      updated: d.updated,
      snippet: makeSnippet(d.body, qTerms),
      matchedTerms,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}

/** Context window around the first matched term. */
function makeSnippet(body: string, qTerms: string[]): string {
  const lower = body.toLowerCase();
  let best = -1;
  for (const t of qTerms) {
    const i = lower.indexOf(t);
    if (i !== -1) best = best === -1 ? i : Math.min(best, i);
  }
  const clean = body.replace(/\s+/g, " ").trim();
  if (best === -1) return clean.slice(0, 160);
  const start = Math.max(0, best - 60);
  const end = Math.min(clean.length, best + 100);
  return (start > 0 ? "…" : "") + clean.slice(start, end) + (end < clean.length ? "…" : "");
}
