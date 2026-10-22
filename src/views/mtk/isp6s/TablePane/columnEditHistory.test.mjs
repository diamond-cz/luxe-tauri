import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./columnEditHistory.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { readColumnEditHistory, writeColumnEditHistory, rememberColumnEdit } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

test("column names and formulas retain separate histories and favorites", () => {
  rememberColumnEdit("label", "ΔEV");
  rememberColumnEdit("source", "=log2(CWR_new / CWR_old)");
  assert.deepEqual(readColumnEditHistory("label").map((item) => item.value), ["ΔEV"]);
  assert.deepEqual(readColumnEditHistory("source").map((item) => item.value), ["=log2(CWR_new / CWR_old)"]);
  writeColumnEditHistory("source", [{ value: "A", favorite: false }, { value: "B", favorite: true }]);
  rememberColumnEdit("source", "B");
  assert.deepEqual(readColumnEditHistory("source").map((item) => [item.value, item.favorite]),
    [["B", true], ["A", false]]);
  writeColumnEditHistory("source", readColumnEditHistory("source").filter((item) => item.value !== "A"));
  assert.deepEqual(readColumnEditHistory("source").map((item) => item.value), ["B"]);
});

test("invalid saved items are ignored", () => {
  storage.set("luxe:isp6s:column-edit-label-history", JSON.stringify([
    { value: "Valid", favorite: false }, { value: "Valid", favorite: true }, { value: "", favorite: true },
  ]));
  assert.deepEqual(readColumnEditHistory("label"), [{ value: "Valid", favorite: false }]);
});
