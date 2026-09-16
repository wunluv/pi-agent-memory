/**
 * #73: read and search results state the scope they used, and flag cwd drift.
 *
 * Run with: node test/scope-results.test.ts
 *
 * Drives the real tool handlers through the jiti harness, because the defect is
 * in the wiring: the root was resolved correctly and then never stated. The pure
 * ladder lives in test/scope.test.ts.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

function tmpDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
	return Promise.resolve(fn()).then(
		() => {
			console.log(`ok - ${name}`);
		},
		(err) => {
			console.error(`not ok - ${name}`);
			throw err;
		},
	);
}

const FAKE_HOME = tmpDir("scope-home-");
const AGENTS_DIR = path.join(FAKE_HOME, ".pi", "agents");
const AGENT_MEMORY = path.join(AGENTS_DIR, "testagent", "memory");

fs.mkdirSync(path.join(AGENT_MEMORY, "system"), { recursive: true });
fs.writeFileSync(path.join(AGENTS_DIR, "active"), "testagent");
fs.writeFileSync(
	path.join(AGENT_MEMORY, "agent.json"),
	JSON.stringify({ uuid: "00000000-0000-4000-8000-000000000073", name: "testagent" }),
);
fs.writeFileSync(path.join(AGENT_MEMORY, "system", "projects.md"), "# Projects\n");
process.env.HOME = FAKE_HOME;

const NVM_ROOT = path.dirname(path.dirname(process.execPath));
const JITI_STATIC = path.join(
	NVM_ROOT,
	"lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti-static.mjs",
);
const PI_ROOT = path.join(NVM_ROOT, "lib/node_modules/@earendil-works/pi-coding-agent");
const EXT_DIR = path.dirname(new URL(import.meta.url).pathname) + "/..";

const require = createRequire(path.join(PI_ROOT, "package.json"));
const alias = {
	"@earendil-works/pi-coding-agent": path.join(PI_ROOT, "dist/index.js"),
	"@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
	"@mariozechner/pi-coding-agent": path.join(PI_ROOT, "dist/index.js"),
	"@mariozechner/pi-tui": require.resolve("@earendil-works/pi-tui"),
	typebox: require.resolve("typebox"),
	"typebox/compile": require.resolve("typebox/compile"),
	"typebox/value": require.resolve("typebox/value"),
	"@sinclair/typebox": require.resolve("typebox"),
};
const { createJiti } = await import(JITI_STATIC);
const jiti = createJiti(import.meta.url, { alias });
const mod = await jiti.import(path.join(EXT_DIR, "index.ts"));

const tools: Record<string, any> = {};
const hooks: Record<string, any> = {};
mod.default({
	registerTool: (def: any) => {
		tools[def.name] = def;
	},
	registerCommand: () => {},
	on: (event: string, handler: any) => {
		hooks[event] = handler;
	},
});

async function mockCtx() {
	return {
		ui: {
			notify: () => {},
			select: async () => "skip anyway",
			confirm: async () => false,
			setStatus: () => {},
			theme: { fg: (_c: string, text: string) => text },
		},
	};
}

async function sessionIn(cwd: string) {
	process.chdir(cwd);
	await hooks.session_start({}, await mockCtx());
}

async function callTool(name: string, params: Record<string, unknown>) {
	const result = await tools[name].execute("call-1", params);
	const text = result.content.map((c: any) => c.text).join("\n");
	return { text, details: result.details as any };
}

// ─── fixture: a project with real, searchable memory ─────────────────────────

const TREE = tmpDir("scope-tree-");
const PROJECT = path.join(TREE, "proj");
const PMEM = path.join(PROJECT, ".memory");
fs.mkdirSync(path.join(PMEM, "reference"), { recursive: true });
fs.writeFileSync(path.join(PMEM, "project.json"), JSON.stringify({ uuid: "00000000-0000-4000-8000-0000000000aa" }));
fs.writeFileSync(
	path.join(PMEM, "reference", "tidepools.md"),
	"---\ndescription: \"tidepool survey\"\nimportance: 5\nupdated: 2026-09-16\n---\n# Tidepools\n\nAnemones cluster in the lower intertidal zone.\n",
);
fs.writeFileSync(
	path.join(PMEM, "reference", "anemones.md"),
	"---\ndescription: \"anemone notes\"\nimportance: 3\nupdated: 2026-09-10\n---\n# Anemones\n\nAnemones retract at low tide.\n",
);
const ELSEWHERE = path.join(TREE, "elsewhere");
fs.mkdirSync(ELSEWHERE, { recursive: true });

const EXPECTED = `Searched: Zone B (auto-discovered) · ${PMEM}`;

// ─── the reported cases ──────────────────────────────────────────────────────

await test("memory_search states the root it searched", async () => {
	await sessionIn(PROJECT);
	const { text, details } = await callTool("memory_search", { query: "anemones" });
	assert.ok(text.startsWith(EXPECTED), `header names the root: ${text.slice(0, 200)}`);
	assert.ok(text.includes("anemones.md"), "hits follow the header");
	assert.equal(details.zone, "Zone B (auto-discovered)");
	assert.equal(details.root, PMEM);
});

await test("regression: the same hits, in the same ranked order, with the header added", async () => {
	await sessionIn(PROJECT);
	const { text } = await callTool("memory_search", { query: "anemones" });
	const hits = text
		.split("\n")
		.filter((l: string) => /^\d+\. /.test(l))
		.map((l: string) => ({
			path: l.replace(/^\d+\. /, "").split("  (score")[0],
			score: Number(/score ([\d.]+)/.exec(l)?.[1]),
		}));

	// Both fixture files mention anemones, so both must come back.
	assert.equal(hits.length, 2, `two matching files: ${JSON.stringify(hits)}`);
	assert.deepEqual(
		[...hits.map((h) => h.path)].sort(),
		["reference/anemones.md", "reference/tidepools.md"],
		"same hit set as the underlying search",
	);
	for (let i = 1; i < hits.length; i++) {
		assert.ok(hits[i - 1].score >= hits[i].score, `ranked order preserved: ${JSON.stringify(hits)}`);
	}
});

await test("memory_search after a cd outside the project keeps the bound root and flags the drift", async () => {
	await sessionIn(PROJECT);
	const bound = (await callTool("memory_search", { query: "anemones" })).details.root;

	process.chdir(ELSEWHERE);
	const { text, details } = await callTool("memory_search", { query: "anemones" });

	assert.equal(details.root, bound, "the scope never moves mid-session");
	assert.ok(text.startsWith(EXPECTED), `still the bound root: ${text.slice(0, 200)}`);
	assert.ok(text.includes(ELSEWHERE), `names the drifted cwd: ${text}`);
	assert.ok(text.includes("outside"), `explains the drift: ${text}`);
	assert.ok(text.includes("root=<path>"), `names the model's escape: ${text}`);
	assert.ok(text.includes("/startwork"), `names the human's rebind: ${text}`);
	assert.ok(text.includes("reference/anemones.md"), "hits still returned");

	process.chdir(PROJECT);
});

await test("memory_search(root=…) states the override and reports no drift", async () => {
	await sessionIn(ELSEWHERE);
	const { text, details } = await callTool("memory_search", { query: "anemones", root: PMEM });

	assert.ok(text.startsWith(`Searched: Zone B (override) · ${PMEM}`), `override stated: ${text.slice(0, 200)}`);
	assert.equal(details.kind, "override");
	assert.ok(!text.includes("outside"), "a deliberate root is not drift");
});

await test("memory_read names the root it used, and keeps naming it when the file is missing", async () => {
	await sessionIn(PROJECT);
	const found = await callTool("memory_read", { path: "reference/anemones.md" });
	assert.ok(found.text.includes("# Anemones"), "file read");
	assert.ok(found.text.includes(`scope: Zone B (auto-discovered) · ${PMEM}`), `scope named: ${found.text.slice(-200)}`);

	const missing = await callTool("memory_read", { path: "reference/absent.md" });
	assert.ok(missing.text.startsWith("File not found: reference/absent.md"), "still reports the miss");
	assert.ok(missing.text.includes(PMEM), `and says where it looked: ${missing.text}`);
	assert.equal(missing.details.root, PMEM);
});

await test("memory_tree names the root it listed", async () => {
	await sessionIn(PROJECT);
	const { text, details } = await callTool("memory_tree", { path: "reference/" });
	// The tree renders names without the .md suffix and appends the description.
	assert.ok(text.includes("anemones"), `tree listed: ${text}`);
	assert.ok(text.includes(`scope: Zone B (auto-discovered) · ${PMEM}`), `scope named: ${text.slice(-200)}`);
	assert.equal(details.zone, "Zone B (auto-discovered)", "details keep the zone field memory_status grew up with");
});

await test("the agent root is labelled Zone A, not disguised drift", async () => {
	await sessionIn(ELSEWHERE);
	const { text, details } = await callTool("memory_tree", {});
	assert.equal(details.zone, "Zone A (agent)");
	assert.ok(text.includes("Zone A (agent)"), `labelled: ${text.slice(-200)}`);
	assert.ok(!text.includes("outside"), "Zone A has no inside to be outside of");
});

console.log("\nall scope-result tests passed");
