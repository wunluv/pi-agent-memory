/**
 * Scope reporting for read and search results (#73).
 *
 * Memory tools bind their root once per session (see discovery.ts), and that
 * binding is deliberately stable: a mid-session `cd` must never move a
 * destination. The defect was that the binding was invisible at the point of
 * use. A result set did not say which root it came from, so a wrong root looked
 * exactly like a right one — the same silence #65/#66/#69 fixed for writes, and
 * #67 for membership. This module fixes it for reads.
 *
 * Everything here is pure. `resolveScope()` mirrors the resolution ladder and
 * `index.ts` derives its root from it, so what gets reported cannot drift from
 * what was actually used. The renderers are the only place result text is built.
 *
 * Forward-looking: once `memory_search` fans out over a local root and a shared
 * commons (#71), provenance is per hit-group. Grouping by root is already the
 * shape here, so that change inherits this renderer rather than inventing one.
 */
import { isProjectMemoryRoot, scopeDriftNotice } from "./discovery.ts";

/** Why a root won the ladder. The reason is part of what the model needs to know. */
export type ScopeKind = "override" | "session" | "discovered" | "agent";

export interface ScopeInput {
	/** `params.root`, with `~` already expanded by the caller. */
	explicitRoot: string | null;
	sessionRoot: string | null;
	autoDiscoveredRoot: string | null | undefined;
	agentRoot: string | null;
	cwd: string;
	home: string;
}

export interface MemoryScope {
	/** Absolute resolved root. The value every caller must use. */
	root: string;
	kind: ScopeKind;
	/** Zone label, matching the vocabulary already used in tool `details`. */
	zone: string;
	/** Plain-language reason this root won. */
	origin: string;
	/** `root` with the home prefix shortened, for result text only. */
	display: string;
	/** Drift line when cwd has left the bound project, else null. */
	drift: string | null;
}

const ZONE_LABEL: Record<ScopeKind, string> = {
	override: "Zone B (override)",
	session: "Zone B (session)",
	discovered: "Zone B (auto-discovered)",
	agent: "Zone A (agent)",
};

const ORIGIN: Record<ScopeKind, string> = {
	override: "named by the root= parameter",
	session: "bound by /startwork",
	discovered: "discovered from cwd at session start",
	agent: "no session root, so the agent root is the fallback",
};

/** Shorten a home-relative path to `~/…`. Display only — never used to resolve. */
export function shortenHome(p: string, home: string): string {
	const h = home.replace(/\/+$/, "");
	if (!h) return p;
	return p === h || p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
}

/**
 * Drift is meaningful only for a bound project root.
 *
 * An explicit `root=` is a deliberate choice, so there is nothing to flag. The
 * agent root has no meaningful "inside" (its owner is the agent directory), so
 * reporting drift there would fire on every Zone A read and become noise.
 */
function driftFor(kind: ScopeKind, root: string, cwd: string): string | null {
	if (kind === "override" || !isProjectMemoryRoot(root)) return null;
	const base = scopeDriftNotice(root, cwd);
	if (!base) return null;
	// Both audiences are named: the model can pass root=, the human can rebind.
	// Addressing only the tool (#70) or only the human leaves one of them stuck.
	return `${base}\nPass root=<path> for a one-off read elsewhere, or run /startwork <project> to rebind the session.`;
}

/**
 * Resolve the active scope, mirroring the ladder in `resolveMemoryRoot`:
 * explicit → session → auto-discovered → agent. Null when nothing resolves.
 */
export function resolveScope(input: ScopeInput): MemoryScope | null {
	const ladder: Array<[ScopeKind, string | null | undefined]> = [
		["override", input.explicitRoot],
		["session", input.sessionRoot],
		["discovered", input.autoDiscoveredRoot],
		["agent", input.agentRoot],
	];
	const hit = ladder.find(([, root]) => !!root);
	if (!hit) return null;
	const kind = hit[0];
	const root = hit[1] as string;

	return {
		root,
		kind,
		zone: ZONE_LABEL[kind],
		origin: ORIGIN[kind],
		display: shortenHome(root, input.home),
		drift: driftFor(kind, root, input.cwd),
	};
}

/** One line of provenance, e.g. `scope: Zone B (session) · ~/DEV/x/.memory`. */
export function renderScope(scope: MemoryScope, label = "scope"): string {
	return `${label}: ${scope.zone} · ${scope.display}`;
}

/** The provenance line plus any drift warning, ready to append to a result. */
export function renderScopeBlock(scope: MemoryScope, label = "scope"): string {
	const drift = scope.drift ? `\n\u26A0 ${scope.drift}` : "";
	return `\n\n${renderScope(scope, label)}${drift}`;
}

/** Shape handed to tool `details`, so renderers need not re-parse the text. */
export function scopeDetails(scope: MemoryScope): {
	root: string;
	zone: string;
	kind: ScopeKind;
	origin: string;
	drift: boolean;
} {
	return { root: scope.root, zone: scope.zone, kind: scope.kind, origin: scope.origin, drift: !!scope.drift };
}
