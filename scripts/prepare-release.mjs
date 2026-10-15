import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const tag = process.argv[2];
const repository = process.env.GITHUB_REPOSITORY;
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) throw new Error("Expected a stable vX.Y.Z tag");
if (repository !== "diamond-cz/luxe-tauri") throw new Error(`Unexpected repository: ${repository}`);

const version = tag.slice(1);
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
if (config.version !== version) throw new Error(`Tag ${tag} does not match app version ${config.version}`);

const bundle = path.join(path.resolve(process.env.CARGO_TARGET_DIR ?? "src-tauri/target"), "release", "bundle");
const files = (folder) => readdirSync(path.join(bundle, folder)).map((name) => path.join(bundle, folder, name));
const exactlyOne = (items, pattern, label) => {
  const matches = items.filter((file) => pattern.test(file));
  if (matches.length !== 1 || statSync(matches[0]).size === 0) {
    throw new Error(`Expected one nonempty ${label}; found ${matches.length}`);
  }
  return matches[0];
};

const nsis = files("nsis");
const installer = exactlyOne(nsis, /-setup\.exe$/i, "NSIS installer");
const signature = exactlyOne(nsis, /-setup\.exe\.sig$/i, "NSIS updater signature");
const msi = exactlyOne(files("msi"), /\.msi$/i, "MSI installer");
if (signature !== `${installer}.sig`) throw new Error("NSIS installer and signature names do not match");

const manifest = path.join(bundle, "latest.json");
const assetName = path.basename(installer);
writeFileSync(manifest, `${JSON.stringify({
  version,
  notes: `LUXE ${tag}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(assetName)}`,
      signature: readFileSync(signature, "utf8").trim(),
    },
  },
}, null, 2)}\n`);

const assets = [installer, signature, msi, manifest];
const output = process.env.GITHUB_OUTPUT;
if (output) {
  for (const [index, file] of assets.entries()) {
    appendFileSync(output, `asset${index + 1}=${file}\n`);
  }
}
console.log(`Validated ${assets.length} release assets for ${tag}`);
