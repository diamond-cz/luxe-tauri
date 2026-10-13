import assert from "node:assert/strict";
import test from "node:test";
import { classifyImageTableRow, shouldShowImageTableRow } from "./imageTableClassification.ts";

const emptyFace = {
  aeGain: "-",
  normalCwr: "-",
  backCwr: "-",
  cwr: "-",
  normalDelta: null,
  backDelta: null,
  linkDelta: null,
};

test("portrait requires AEGain and FDY", () => {
  const face = { ...emptyFace, aeGain: "1.20(1.25)" };
  assert.equal(classifyImageTableRow({ FDY: "45" }, face, "FDY", ["FDY"]), "portrait");
  assert.equal(classifyImageTableRow({}, face, "FDY", ["FDY"]), "na");
  assert.equal(classifyImageTableRow({ FDY: "45" }, emptyFace, "FDY", ["FDY"]), "scene");
});

test("scene requires a value after AEGain; otherwise the row is NA", () => {
  assert.equal(classifyImageTableRow({ Normal: "120" }, emptyFace, "FDY", ["Normal"]), "scene");
  assert.equal(classifyImageTableRow({}, { ...emptyFace, normalDelta: 0 }, "FDY", []), "scene");
  assert.equal(classifyImageTableRow({ Normal: "-" }, emptyFace, "FDY", ["Normal"]), "na");
});

test("filter includes NA only when both kinds have the same visibility", () => {
  const kinds = ["scene", "portrait", "na"];
  assert.deepEqual(kinds.filter((kind) => shouldShowImageTableRow(kind, true, true)), kinds);
  assert.deepEqual(kinds.filter((kind) => shouldShowImageTableRow(kind, true, false)), ["scene"]);
  assert.deepEqual(kinds.filter((kind) => shouldShowImageTableRow(kind, false, true)), ["portrait"]);
  assert.deepEqual(kinds.filter((kind) => shouldShowImageTableRow(kind, false, false)), ["na"]);
});
