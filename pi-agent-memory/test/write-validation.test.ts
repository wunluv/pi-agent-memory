/**
 * #81: legible memory_write validation.
 *
 * Run with: node test/write-validation.test.ts
 *
 * Incident #14 Class A: models (deepseek-v4-flash) drop `path` on long writes.
 * With `path` required at the schema level, the harness rejected the call
 * before execute() ran and the model saw an opaque "memory_write: undefined".
 * The fix: the three required fields are Optional at the schema level and
 * validated inside execute(), where the refusal names what is missing and
 * echoes what the call DID carry.
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

const AGENT_UUID = "00000000-0000-4000-8000-000000000081";
const FAKE_HOME = tmpDir("write-validation-home-");
const AGENTS_DIR = path.join(FAKE_HOME, ".pi", "agents");
const AGENT_MEMORY = path.join(AGENTS_DIR, "testagent", "memory");

fs.mkdirSync(path.join(AGENT_MEMORY, "system"), { recursive: true });
fs.writeFileSync(path.join(AGENTS_DIR, "active"), "testagent");
fs.writeFileSync(
	path.join(AGENT_MEMORY, "agent.json"),
	JSON.stringify({ uuid: AGENT_UUID, name: "testagent" }),
);
fs.writeFileSync(path.join(AGENT_MEMORY, "system", "identity.md"), "---\ndescription: \"who\"\n---\nSPINE\n");
// Commits must work without a real HOME.
fs.writeFileSync(
	path.join(FAKE_HOME, ".gitconfig"),
	"[user]\n\tname = Test\n\temail = test@example.com\n",
);
process.env.HOME = FAKE_HOME;
process.env.GIT_CONFIG_NOSYSTEM = "1";

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

async function callTool(name: string, params: Record<string, unknown>) {
	const result = await tools[name].execute("call-1", params);
	return {
		text: result.content.map((c: any) => c.text).join("\n"),
		details: result.details as any,
	};
}

// The schema must accept a call with the required fields absent — that is the
// whole point. If the harness-level schema rejects it again, execute() never
// runs and the opacity returns.
await test("schema: memory_write params validate with path/content/description absent", () => {
	const { Value } = require("typebox/value");
	const schema = tools.memory_write.parameters;
	const check = Value.Check(schema, { importance: 3 });
	assert.ok(check, "schema should accept a call missing the required fields");
});

await test("memory_write without path: refusal names 'path' and what the call carried", async () => {
	const { text, details } = await callTool("memory_write", {
		content: "long status blob that flash wrote".repeat(40),
		description: "status update",
	});
	assert.ok(text.includes("path"), `refusal names the missing field: ${text}`);
	assert.ok(!text.includes("undefined"), `no opaque 'undefined' in: ${text}`);
	assert.ok(text.includes("chars of content"), `echoes what the call carried: ${text}`);
	assert.ok(text.includes("Retry"), `gives the retry instruction: ${text}`);
	assert.deepEqual(details.missing, ["path"]);
	assert.ok(details.refused, "details.refused set so the TUI renders it as an error");
});

await test("memory_write without path writes NOTHING to disk", async () => {
	const before = fs.readdirSync(AGENT_MEMORY, { recursive: true }).length;
	await callTool("memory_write", { content: "x", description: "d" });
	const after = fs.readdirSync(AGENT_MEMORY, { recursive: true }).length;
	assert.equal(after, before, "no file created by a rejected call");
});

await test("memory_write without content: refusal names 'content'", async () => {
	const { text, details } = await callTool("memory_write", {
		path: "reference/probe.md",
		description: "d",
	});
	assert.ok(text.includes("content"), `refusal names 'content': ${text}`);
	assert.deepEqual(details.missing, ["content"]);
});

await test("memory_write without description: refusal names 'description'", async () => {
	const { text, details } = await callTool("memory_write", {
		path: "reference/probe.md",
		content: "body",
	});
	assert.ok(text.includes("description"), `refusal names 'description': ${text}`);
	assert.deepEqual(details.missing, ["description"]);
});

await test("memory_write with all required fields still writes normally", async () => {
	// Isolate cwd: without a session root the tools auto-discover, and this
	// repo's parent owns a real .memory/ we must not touch.
	process.chdir(tmpDir("write-validation-cwd-"));
	const { text, details } = await callTool("memory_write", {
		path: "knowledge/probe.md",
		content: "# Probe\n\nbody text\n",
		description: "probe file",
	});
	assert.ok(text.includes("wrote"), `normal write succeeds: ${text}`);
	assert.equal(details.refused, undefined, "not flagged as refused");
	const file = path.join(AGENT_MEMORY, "knowledge", "probe.md");
	assert.ok(fs.existsSync(file), "file exists on disk");
});

await test("schema descriptions still say 'Required.' so models treat them as required", () => {
	const props = tools.memory_write.parameters.properties;
	for (const field of ["path", "content", "description"]) {
		assert.match(props[field].description, /^Required\./, `${field} description leads with Required.`);
	}
});