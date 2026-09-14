/**
 * Tests for the /endwork precondition (#69) and the handoff-gate copy (#70).
 *
 * Run with: node test/endwork.test.ts
 *
 * Drives the real command handler through the jiti harness against a throwaway
 * HOME, because the defect lives in the precondition: the tools write to an
 * auto-discovered project root, while the close ritual demanded /startwork.
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

const FAKE_HOME = tmpDir("endwork-home-");
const AGENTS_DIR = path.join(FAKE_HOME, ".pi", "agents");
const AGENT_MEMORY = path.join(AGENTS_DIR, "testagent", "memory");

fs.mkdirSync(path.join(AGENT_MEMORY, "system"), { recursive: true });
fs.writeFileSync(path.join(AGENTS_DIR, "active"), "testagent");
fs.writeFileSync(
	path.join(AGENT_MEMORY, "agent.json"),
	JSON.stringify({ uuid: "00000000-0000-4000-8000-000000000069", name: "testagent" }),
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

const commands: Record<string, any> = {};
const hooks: Record<string, any> = {};
mod.default({
	registerTool: () => {},
	registerCommand: (name: string, def: any) => {
		commands[name] = def;
	},
	on: (event: string, handler: any) => {
		hooks[event] = handler;
	},
});

interface Notes {
	notifications: Array<{ text: string; level?: string }>;
	prompts: string[];
	options: string[][];
}

/** Mock ctx. `gateChoice` decides what the handoff gate returns. */
function mockCtx(gateChoice = "skip anyway"): Notes & { ctx: any } {
	const notes: Notes = { notifications: [], prompts: [], options: [] };
	const ctx = {
		ui: {
			notify: (text: string, level?: string) => notes.notifications.push({ text, level }),
			select: async (prompt: string, options: string[]) => {
				notes.prompts.push(prompt);
				notes.options.push(options);
				return gateChoice;
			},
			confirm: async () => false,
			setStatus: () => {},
			theme: { fg: (_color: string, text: string) => text },
		},
	};
	return { ...notes, ctx };
}

async function sessionIn(cwd: string) {
	process.chdir(cwd);
	await hooks.session_start({}, mockCtx().ctx);
}

function projectWithMemory(name: string): string {
	const dir = path.join(tmpDir("endwork-tree-"), name);
	fs.mkdirSync(path.join(dir, ".memory"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".memory", "project.json"),
		JSON.stringify({ uuid: "00000000-0000-4000-8000-0000000000aa" }),
	);
	return dir;
}

const today = new Date().toISOString().split("T")[0];

// ─── #69: the ritual binds where the writes landed ────────────────────────────

await test("no /startwork, discoverable project: /endwork closes it and says so", async () => {
	const project = projectWithMemory("alpha");
	await sessionIn(project);

	const notes = mockCtx();
	await commands.endwork.handler("", notes.ctx);

	const ended = notes.notifications.find((n) => n.text.includes("Session ended"));
	assert.ok(ended, `session closed: ${JSON.stringify(notes.notifications)}`);
	assert.ok(
		ended.text.includes(path.join(project, ".memory")),
		`names the closed root: ${ended.text}`,
	);
	assert.ok(
		ended.text.includes("discovered at session start"),
		`states it was not a /startwork binding: ${ended.text}`,
	);
});

await test("no /startwork, nothing discoverable: the message names the real cause", async () => {
	const bare = tmpDir("endwork-bare-");
	await sessionIn(bare);

	const notes = mockCtx();
	await commands.endwork.handler("", notes.ctx);

	assert.ok(
		!notes.notifications.some((n) => n.text.includes("Session ended")),
		"nothing was closed",
	);
	const msg = notes.notifications[0]?.text ?? "";
	assert.ok(msg.includes("No session to close"), msg);
	assert.ok(msg.includes(bare), `names cwd: ${msg}`);
	assert.ok(msg.includes("/startwork"), `names the fix: ${msg}`);
	assert.ok(msg.includes("/remember"), `names the global path: ${msg}`);
	assert.ok(
		!msg.includes("No active session"),
		"the old terse refusal is gone",
	);
});

await test("/startwork-bound session: unchanged reporting", async () => {
	const project = projectWithMemory("beta");
	await sessionIn(project);
	await commands.startwork.handler("", mockCtx().ctx);

	const notes = mockCtx();
	await commands.endwork.handler("", notes.ctx);

	const ended = notes.notifications.find((n) => n.text.includes("Session ended"));
	assert.ok(ended, "session closed");
	assert.ok(
		ended.text.includes(`Project memory at: ${path.join(project, ".memory")}`),
		`bound path reported unchanged: ${ended.text}`,
	);
});

