import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./columnSettingsPlacement.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { columnSettingsPlacement } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("settings window stays on a secondary monitor left of the primary", () => {
  const bounds = columnSettingsPlacement({
    scaleFactor: 1,
    workArea: { position: { x: -1920, y: 0 }, size: { width: 1920, height: 1040 } },
  });
  assert.deepEqual(bounds, { x: -1420, y: 160, width: 920, height: 720, minWidth: 680, minHeight: 500 });
});

test("settings window uses the target monitor scale and available height", () => {
  const bounds = columnSettingsPlacement({
    scaleFactor: 2,
    workArea: { position: { x: 2560, y: -120 }, size: { width: 2560, height: 1320 } },
  });
  assert.deepEqual(bounds, { x: 1460, y: -44, width: 920, height: 628, minWidth: 680, minHeight: 500 });
});
