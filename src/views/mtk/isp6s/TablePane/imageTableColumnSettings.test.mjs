import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./imageTableColumnSettings.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { normalizeColumnMode, readLegacyColumnMode } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("legacy table settings become independent tab snapshots", () => {
  const store = new Map([
    ["luxe:isp6s:image-table-column-order", JSON.stringify(["cwr", "ev"])],
    ["luxe:isp6s:image-table-column-visibility", JSON.stringify(["ev"])],
    ["luxe:isp6s:image-table-column-edits", JSON.stringify({ ev: { label: "EV" } })],
    ["luxe:isp6s:image-table-custom-columns", JSON.stringify([
      { id: "face-1", label: "Face", source: "A", scope: "face" },
      { id: "normal-1", label: "Normal", source: "B", scope: "normal" },
    ])],
  ]);
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null };
  const settings = readLegacyColumnMode("isp6s");
  assert.deepEqual(settings.all.hidden, ["ev"]);
  assert.equal(settings.face.custom[0].id, "face-1");
  assert.equal(settings.normal.custom[0].id, "normal-1");
  assert.equal(settings.all.custom.length, 0);

  settings.face.hidden.push("cwr");
  settings.face.edits.ev.label = "Face EV";
  assert.deepEqual(settings.all.hidden, ["ev"]);
  assert.equal(settings.normal.edits.ev.label, "EV");
});

test("saved tab settings discard custom columns assigned to another tab", () => {
  const settings = normalizeColumnMode({
    all: { order: ["ev"], hidden: [], deleted: [], edits: {}, custom: [] },
    face: { order: [], hidden: ["ev"], deleted: [], edits: {}, custom: [
      { id: "face-1", label: "Face", source: "A", scope: "face" },
      { id: "normal-1", label: "Normal", source: "B", scope: "normal" },
    ] },
    normal: { order: [], hidden: [], deleted: [], edits: {}, custom: [] },
  });
  assert.deepEqual(settings.face.custom.map((column) => column.id), ["face-1"]);
  assert.deepEqual(settings.normal.hidden, []);
});
