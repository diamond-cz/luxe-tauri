import changelog from "@/data/changelog.json";

export interface UpdateNoteItem {
  type: string;
  content: string;
}

export function getUpdateNotes(version: string, body: string | null): UpdateNoteItem[] {
  const local = changelog.find((entry) => entry.version === version);
  if (local) return local.items;

  const items: UpdateNoteItem[] = [];
  let sectionType = "";
  for (const rawLine of (body ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      sectionType = heading[1].trim();
      continue;
    }
    const tagged = /^[-*]\s+\[([^\]]+)\]\s+(.+)$/.exec(line);
    if (tagged) {
      items.push({ type: tagged[1].trim(), content: tagged[2].trim() });
      continue;
    }
    const legacy = /^[-*]\s+\*\*(.+?)\*\*\s*[：:]\s*(.+)$/.exec(line);
    if (legacy) {
      items.push({ type: sectionType, content: `${legacy[1]}：${legacy[2]}` });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) items.push({ type: sectionType, content: bullet[1].trim() });
  }
  if (items.length) return items;
  return (body ?? "").split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !/^#|^\[.+\]\(.+\)$|^日期[：:]/.test(line))
    .map((content) => ({ type: "", content }));
}
