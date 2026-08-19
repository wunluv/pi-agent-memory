/**
 * Token budgeting for Zone A system/ injection.
 *
 * buildSystemContext() used to inject every system/*.md wholesale. This module
 * adds the cap: rank by importance then recency, fill greedily up to a budget,
 * and report what was left out (still reachable via memory_tree/memory_read).
 *
 * Token estimate: ~4 chars/token — good enough for budgeting English prose,
 * dependency-free.
 *
 * The budget applies to the variable system/ *data* files only. The fixed
 * system-instructions preamble is always injected on top (it is constant and
 * essential). See SPEC_v4 §2.6, docs/IMPROVEMENT-DRAFTS.md §5, WBS 1.6.1.
 */

export interface SystemFileEntry {
	relPath: string; // path relative to system/, e.g. "human/identity.md"
	content: string; // body text (frontmatter already stripped)
	importance: number; // 1–5 from frontmatter
	updated: string; // YYYY-MM-DD from frontmatter ("" if absent)
}

/**
 * Default budget (tokens) for the system/ data files injected into context.
 * Calibrated to the current corpus (~2,230 tokens: persona + identity + prefs +
 * thin projects index) plus headroom, so no file is evicted today. It guards
 * FUTURE growth: when system/ grows past this, lowest-importance files are cut
 * first (persona, importance 5, is always safe). Override via
 * PI_MEMORY_TOKEN_BUDGET.
 */
export const DEFAULT_TOKEN_BUDGET = 2400;

/** Rough token estimate for budgeting. ~4 chars/token for English prose. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Rank for injection: highest importance first, then most recently updated. */
export function rankSystemFiles(files: SystemFileEntry[]): SystemFileEntry[] {
	return [...files].sort((a, b) => {
		if (b.importance !== a.importance) return b.importance - a.importance;
		// ISO dates sort lexicographically = chronologically; most recent first.
		return (b.updated || "").localeCompare(a.updated || "");
	});
}

export interface BudgetResult {
	included: SystemFileEntry[];
	omitted: SystemFileEntry[];
	usedTokens: number;
}

/**
 * Greedy fill against a token budget.
 *
 * Guarantee: at least the highest-ranked file is always included, even if it
 * alone exceeds the budget. This prevents the degenerate case where a single
 * oversized file (e.g. a bloated projects.md) silently evicts everything,
 * including persona. Oversized files are a data-hygiene concern; the cap guards
 * against unbounded file *count*, not mid-file truncation (we never cut a file
 * in half).
 */
export function budgetSystemInjection(
	ranked: SystemFileEntry[],
	budget: number = DEFAULT_TOKEN_BUDGET,
	headerFor: (f: SystemFileEntry) => string = (f) => `\n=== system/${f.relPath} ===\n`,
): BudgetResult {
	const included: SystemFileEntry[] = [];
	const omitted: SystemFileEntry[] = [];
	let used = 0;

	for (const f of ranked) {
		const cost = estimateTokens(headerFor(f) + f.content);
		if (included.length === 0 || used + cost <= budget) {
			included.push(f);
			used += cost;
		} else {
			omitted.push(f);
		}
	}

	return { included, omitted, usedTokens: used };
}
