import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");
const packageJsonPath = path.join(root, "package.json");
const packageLockPath = path.join(root, "package-lock.json");
const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
const cargoLockPath = path.join(root, "src-tauri", "Cargo.lock");
const checkOnly = process.argv.includes("--check");
const outdated = [];

const tauriConfig = readJson(tauriConfigPath);
const version = tauriConfig.version;

if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid src-tauri/tauri.conf.json version: ${String(version)}`);
}

syncPackageJson();
syncPackageLock();
syncCargoToml();
syncCargoLock();

if (outdated.length) {
  throw new Error(`Version metadata is out of sync: ${outdated.join(", ")}. Run npm run version:sync and commit the changes.`);
}

function syncPackageJson() {
  const pkg = readJson(packageJsonPath);
  pkg.version = version;
  writeJsonIfChanged(packageJsonPath, pkg);
}

function syncPackageLock() {
  if (!existsSync(packageLockPath)) {
    if (checkOnly) outdated.push(path.relative(root, packageLockPath));
    return;
  }

  const lock = readJson(packageLockPath);
  if (typeof lock.version !== "string" || typeof lock.packages?.[""]?.version !== "string") {
    throw new Error("package-lock.json is missing root package version metadata");
  }
  lock.version = version;
  lock.packages[""].version = version;
  writeJsonIfChanged(packageLockPath, lock);
}

function syncCargoToml() {
  const input = readFileSync(cargoTomlPath, "utf8");
  const pattern = /(^version\s*=\s*)"[^"]+"/m;
  if (!pattern.test(input)) throw new Error("Cargo.toml is missing the application version");
  const output = input.replace(pattern, `$1"${version}"`);
  writeTextIfChanged(cargoTomlPath, output);
}

function syncCargoLock() {
  if (!existsSync(cargoLockPath)) {
    if (checkOnly) outdated.push(path.relative(root, cargoLockPath));
    return;
  }

  const input = readFileSync(cargoLockPath, "utf8");
  const pattern = /(\[\[package\]\]\r?\nname = "luxe-tauri"\r?\nversion = )"[^"]+"/;
  if (!pattern.test(input)) throw new Error("Cargo.lock is missing the luxe-tauri package version");
  const output = input.replace(
    pattern,
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
  if (input === output) return;
  if (checkOnly) outdated.push(path.relative(root, filePath));
  else writeFileSync(filePath, output, "utf8");
}
