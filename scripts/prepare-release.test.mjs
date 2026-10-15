import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

function withPackages(callback) {
  const target = mkdtempSync(path.join(os.tmpdir(), "luxe-release-test-"));
  const bundle = path.join(target, "release", "bundle");
  const nsis = path.join(bundle, "nsis");
  const msi = path.join(bundle, "msi");
  mkdirSync(nsis, { recursive: true });
  mkdirSync(msi);
  writeFileSync(path.join(nsis, "LUXE_0.1.3_x64-setup.exe"), "installer");
  writeFileSync(path.join(nsis, "LUXE_0.1.3_x64-setup.exe.sig"), "signature");
  writeFileSync(path.join(msi, "LUXE_0.1.3_x64_zh-CN.msi"), "msi");
  try { callback({ target, bundle, nsis }); } finally { rmSync(target, { recursive: true, force: true }); }
}

function run(target, tag = "v0.1.3") {
  return spawnSync(process.execPath, ["scripts/prepare-release.mjs", tag], {
    cwd: projectRoot,
    env: { ...process.env, CARGO_TARGET_DIR: target, GITHUB_REPOSITORY: "diamond-cz/luxe-tauri" },
    encoding: "utf8",
  });
}

test("manifest points to the signed NSIS installer", () => withPackages(({ target, bundle }) => {
  const result = run(target);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(path.join(bundle, "latest.json"), "utf8"));
  assert.equal(manifest.version, "0.1.3");
  assert.equal(manifest.platforms["windows-x86_64"].signature, "signature");
  assert.match(manifest.platforms["windows-x86_64"].url, /LUXE_0\.1\.3_x64-setup\.exe$/);
}));

test("missing signature prevents manifest generation", () => withPackages(({ target, nsis }) => {
  rmSync(path.join(nsis, "LUXE_0.1.3_x64-setup.exe.sig"));
  const result = run(target);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /signature/);
}));

test("tag must match application version", () => withPackages(({ target }) => {
  const result = run(target, "v0.1.4");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
}));
