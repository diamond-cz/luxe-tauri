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

const evLabel = { mode: "isp6s", scope: "all", columnId: "ev", field: "label" };
const evSource = { ...evLabel, field: "source" };

test("each column and edit box retains its own history and favorites", () => {
  rememberColumnEdit(evLabel, "ΔEV");
  rememberColumnEdit(evSource, "=log2(CWR_new / CWR_old)");
  assert.deepEqual(readColumnEditHistory(evLabel).map((item) => item.value), ["ΔEV"]);
  assert.deepEqual(readColumnEditHistory(evSource).map((item) => item.value), ["=log2(CWR_new / CWR_old)"]);
  assert.deepEqual(readColumnEditHistory({ ...evSource, scope: "face" }), []);
  assert.deepEqual(readColumnEditHistory({ ...evSource, columnId: "delta" }), []);
  writeColumnEditHistory(evSource, [{ value: "A", favorite: false }, { value: "B", favorite: true }]);
  rememberColumnEdit(evSource, "B");
  assert.deepEqual(readColumnEditHistory(evSource).map((item) => [item.value, item.favorite]),
    [["B", true], ["A", false]]);
  writeColumnEditHistory(evSource, readColumnEditHistory(evSource).filter((item) => item.value !== "A"));
  assert.deepEqual(readColumnEditHistory(evSource).map((item) => item.value), ["B"]);
  assert.deepEqual(readColumnEditHistory(evLabel).map((item) => item.value), ["ΔEV"]);
});

test("invalid saved items are ignored", () => {
  storage.set("luxe:column-edit-history:isp6s:all:ev:label", JSON.stringify([
    { value: "Valid", favorite: false }, { value: "Valid", favorite: true }, { value: "", favorite: true },
  ]));
  assert.deepEqual(readColumnEditHistory(evLabel), [{ value: "Valid", favorite: false }]);
});
