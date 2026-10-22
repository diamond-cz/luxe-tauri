import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./imageTableCustomColumns.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { customImageColumnText, imageColumnSourceKeys, readImageTableColumnOverrides } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const values = { A: "8", B: "2" };
const lookup = (key) => values[key] ?? "-";

test("custom columns collect formula fields and evaluate arithmetic", () => {
  assert.deepEqual(imageColumnSourceKeys("=log2(A / B)"), ["A", "B"]);
  assert.equal(customImageColumnText("=log2(A / B)", lookup), "2");
  assert.equal(customImageColumnText("=A + B * 2", lookup), "12");
  assert.equal(customImageColumnText("=(A + B) / 2", lookup), "5");
});

test("custom columns reject missing fields and invalid expressions", () => {
  assert.equal(customImageColumnText("=A / C", lookup), "-");
  assert.equal(customImageColumnText("=A +", lookup), "-");
  assert.equal(customImageColumnText("=A;alert(1)", lookup), "-");
  assert.equal(customImageColumnText("B", lookup), "2");
});

test("column edits keep valid label and source overrides", () => {
  const saved = new Map([["edits", JSON.stringify({
    delta: { label: "Delta", source: "=A-B" },
    invalid: { source: 42 },
  })]]);
  globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null };
  assert.deepEqual(readImageTableColumnOverrides("edits"), {
    delta: { label: "Delta", source: "=A-B" },
  });
});
