import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const tag = process.env.BASE_TAG;
const runNumber = process.env.RUN_NUMBER;
const configPath = "src-tauri/tauri.conf.json";
const output = process.env.GITHUB_OUTPUT;

if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? "")) {
  throw new Error(`Expected latest stable release tag, received: ${tag}`);
}
if (!/^\d+$/.test(runNumber ?? "") || Number(runNumber) < 1) {
  throw new Error(`Expected a positive workflow run number, received: ${runNumber}`);
}

const [major, minor, patch] = tag.slice(1).split(".").map(Number);
const baseVersion = `${major}.${minor}.${patch}`;
const appVersion = `${major}.${minor}.${patch + 1}-star.${runNumber}`;
const config = JSON.parse(readFileSync(configPath, "utf8"));
config.version = appVersion;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

if (output) {
  appendFileSync(output, `base_version=${baseVersion}\n`);
  appendFileSync(output, `app_version=${appVersion}\n`);
  appendFileSync(output, `tag=${tag}\n`);
}
console.log(`Prepared Star build ${appVersion} from ${tag}`);
