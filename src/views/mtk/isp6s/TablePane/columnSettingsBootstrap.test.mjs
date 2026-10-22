import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./columnSettingsBootstrap.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { prepareColumnSettingsBootstrap, consumeColumnSettingsBootstrap } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

test("column settings receives current schema and theme once", () => {
  const schema = { Image: { BV: "AE_TAG_REALBVX1000" }, image_table: { scene: { BV: "AE_TAG_REALBVX1000" } } };
  prepareColumnSettingsBootstrap("isp6s", schema, "light");
  const bootstrap = consumeColumnSettingsBootstrap("isp6s");
  assert.equal(bootstrap.theme, "light");
  assert.deepEqual(bootstrap.schema, schema);
  assert.equal(consumeColumnSettingsBootstrap("isp6s"), null);
});

test("column settings ignores a bootstrap for another mode", () => {
  prepareColumnSettingsBootstrap("tone", { Image: {} }, "dark");
  assert.equal(consumeColumnSettingsBootstrap("isp6s"), null);
});
