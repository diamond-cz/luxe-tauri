import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.join(import.meta.dirname, "prepare-star-version.mjs");

function withProject(callback) {
  const root = mkdtempSync(path.join(os.tmpdir(), "luxe-star-version-test-"));
  mkdirSync(path.join(root, "src-tauri"));
  writeFileSync(path.join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ version: "0.0.0" }));
  try { callback(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("Star version increments the latest stable patch and uses a numeric MSI pre-release", () => withProject((root) => {
  const output = path.join(root, "outputs.txt");
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, BASE_TAG: "v1.4.9", RUN_NUMBER: "37", GITHUB_OUTPUT: output },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")), { version: "1.4.10-37" });
  assert.equal(readFileSync(output, "utf8"), "base_version=1.4.9\napp_version=1.4.10-37\ntag=v1.4.9\n");
}));

for (const [tag, runNumber] of [["v1.2.3-beta.1", "1"], ["v01.2.3", "1"], ["v1.2.3", "0"], ["v1.2.3", "65536"]]) {
  test(`invalid Star build input is rejected (${tag}, ${runNumber})`, () => withProject((root) => {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, BASE_TAG: tag, RUN_NUMBER: runNumber },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
  }));
}
