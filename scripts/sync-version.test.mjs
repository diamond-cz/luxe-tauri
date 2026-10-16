import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function withProject(callback) {
  const root = mkdtempSync(path.join(os.tmpdir(), "luxe-version-test-"));
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "src-tauri"));
  const script = path.join(root, "scripts", "sync-version.mjs");
  copyFileSync(path.join(import.meta.dirname, "sync-version.mjs"), script);
  const files = {
    "src-tauri/tauri.conf.json": `${JSON.stringify({ version: "1.2.3" }, null, 2)}\n`,
    "package.json": `${JSON.stringify({ name: "luxe-tauri", version: "1.2.3" }, null, 2)}\n`,
    "package-lock.json": `${JSON.stringify({ version: "1.2.3", packages: { "": { version: "1.2.3" } } }, null, 2)}\n`,
    "src-tauri/Cargo.toml": '[package]\nname = "luxe-tauri"\nversion = "1.2.3"\n',
    "src-tauri/Cargo.lock": '[[package]]\nname = "luxe-tauri"\nversion = "1.2.3"\n\n[[package]]\nname = "dependency"\nversion = "0.1.0"\n',
  };
  for (const [file, content] of Object.entries(files)) writeFileSync(path.join(root, file), content);
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  try { callback({ root, files, run }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("synchronized metadata passes read-only validation", () => withProject(({ run }) => {
  const result = run("--check");
  assert.equal(result.status, 0, result.stderr);
}));

test("Windows checkout line endings pass validation without rewriting files", () => withProject(({ root, files, run }) => {
  for (const [file, content] of Object.entries(files)) {
    files[file] = content.replaceAll("\n", "\r\n");
    writeFileSync(path.join(root, file), files[file]);
  }
  for (const args of [["--check"], []]) {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    for (const [file, content] of Object.entries(files)) {
      assert.equal(readFileSync(path.join(root, file), "utf8"), content);
    }
  }
}));

test("check reports all stale files without changing any", () => withProject(({ root, files, run }) => {
  for (const [file, content] of Object.entries(files)) {
    if (file.endsWith("tauri.conf.json")) continue;
    files[file] = content.replaceAll("1.2.3", "1.2.2");
    writeFileSync(path.join(root, file), files[file]);
  }
  const result = run("--check");
  assert.notEqual(result.status, 0);
  for (const [file, content] of Object.entries(files)) {
    assert.equal(readFileSync(path.join(root, file), "utf8"), content);
    if (!file.endsWith("tauri.conf.json")) assert.ok(result.stderr.includes(file.replaceAll("/", path.sep)));
  }
}));

test("sync updates application metadata and preserves dependency versions", () => withProject(({ root, run }) => {
  writeFileSync(path.join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "2.0.0" }));
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  result = run("--check");
  assert.equal(result.status, 0, result.stderr);
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.version, "2.0.0");
  assert.equal(lock.packages[""].version, "2.0.0");
  const cargoLock = readFileSync(path.join(root, "src-tauri/Cargo.lock"), "utf8");
  assert.match(cargoLock, /name = "luxe-tauri"\nversion = "2.0.0"/);
  assert.match(cargoLock, /name = "dependency"\nversion = "0.1.0"/);
}));

test("check fails when a required lockfile is missing", () => withProject(({ root, run }) => {
  rmSync(path.join(root, "package-lock.json"));
  rmSync(path.join(root, "src-tauri/Cargo.lock"));
  const result = run("--check");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package-lock.json/);
  assert.match(result.stderr, /Cargo.lock/);
}));

for (const file of ["package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
  test(`reject missing version metadata in ${file}`, () => withProject(({ root, files, run }) => {
    const content = file.endsWith(".json") ? "{}" : files[file].replace(/version = "1.2.3"\n/, "");
    writeFileSync(path.join(root, file), content);
    const result = run("--check");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing.*version/);
    assert.equal(readFileSync(path.join(root, file), "utf8"), content);
  }));
}
