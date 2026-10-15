import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const signingFiles = {
  TAURI_SIGNING_PRIVATE_KEY: ".tauri-updater.key",
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ".tauri-updater.password",
};

const env = { ...process.env };
for (const [name, filename] of Object.entries(signingFiles)) {
  if (env[name]) continue;

  const file = path.join(root, filename);
  if (!existsSync(file)) {
    console.error(`Missing ${name}: set the environment variable or create ${filename} in the project root.`);
    process.exit(1);
  }

  const value = readFileSync(file, "utf8").replace(/\r?\n$/, "");
  if (!value) {
    console.error(`${filename} is empty.`);
    process.exit(1);
  }
  env[name] = value;
}

const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(process.execPath, [cli, "build", ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Could not start Tauri CLI: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