await test("the agent root is never the close target", async () => {
	// Discovery excludes ~/.pi, so a session in a bare temp dir must not fall
	// through to Zone A even though resolveMemoryRoot() would.
	const bare = tmpDir("endwork-agentroot-");
	await sessionIn(bare);

	const notes = mockCtx();
	await commands.endwork.handler("", notes.ctx);

	assert.ok(
		!notes.notifications.some((n) => n.text.includes(AGENT_MEMORY)),
		`Zone A never named as a target: ${JSON.stringify(notes.notifications)}`,
	);
});

// ─── #70: the handoff gate copy ───────────────────────────────────────────────

await test("the gate names the dated-today rule and addresses the human", async () => {
	const project = projectWithMemory("gamma");
	fs.mkdirSync(path.join(project, ".memory", "session"), { recursive: true });
	fs.writeFileSync(
		path.join(project, ".memory", "session", "latest.md"),
		`---\nupdated: 2026-01-01\n---\nstale body\n`,
	);
	await sessionIn(project);

	const notes = mockCtx("skip anyway");
	await commands.endwork.handler("", notes.ctx);

	const prompt = notes.prompts[0] ?? "";
	assert.ok(prompt.includes("No handoff dated today"), `names the rule: ${prompt}`);
	assert.ok(prompt.includes("2026-01-01"), `names the stale date: ${prompt}`);
	assert.ok(prompt.includes("Ask the agent"), `addresses the human: ${prompt}`);
	assert.ok(!prompt.includes("memory_write"), `does not tell the human to call a tool: ${prompt}`);
	assert.deepEqual(notes.options[0], ["skip anyway", "keep session — I'll have the handoff written"]);
});

await test("'keep session' preserves the binding and clears nothing", async () => {
	const project = projectWithMemory("delta");
	await sessionIn(project);

	const notes = mockCtx("keep session — I'll have the handoff written");
	await commands.endwork.handler("", notes.ctx);

	assert.ok(
		!notes.notifications.some((n) => n.text.includes("Session ended")),
		"nothing was closed",
	);
	const kept = notes.notifications.find((n) => n.text.includes("Session kept"));
	assert.ok(kept, `session kept: ${JSON.stringify(notes.notifications)}`);
	assert.ok(kept.text.includes("Ask the agent"), kept.text);

	// Still bound: a second /endwork with "skip anyway" closes the same root.
	const second = mockCtx("skip anyway");
	await commands.endwork.handler("", second.ctx);
	assert.ok(
		second.notifications.some((n) => n.text.includes("Session ended")),
		"the binding survived the keep",
	);
});

await test("a handoff dated today passes the gate with a verified line", async () => {
	const project = projectWithMemory("epsilon");
	fs.mkdirSync(path.join(project, ".memory", "session"), { recursive: true });
	fs.writeFileSync(
		path.join(project, ".memory", "session", "latest.md"),
		`---\nupdated: ${today}\n---\nDecisions made: none\n`,
	);
	await sessionIn(project);

	const notes = mockCtx();
	await commands.endwork.handler("", notes.ctx);

	assert.equal(notes.prompts.length, 0, "gate did not fire");
	const ended = notes.notifications.find((n) => n.text.includes("Session ended"));
	assert.ok(ended?.text.includes("Handoff verified"), `verified line: ${ended?.text}`);
});

// ─── #69: cwd drift is stated at close ───────────────────────────────────────

await test("a mid-session cd outside the project is reported at close", async () => {
	const project = projectWithMemory("zeta");
	await sessionIn(project);

	const elsewhere = tmpDir("endwork-elsewhere-");
	process.chdir(elsewhere);

	const notes = mockCtx();
	await commands.endwork.handler("", notes.ctx);

	const ended = notes.notifications.find((n) => n.text.includes("Session ended"));
	assert.ok(ended, "closed");
	assert.ok(ended.text.includes(path.join(project, ".memory")), `closed the bound root: ${ended.text}`);
	assert.ok(ended.text.includes(elsewhere), `names the drifted cwd: ${ended.text}`);
	assert.ok(ended.text.includes("outside"), `explains the drift: ${ended.text}`);
});

console.log("\nall endwork tests passed");
