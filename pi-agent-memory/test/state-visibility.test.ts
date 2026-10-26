/**
 * #85: `memory_tree` names the canonical state files with their dates, so rot
 * announces itself while browsing. #84: `/memory:init` writes directories,
 * project.json and a commit — no stub files, so absence stays a real signal.
 *
 * Loads index.ts the way pi does (jiti + alias map) and drives the registered
 * tool and command, so this exercises the shipped definitions rather than a copy.
 * Run with: node --test 'test/*.test.ts'
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const NVM_ROOT = path.dirname(path.dirname(process.execPath));
const JITI_STATIC = path.join(
	NVM_ROOT,
	"lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti-static.mjs",
);
const { createJiti } = await import(JITI_STATIC);

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

const jiti = createJiti(import.meta.url, { alias });
const mod = await jiti.import(path.join(EXT_DIR, "index.ts"));

const tools: Record<string, any> = {};
const commands: Record<string, any> = {};
mod.default({
	registerTool: (def: any) => { tools[def.name] = def; },
	registerCommand: (name: string, def: any) => { commands[name] = def; },
	on: () => {},
});

const treeTool = tools.memory_tree;

function tmpRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-mem-state-"));
}

/** A memory root with git history, optionally backdated. */
function gitRoot(commitDate: string): string {
	const root = tmpRoot();
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	fs.writeFileSync(path.join(root, "project.json"), '{"uuid":"00000000-0000-4000-8000-000000000000"}\n');
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "init"], {
		cwd: root,
		env: { ...process.env, GIT_AUTHOR_DATE: `${commitDate}T12:00:00Z`, GIT_COMMITTER_DATE: `${commitDate}T12:00:00Z` },
	});
	return root;
}

function writeState(root: string, relPath: string, date: string): void {
	const full = path.join(root, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(
		full,
		`---\ndescription: "test state"\nimportance: 5\ntags: []\ncreated: ${date}\nupdated: ${date}\n---\n` +
			`## Current state\n- something\n\n## Decisions made\n- none\n\n## Open threads\n- none\n\n## Next actions\n- none\n`,
	);
}

async function tree(root: string, sub?: string): Promise<string> {
	const result = await treeTool.execute("call-1", sub ? { root, path: sub } : { root });
	return result.content[0].text as string;
}

function daysAgo(n: number): string {
	const d = new Date(Date.now() - n * 86_400_000);
	return d.toISOString().slice(0, 10);
}

function test(name: string, fn: () => Promise<void> | void) {
	return (async () => {
		await fn();
		console.log(`ok - ${name}`);
	})().catch((err) => {
		console.error(`not ok - ${name}`);
		console.error(`  ${err.message}`);
		process.exitCode = 1;
	});
}

await test("tree names the canonical state files with their dates", async () => {
	const root = gitRoot(daysAgo(0));
	writeState(root, "session/latest.md", daysAgo(0));
	writeState(root, "wip.md", daysAgo(1));
	const out = await tree(root);
	assert.ok(out.startsWith("Canonical state files:"), `header leads: ${out.slice(0, 60)}`);
	assert.ok(out.includes(`session/latest.md — ${daysAgo(0)}`), `state file dated: ${out}`);
	assert.ok(out.includes(`wip.md — ${daysAgo(1)}`), `wip dated: ${out}`);
	assert.ok(!out.includes("STALE"), `fresh state is not marked: ${out}`);
});

await test("a state file far behind the newest commit is marked stale", async () => {
	const root = gitRoot(daysAgo(0));
	writeState(root, "session/latest.md", daysAgo(60));
	const out = await tree(root);
	assert.ok(out.includes("STALE"), `stale marker present: ${out}`);
	assert.ok(/STALE \(\d+ days behind the newest commit\)/.test(out), `marker states the gap: ${out}`);
});

await test("staleness is relative to the newest commit, not wall clock", async () => {
	// A dormant project: last commit 200 days ago, state written 190 days ago.
	// Old by the calendar, consistent with its own history, so not nagged.
	const root = gitRoot(daysAgo(200));
	writeState(root, "session/latest.md", daysAgo(190));
	const out = await tree(root);
	assert.ok(out.includes("session/latest.md"), `state file named: ${out}`);
	assert.ok(!out.includes("STALE"), `dormant but consistent is not stale: ${out}`);
});

await test("a root with no canonical state file renders no header", async () => {
	const root = gitRoot(daysAgo(0));
	fs.writeFileSync(path.join(root, "reference.md"), "# x\n");
	const out = await tree(root);
	assert.ok(!out.includes("Canonical state files:"), `no empty header: ${out}`);
});

await test("a subtree listing carries no header", async () => {
	const root = gitRoot(daysAgo(0));
	writeState(root, "session/latest.md", daysAgo(0));
	fs.writeFileSync(path.join(root, "project.json.x.md"), "# y\n");
	fs.mkdirSync(path.join(root, "reference"), { recursive: true });
	fs.writeFileSync(path.join(root, "reference", "index.md"), '# i\n---\ndescription: "idx"\nimportance: 3\ntags: []\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n');
	const out = await tree(root, "reference");
	assert.ok(!out.includes("Canonical state files:"), `no header on subtree: ${out}`);
	assert.ok(out.includes("index"), `subtree still listed: ${out}`);
});

// ─── #84: /memory:init writes no stubs ────────────────────────────────────────

function fakeCtx() {
	const notes: string[] = [];
	return {
		notes,
		ui: {
			notify: (msg: string) => { notes.push(msg); },
			select: async () => "cancel",
			confirm: async () => false,
			input: async () => "",
		},
	};
}

function memoryMdFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			if (e.name === ".git") continue;
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith(".md")) out.push(path.relative(root, p));
		}
	};
	if (fs.existsSync(root)) walk(root);
	return out.sort();
}

await test("/memory:init writes no stub files, only directories and project.json", async () => {
	const project = tmpRoot();
	fs.writeFileSync(path.join(project, ".gitignore"), "node_modules/\n");
	const ctx = fakeCtx();
	await commands["memory:init"].handler(project, ctx);

	const memoryRoot = path.join(project, ".memory");
	assert.ok(fs.existsSync(path.join(memoryRoot, "project.json")), "identity written");
	assert.deepEqual(memoryMdFiles(memoryRoot), [], "no .md files at all (#84)");
	for (const dir of ["reference", "system", "project_insights/analyses", "project_insights/wisdom"]) {
		assert.ok(fs.existsSync(path.join(memoryRoot, dir)), `${dir}/ exists`);
	}
	const said = ctx.notes.join("\n");
	assert.ok(said.includes("Nothing is stubbed"), `report says so: ${said}`);
});

await test("/memory:init reports the standing state-file absence", async () => {
	const project = tmpRoot();
	fs.writeFileSync(path.join(project, ".gitignore"), "");
	const ctx = fakeCtx();
	await commands["memory:init"].handler(project, ctx);
	const said = ctx.notes.join("\n");
	assert.ok(said.includes("session/latest.md"), `names where state goes: ${said}`);
});
