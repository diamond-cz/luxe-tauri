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

test("custom columns join multiple TOML fields in input order", () => {
  assert.deepEqual(imageColumnSourceKeys("=join(A, B, A)"), ["A", "B"]);
  assert.deepEqual(imageColumnSourceKeys("=list(A, B, A)"), ["A", "B"]);
  assert.equal(customImageColumnText("=join(A, B, A)", lookup), "8, 2, 8");
  assert.equal(customImageColumnText("=list(A, B, A)", lookup), "[8, 2, 8]");
  const example = "=join(AE_TAG_PURE_AE_CWR_STABLE, AE_TAG_LINK_FACE_CWR_STABLE, AE_TAG_LINK_FACE_CWR_STABLE)";
  assert.deepEqual(imageColumnSourceKeys(example), ["AE_TAG_PURE_AE_CWR_STABLE", "AE_TAG_LINK_FACE_CWR_STABLE"]);
  assert.equal(customImageColumnText(example, (key) => ({
    AE_TAG_PURE_AE_CWR_STABLE: "1024", AE_TAG_LINK_FACE_CWR_STABLE: "512",
  })[key] ?? "-"), "1024, 512, 512");
  assert.equal(customImageColumnText("=list(A, C, B)", lookup), "[8, -, 2]");
});

test("join supports quoted separators without fetching them as TOML fields", () => {
  const keys = new Set(["A", "B"]);
  for (const [source, display] of [
    ['=join(A, "-", B)', "8-2"],
    ['join(A, "|", B)', "8|2"],
    ['=join(A, “-”, B)', "8-2"],
    ['=join(A, ", ", B)', "8, 2"],
    ['=join(A, " / ", B, "!", A)', "8 / 2!8"],
  ]) {
    const recognized = recognizeImageColumnSource(source, keys);
    assert.equal(recognized.recognized, true, source);
    assert.deepEqual(imageColumnSourceKeys(recognized.source), ["A", "B"]);
    assert.equal(customImageColumnText(recognized.source, lookup), display);
  }
  assert.deepEqual(recognizeImageColumnSource('=join(A, "B", MISSING)', keys),
    { recognized: true, source: '=join(A, "B", MISSING)', kind: "formula", unverifiedKeys: ["MISSING"] });
});

test("list evaluates nested join and collects aliases in order", () => {
  const source = '=list(join(Normal_old,"|",Normal_new),BackTar_new,FLinkTar_new)';
  const keys = new Set(["Normal_old", "Normal_new", "BackTar_new", "FLinkTar_new"]);
  const aliasValues = { Normal_old: "1024", Normal_new: "2048", BackTar_new: "512", FLinkTar_new: "4096" };
  assert.deepEqual(recognizeImageColumnSource(source, keys),
    { recognized: true, source, kind: "formula", unverifiedKeys: [] });
  assert.deepEqual(imageColumnSourceKeys(source), [...keys]);
  assert.equal(customImageColumnText(source, (key) => aliasValues[key] ?? "-"), "[1024|2048, 512, 4096]");
  assert.equal(customImageColumnText('=join(A, "-", list(B, A))', lookup), "8-[2, 8]");
  assert.deepEqual(recognizeImageColumnSource('=list(join(A, "|", UNKNOWN), B)', new Set(["A", "B"])),
    { recognized: true, source: '=list(join(A, "|", UNKNOWN), B)', kind: "formula", unverifiedKeys: ["UNKNOWN"] });
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
  assert.equal(recognizeImageColumnSource("=join(A, B)", keys).recognized, true);
  assert.deepEqual(recognizeImageColumnSource("=join(A, NEW_TAG, NEW_TAG)", keys),
    { recognized: true, source: "=join(A, NEW_TAG, NEW_TAG)", kind: "formula", unverifiedKeys: ["NEW_TAG"] });
  for (const invalid of ["=list(A + B)", "=join(A,)", "=list()", "=join(A,,B)", '=list(A, "-", B)', '=join("-", "|")', '=join(A, "unterminated, B)', '=list(join(A, "-", B),)', '=list(join(A, "-", B), sqrt(A))', '=list(join(A, "-", B)']) {
    assert.equal(recognizeImageColumnSource(invalid, keys).recognized, false, invalid);
    assert.equal(customImageColumnText(invalid, lookup), "-", invalid);
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
