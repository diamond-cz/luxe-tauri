import { readFileSync } from "node:fs";

const changelog = JSON.parse(readFileSync(new URL("../src/data/changelog.json", import.meta.url), "utf8"));

export function releaseNotesFor(version, entries = changelog) {
  const matches = entries.filter((entry) => entry.version === version);
  if (matches.length !== 1) throw new Error(`Expected one changelog entry for ${version}; found ${matches.length}`);
  const entry = matches[0];
  if (!entry.sections?.length || entry.sections.some((section) => !section.title || !section.items?.length ||
      section.items.some((item) => !item.title || !item.desc))) {
    throw new Error(`Incomplete changelog entry for ${version}`);
  }
  return [
    `# LUXE v${version}`,
    `日期：${entry.date}`,
    ...entry.sections.map((section) => `## ${section.title}\n\n${section.items.map((item) =>
      `- **${item.title}**：${item.desc}`,
    ).join("\n")}`),
    `[完整提交记录](https://github.com/diamond-cz/luxe-tauri/commits/v${version})`,
  ].join("\n\n") + "\n";
}
