import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");
const packageJsonPath = path.join(root, "package.json");
const packageLockPath = path.join(root, "package-lock.json");
const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
const cargoLockPath = path.join(root, "src-tauri", "Cargo.lock");

const tauriConfig = readJson(tauriConfigPath);
const version = tauriConfig.version;

if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid src-tauri/tauri.conf.json version: ${String(version)}`);
}

syncPackageJson();
syncPackageLock();
syncCargoToml();
syncCargoLock();

function syncPackageJson() {
  const pkg = readJson(packageJsonPath);
  pkg.version = version;
  writeJsonIfChanged(packageJsonPath, pkg);
}

function syncPackageLock() {
  if (!existsSync(packageLockPath)) return;

  const lock = readJson(packageLockPath);
  if (typeof lock.version === "string") lock.version = version;
  if (lock.packages?.[""] && typeof lock.packages[""] === "object") {
    lock.packages[""].version = version;
  }
  writeJsonIfChanged(packageLockPath, lock);
}

function syncCargoToml() {
  const input = readFileSync(cargoTomlPath, "utf8");
  const output = input.replace(/(^version\s*=\s*)"[^"]+"/m, `$1"${version}"`);
  writeTextIfChanged(cargoTomlPath, output);
}

function syncCargoLock() {
  if (!existsSync(cargoLockPath)) return;

  const input = readFileSync(cargoLockPath, "utf8");
  const output = input.replace(
    /(\[\[package\]\]\r?\nname = "luxe-tauri"\r?\nversion = )"[^"]+"/,
    `$1"${version}"`,
  );
  writeTextIfChanged(cargoLockPath, output);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonIfChanged(filePath, value) {
  writeTextIfChanged(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextIfChanged(filePath, output) {
  const input = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  if (input !== output) writeFileSync(filePath, output, "utf8");
}
