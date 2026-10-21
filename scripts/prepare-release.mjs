import { appendFileSync, createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { releaseNotesFor } from "./release-notes.mjs";

const tag = process.argv[2];
const repository = process.env.GITHUB_REPOSITORY;
if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? "")) throw new Error("Expected a stable vX.Y.Z tag");
if (repository !== "diamond-cz/luxe-tauri") throw new Error(`Unexpected repository: ${repository}`);

const version = tag.slice(1);
const appVersion = process.env.APP_VERSION ?? version;
const isStarBuild = process.env.STAR_BUILD === "true";
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
if (config.version !== appVersion) throw new Error(`Expected app version ${appVersion}; found ${config.version}`);
if (!/^\d+\.\d+\.\d+(?:-\d+)?$/.test(appVersion)) throw new Error(`Invalid app version: ${appVersion}`);
const notes = isStarBuild
  ? `# LUXE ${appVersion}\n\nStar-triggered build based on ${tag}.\n`
  : releaseNotesFor(version);

const bundle = path.join(path.resolve(process.env.CARGO_TARGET_DIR ?? "src-tauri/target"), "release", "bundle");
const files = (folder) => readdirSync(path.join(bundle, folder)).map((name) => path.join(bundle, folder, name));
const exactlyOne = (items, pattern, label) => {
  const matches = items.filter((file) => pattern.test(file));
  if (matches.length !== 1 || !statSync(matches[0]).isFile() || statSync(matches[0]).size === 0) {
    throw new Error(`Expected one nonempty ${label}; found ${matches.length}`);
  }
  return matches[0];
};

const nsis = files("nsis");
const installer = exactlyOne(nsis, /-setup\.exe$/i, "NSIS installer");
const signature = exactlyOne(nsis, /-setup\.exe\.sig$/i, "NSIS updater signature");
const msi = exactlyOne(files("msi"), /\.msi$/i, "MSI installer");
if (signature !== `${installer}.sig`) throw new Error("NSIS installer and signature names do not match");
if (!path.basename(installer).endsWith(`_${appVersion}_x64-setup.exe`) ||
    !path.basename(msi).includes(`_${appVersion}_x64_`)) {
  throw new Error("Installer filenames must match the release version and x64 architecture");
}
const signatureText = readFileSync(signature, "utf8").trim();
if (!signatureText) throw new Error("NSIS updater signature must not be blank");

const manifest = path.join(bundle, "latest.json");
const assetName = path.basename(installer);
const githubAssetUrl = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(assetName)}`;
writeFileSync(manifest, `${JSON.stringify({
  version: isStarBuild ? appVersion : version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      url: `https://gh-proxy.com/${githubAssetUrl}`,
      signature: signatureText,
    },
  },
}, null, 2)}\n`);

const assets = [installer, signature, msi, manifest];
const checksums = path.join(bundle, "SHA256SUMS.txt");
const lines = [];
for (const file of assets) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${path.basename(file)}`);
}
writeFileSync(checksums, `${lines.join("\n")}\n`);
assets.push(checksums);
const notesFile = path.join(bundle, "release-notes.md");
writeFileSync(notesFile, notes);
const output = process.env.GITHUB_OUTPUT;
if (output) {
  for (const [index, file] of assets.entries()) {
    appendFileSync(output, `asset${index + 1}=${file}\n`);
  }
  appendFileSync(output, `notesFile=${notesFile}\n`);
}
console.log(`Validated ${assets.length} release assets for ${tag}`);
