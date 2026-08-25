/**
 * Tests for memory_write renderCall/renderResult — the written-file visibility
 * feature (#56). Loads index.ts the same way pi does (jiti + alias map) so we
 * exercise the real registered tool definition.
 * Run with: node --experimental-strip-types test/render.test.ts
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

// jiti ships inside the pi install; derive its path from the node binary so
// this survives nvm version bumps.
const NVM_ROOT = path.dirname(path.dirname(process.execPath));
const JITI_STATIC = path.join(
	NVM_ROOT,
	"lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti-static.mjs",
);
const { createJiti } = await import(JITI_STATIC);

const PI_ROOT = path.join(
	NVM_ROOT,
	"lib/node_modules/@earendil-works/pi-coding-agent",
);
const EXT_DIR = path.dirname(new URL(import.meta.url).pathname) + "/..";

// Mirror pi's loader aliases (see dist/core/extensions/loader.js).
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

const tools = {};
mod.default({
	registerTool: (def) => { tools[def.name] = def; },
	registerCommand: () => {},
	on: () => {},
});

const writeTool = tools.memory_write;
const theme = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bg: (color, text) => `[${color}]${text}[/${color}]`,
	bold: (text) => `**${text}**`,
};
const render = (comp) => comp.render(120).join("\n");

function test(name: string, fn: () => void) {
	fn();
	console.log(`ok - ${name}`);
}

test("memory_write registers with both renderers", () => {
	assert.ok(writeTool, "memory_write tool registered");
	assert.equal(typeof writeTool.renderCall, "function");
	assert.equal(typeof writeTool.renderResult, "function");
});

test("renderCall shows tool name and requested path", () => {
	const line = render(writeTool.renderCall({ path: "reference/foo.md" }, theme, {}));
	assert.ok(line.includes("memory_write"), `tool name in call row: ${line}`);
	assert.ok(line.includes("reference/foo.md"), `requested path in call row: ${line}`);
});

test("renderResult success shows written path in accent + description", () => {
	const out = render(
		writeTool.renderResult(
			{
				content: [{ type: "text", text: "📝 wrote reference/foo.md and committed." }],
				details: { path: "reference/foo.md", description: "A test write", importance: 3, tags: [] },
			},
			{ expanded: false, isPartial: false },
			theme,
			{},
		),
	);
	assert.ok(out.includes("<accent>reference/foo.md</accent>"), `path styled: ${out}`);
	assert.ok(out.includes("A test write"), `description shown: ${out}`);
});

test("renderResult refused keeps the full guard message in error color", () => {
	const msg = "⛔ system/ write refused by budget guard (#36): would evict system/craft.md";
	const out = render(
		writeTool.renderResult(
			{ content: [{ type: "text", text: msg }], details: { path: "system/foo.md", wouldEvict: ["craft.md"], refused: true } },
			{ expanded: true, isPartial: false },
			theme,
			{},
		),
	);
	assert.ok(out.includes(msg), `full message kept: ${out}`);
	assert.ok(out.includes("<error>"), `error color used: ${out}`);
});

test("renderResult falls back to raw content when no details", () => {
	const out = render(
		writeTool.renderResult(
			{ content: [{ type: "text", text: "❌ Failed to write x.txt" }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			{},
		),
	);
	assert.ok(out.includes("Failed to write x.txt"), `raw content shown: ${out}`);
});

test("execute() success result leads with the written path", async () => {
	const rootDir = fs_mkdtemp();
	const result = await writeTool.execute("call-1", {
		path: "reference/smoke.md",
		content: "# smoke\n\nbody",
		description: "smoke write",
		root: rootDir,
	});
	assert.ok(
		result.content[0].text.includes("wrote reference/smoke.md"),
		`result leads with path: ${result.content[0].text}`,
	);
	assert.equal(result.details.path, "reference/smoke.md");
});

function fs_mkdtemp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "render-test-"));
}
