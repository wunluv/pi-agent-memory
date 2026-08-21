/**
 * Token budgeting for Zone A system/ injection.
 *
 * buildSystemContext() used to inject every system/*.md wholesale. This module
 * adds the cap: rank by importance then recency, fill greedily up to a budget,
 * and report what was left out (still reachable via memory_tree/memory_read).
 *
 * Since #36, the budgeted pool sits UNDER a pinned spine that is exempt from the
 * budget. The navigation core (index/projects) and load-bearing persona state
 * (identity/persona) always inject; only the budgeted remainder competes for
 * the remaining tokens.
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
 * The pinned spine (#36): these basenames ALWAYS inject regardless of budget.
 * The navigation core (index) must never lose to a leaf. identity/persona are
 * load-bearing persona state; projects.md is the eagle-eye index that was
 * being silently evicted (the exact failure #36 fixes). Matched against the
 * file's basename so `human/identity.md` pins identically to `identity.md`.
 */
export const PINNED_SYSTEM_BASENAMES = new Set(["identity.md", "persona.md", "projects.md", "index.md"]);

/** Whether a system/ file is part of the always-inject spine (#36). */
export function isPinnedSystemFile(f: SystemFileEntry): boolean {
	const base = f.relPath.split("/").pop() ?? "";
	return PINNED_SYSTEM_BASENAMES.has(base);
}

/**
 * Default budget (tokens) for the system/ data files injected into context.
 * Calibrated to the current corpus (~2,230 tokens: persona + identity + prefs +
 * thin projects index) plus headroom, so no file is evicted today. It guards
 * FUTURE growth: when system/ grows past this, lowest-importance files are cut
 * first from the non-pinned pool (the spine is exempt). Env-overridable via
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

export interface BudgetInjection {
	/** Everything that will be injected: pinned spine first, then budgeted fills. */
	included: SystemFileEntry[];
	omitted: SystemFileEntry[];
	/** Tokens used by the budgeted (non-pinned) pool. */
	usedTokens: number;
	/** Tokens consumed by the pinned spine itself (exempt from `budget`). */
	pinnedTokens: number;
}

export type PinnedPredicate = (f: SystemFileEntry) => boolean;

/**
 * Split system/ files into pinned (always inject, exempt from budget) and a
 * budgeted pool filled greedily up to the cap.
 *
 * Pinned spine goes in first, in rank order. The budgeted pool then fills with
 * the top-ranked remainder. Guarantee: at least the highest-ranked budgeted
 * file is included even if it alone exceeds the remaining budget — this
 * prevents a single oversized non-spine file from silently evicting the whole
 * budgeted set (but never a pinned file; the spine is exempt by construction).
 * No mid-file truncation: we include or omit whole files.
 */
export function budgetSystemInjection(
	ranked: SystemFileEntry[],
	budget: number = DEFAULT_TOKEN_BUDGET,
	headerFor: (f: SystemFileEntry) => string = (f) => `\n=== system/${f.relPath} ===\n`,
	isPinned: PinnedPredicate = isPinnedSystemFile,
): BudgetInjection {
	const pinned: SystemFileEntry[] = [];
	const budgeted: SystemFileEntry[] = [];
	for (const f of ranked) {
		(isPinned(f) ? pinned : budgeted).push(f);
	}

	// Pinned spine is exempt from the budget — always inject, in rank order.
	const included: SystemFileEntry[] = [...pinned];
	const pinnedTokens = estimateTokens(pinned.map((f) => headerFor(f) + f.content).join(""));

	// Budgeted pool fills greedily on the remaining budget. Guarantee: at least
	// the highest-ranked (i === 0) budgeted file is included.
	const omitted: SystemFileEntry[] = [];
	let used = 0;
	for (let i = 0; i < budgeted.length; i++) {
		const f = budgeted[i];
		const cost = estimateTokens(headerFor(f) + f.content);
		if (i === 0 || used + cost <= budget) {
			included.push(f);
			used += cost;
		} else {
			omitted.push(f);
		}
	}

	return { included, omitted, usedTokens: used, pinnedTokens };
}