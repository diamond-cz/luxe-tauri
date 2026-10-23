import { readFileSync } from "node:fs";

const changelog = JSON.parse(readFileSync(new URL("../src/data/changelog.json", import.meta.url), "utf8"));

export function releaseNotesFor(version, entries = changelog) {
  const matches = entries.filter((entry) => entry.version === version);
  if (matches.length !== 1) throw new Error(`Expected one changelog entry for ${version}; found ${matches.length}`);
  const entry = matches[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? "") || !Array.isArray(entry.items) ||
      !entry.items.length || entry.items.some((item) =>
        !["新增", "优化", "修复"].includes(item?.type) ||
        typeof item.content !== "string" || !item.content.trim())) {
    throw new Error(`Incomplete changelog entry for ${version}`);
  }
  return [
    `# LUXE v${version}`,
    `日期：${entry.date}`,
    entry.items.map((item) => `- [${item.type}] ${item.content}`).join("\n"),
    `[完整提交记录](https://github.com/diamond-cz/luxe-tauri/commits/v${version})`,
  ].join("\n\n") + "\n";
}
