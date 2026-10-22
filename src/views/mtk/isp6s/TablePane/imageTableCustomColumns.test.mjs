import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./imageTableCustomColumns.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { AE_GAIN_PAIR_SOURCE, customImageColumnText, imageColumnSourceKeys, isAeGainPairSource, readImageTableColumnOverrides, recognizeImageColumnSource } = await import(
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

test("recognition accepts configured fields and supported formulas", () => {
  const keys = new Set(["A", "B", "CWR_new", "CWR_old"]);
  assert.deepEqual(recognizeImageColumnSource("A", keys),
    { recognized: true, source: "A", kind: "keyword", unverifiedKeys: [] });
  assert.deepEqual(recognizeImageColumnSource("log2(CWR_new / CWR_old)", keys),
    { recognized: true, source: "=log2(CWR_new / CWR_old)", kind: "formula", unverifiedKeys: [] });
  assert.deepEqual(recognizeImageColumnSource("=CWR_new - CWR_old", keys),
    { recognized: true, source: "=CWR_new - CWR_old", kind: "formula", unverifiedKeys: [] });
  assert.deepEqual(recognizeImageColumnSource("=log2(A / NEW_TAG)", keys),
    { recognized: true, source: "=log2(A / NEW_TAG)", kind: "formula", unverifiedKeys: ["NEW_TAG"] });
  for (const invalid of ["=A +", "=sqrt(A)", "=A;alert(1)", "BAD KEY", "=A B"]) {
    assert.equal(recognizeImageColumnSource(invalid, keys).recognized, false, invalid);
  }
});

test("AEGain recognizes its old and new ratio pair only in the built-in column", () => {
  const source = "FLinkTar_old / BackTar_old(FLinkTar_new / BackTar_new)";
  const keys = new Set(["FLinkTar_old", "BackTar_old", "FLinkTar_new", "BackTar_new"]);
  assert.equal(isAeGainPairSource(source), true);
  assert.deepEqual(recognizeImageColumnSource(source, keys, "aeGain"),
    { recognized: true, source: AE_GAIN_PAIR_SOURCE, kind: "formula", unverifiedKeys: [] });
  assert.deepEqual(imageColumnSourceKeys(AE_GAIN_PAIR_SOURCE), [...keys]);
  assert.equal(recognizeImageColumnSource(source, keys, "delta").recognized, false);
  assert.equal(isAeGainPairSource("FLinkTar_new / BackTar_new"), false);
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
