import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { releaseNotesFor } from "./release-notes.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(path.join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8")).version;
const nsisName = `LUXE_${version}_x64-setup.exe`;

function withPackages(callback) {
  const target = mkdtempSync(path.join(os.tmpdir(), "luxe-release-test-"));
  const bundle = path.join(target, "release", "bundle");
  const nsis = path.join(bundle, "nsis");
  const msi = path.join(bundle, "msi");
  mkdirSync(nsis, { recursive: true });
  mkdirSync(msi);
  writeFileSync(path.join(nsis, nsisName), "installer");
  writeFileSync(path.join(nsis, `${nsisName}.sig`), "signature");
  writeFileSync(path.join(msi, `LUXE_${version}_x64_zh-CN.msi`), "msi");
  try { callback({ target, bundle, nsis }); } finally { rmSync(target, { recursive: true, force: true }); }
}

function run(target, tag = `v${version}`, env = {}) {
  return spawnSync(process.execPath, ["scripts/prepare-release.mjs", tag], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: target,
      GITHUB_REPOSITORY: "diamond-cz/luxe-tauri",
      GITHUB_OUTPUT: path.join(target, "outputs.txt"),
      ...env,
    },
    encoding: "utf8",
  });
}

test("manifest points to the signed NSIS installer", () => withPackages(({ target, bundle }) => {
  const result = run(target);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(path.join(bundle, "latest.json"), "utf8"));
  assert.equal(manifest.version, version);
  assert.equal(manifest.notes, releaseNotesFor(version));
  assert.deepEqual(Object.keys(manifest.platforms), ["windows-x86_64"]);
  assert.equal(manifest.platforms["windows-x86_64"].signature, "signature");
  assert.equal(
    manifest.platforms["windows-x86_64"].url,
    `https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/v${version}/${nsisName}`,
  );
}));

test("missing signature prevents manifest generation", () => withPackages(({ target, nsis }) => {
  rmSync(path.join(nsis, `${nsisName}.sig`));
  const result = run(target);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /signature/);
}));

test("tag must match application version", () => withPackages(({ target }) => {
  const parts = version.split(".").map(Number);
  const result = run(target, `v${parts[0]}.${parts[1]}.${parts[2] + 1}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /app version/);
}));

test("checksums and Actions outputs cover all release assets", () => withPackages(({ target, bundle, nsis }) => {
  const result = run(target);
  assert.equal(result.status, 0, result.stderr);
  const expected = [
    path.join(nsis, nsisName),
    path.join(nsis, `${nsisName}.sig`),
    path.join(bundle, "msi", `LUXE_${version}_x64_zh-CN.msi`),
    path.join(bundle, "latest.json"),
  ];
  const checksums = path.join(bundle, "SHA256SUMS.txt");
  assert.equal(readFileSync(checksums, "utf8"), expected.map((file) =>
    `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${path.basename(file)}\n`,
  ).join(""));
  assert.equal(readFileSync(path.join(target, "outputs.txt"), "utf8"),
    [...expected, checksums].map((file, index) => `asset${index + 1}=${file}\n`).join("") +
    `notesFile=${path.join(bundle, "release-notes.md")}\n`);
  assert.equal(readFileSync(path.join(bundle, "release-notes.md"), "utf8"), releaseNotesFor(version));
}));

test("blank signature prevents manifest generation", () => withPackages(({ target, bundle, nsis }) => {
  writeFileSync(path.join(nsis, `${nsisName}.sig`), " \r\n ");
  const result = run(target);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /signature must not be blank/);
  assert.equal(existsSync(path.join(bundle, "latest.json")), false);
}));

for (const badName of ["LUXE_999.0.0_x64-setup.exe", `LUXE_${version}_arm64-setup.exe`]) {
  test(`reject mismatched installer: ${badName}`, () => withPackages(({ target, nsis }) => {
    renameSync(path.join(nsis, nsisName), path.join(nsis, badName));
    renameSync(path.join(nsis, `${nsisName}.sig`), path.join(nsis, `${badName}.sig`));
    const result = run(target);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /version and x64 architecture/);
  }));
}

test("ambiguous installer output is rejected", () => withPackages(({ target, nsis }) => {
  writeFileSync(path.join(nsis, "old-setup.exe"), "old installer");
  const result = run(target);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected one nonempty NSIS installer; found 2/);
}));

for (const tag of ["v1.2.3-beta.1", "v01.2.3", "1.2.3"]) {
  test(`reject invalid stable tag: ${tag}`, () => withPackages(({ target }) => {
    const result = run(target, tag);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stable vX.Y.Z/);
  }));
}

test("reject unexpected repository", () => withPackages(({ target }) => {
  const result = run(target, `v${version}`, { GITHUB_REPOSITORY: "other/repo" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected repository/);
}));

test("current version has a complete changelog and appears first", () => {
  const entries = JSON.parse(readFileSync(path.join(projectRoot, "src/data/changelog.json"), "utf8"));
  assert.equal(entries[0].version, version);
  assert.equal(new Set(entries.map((entry) => entry.version)).size, entries.length);
  for (const entry of entries) {
    for (const section of entry.sections) {
      assert.ok(["新增", "优化", "修复"].includes(section.title), `Invalid section in ${entry.version}`);
      for (const item of section.items) assert.doesNotMatch(`${item.title} ${item.desc}`, /\?{2,}|\uFFFD/);
    }
  }
  const notes = releaseNotesFor(version);
  assert.ok(notes.startsWith(`# LUXE v${version}\n`));
  assert.ok(notes.includes(entries[0].sections[0].items[0].desc));
});

test("missing, duplicate or incomplete changelog prevents release notes", () => {
  assert.throws(() => releaseNotesFor(version, []), /Expected one changelog entry/);
  const entry = { version, date: "2026-10-16", sections: [] };
  assert.throws(() => releaseNotesFor(version, [entry, entry]), /found 2/);
  assert.throws(() => releaseNotesFor(version, [entry]), /Incomplete changelog/);
});
