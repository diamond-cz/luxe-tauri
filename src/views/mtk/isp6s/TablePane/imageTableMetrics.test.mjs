import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./imageTableMetrics.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { deltaEv, formatDeltaEv, metricDirection, parseMetricResult, selectImageTableEv } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("Delta EV uses the selected old and new CWR pair", () => {
  assert.equal(formatDeltaEv(deltaEv(100, 101)), "+0.014");
  assert.equal(formatDeltaEv(deltaEv(101, 100)), "-0.014");
  assert.equal(formatDeltaEv(deltaEv(0, 100)), "-");
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

test("edited metric formulas retain numeric threshold formatting", () => {
  assert.equal(formatDeltaEv(parseMetricResult("-0.006")), "-0.006");
  assert.equal(metricDirection(parseMetricResult("-6"), 5), "negative");
  assert.equal(parseMetricResult("-"), null);
});
