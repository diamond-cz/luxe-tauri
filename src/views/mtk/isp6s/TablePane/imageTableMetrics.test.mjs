import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./imageTableMetrics.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { deltaEv, formatCwrEvTriplet, formatDeltaEv, isCwrDeltaFormula, isCwrEvFormula, metricDirection, parseMetricPair, parseMetricResult, selectImageTableEv } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("Delta EV uses the selected old and new CWR pair", () => {
  assert.equal(formatDeltaEv(deltaEv(100, 101)), "+0.014");
  assert.equal(formatDeltaEv(deltaEv(101, 100)), "-0.014");
  assert.equal(formatDeltaEv(deltaEv(0, 100)), "-");
});

test("recognized CWR EV formula displays Normal, BackTar, FLinkTar in order", () => {
  assert.equal(isCwrEvFormula("log2(CWR_new / CWR_old)"), true);
  assert.equal(isCwrEvFormula("= log2( CWR_new / CWR_old )"), true);
  assert.equal(isCwrEvFormula("=log2(BackTar_new / BackTar_old)"), false);
  assert.equal(isCwrDeltaFormula("= CWR_new - CWR_old"), true);
  assert.equal(formatCwrEvTriplet(deltaEv(100, 101), deltaEv(100, 99), deltaEv(100, 100)),
    "+0.014|-0.014|+0.000");
  assert.equal(formatCwrEvTriplet(null, deltaEv(100, 99), null), "-|-0.014|-");
});

test("mixed image tables select EV from each row's CWR type", () => {
  assert.equal(selectImageTableEv(false, "scene", 0.12, -0.2), 0.12);
  assert.equal(selectImageTableEv(false, "portrait", 0.12, -0.2), -0.2);
  assert.equal(selectImageTableEv(true, undefined, 0.12, -0.2), 0.12);
});

test("EV and CWR colors change only beyond their signed thresholds", () => {
  for (const [threshold, boundary] of [[0.005, 0.005], [5, 5]]) {
    assert.equal(metricDirection(boundary, threshold), null);
    assert.equal(metricDirection(-boundary, threshold), null);
    assert.equal(metricDirection(boundary + 0.0001, threshold), "positive");
    assert.equal(metricDirection(-boundary - 0.0001, threshold), "negative");
  }
});

test("AEGain pair color uses the displayed new minus old value", () => {
  assert.deepEqual(parseMetricPair("1.05(1.11)"), { first: "1.05", second: "1.11", difference: 0.06 });
  assert.equal(metricDirection(parseMetricPair("1.05(1.10)")?.difference ?? null, 0.05), null);
  assert.equal(metricDirection(parseMetricPair("1.10(1.05)")?.difference ?? null, 0.05), null);
  assert.equal(metricDirection(parseMetricPair("1.05(1.11)")?.difference ?? null, 0.05), "positive");
  assert.equal(metricDirection(parseMetricPair("1.11(1.05)")?.difference ?? null, 0.05), "negative");
  assert.equal(parseMetricPair("1.05(-)"), null);
  assert.equal(parseMetricPair("-"), null);
});

test("edited metric formulas retain numeric threshold formatting", () => {
  assert.equal(formatDeltaEv(parseMetricResult("-0.006")), "-0.006");
  assert.equal(metricDirection(parseMetricResult("-6"), 5), "negative");
  assert.equal(parseMetricResult("-"), null);
});
