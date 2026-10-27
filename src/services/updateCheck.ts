import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { APP_VERSION, UPDATER_MANIFEST_URL } from "@/services/appVersion";

export const GITHUB_REPOSITORY_OWNER = "diamond-cz";
export const GITHUB_REPOSITORY_NAME = "luxe-tauri";
export const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}`;
export const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases`;
export const CURRENT_VERSION = APP_VERSION;

export interface UpdateCheckResult {
  status: "ok" | "available" | "manual";
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  publishedAt?: string;
  notes?: string;
  checkedAt: number;
  update: Update | null;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = await getVersion();
  const update = await check({
    timeout: 15000,
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!update) {
    const endpoint = new URL(UPDATER_MANIFEST_URL);
    endpoint.searchParams.set("checked_at", String(Date.now()));
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`更新清单读取失败：HTTP ${response.status}`);
    const manifest: unknown = await response.json();
    if (!manifest || typeof manifest !== "object" || !("version" in manifest)
      || typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      throw new Error("更新清单缺少有效版本号");
    }
    const newer = isNewerStableVersion(manifest.version, currentVersion);
    if (newer === null) throw new Error("无法比较当前版本与更新清单版本");
    return {
      status: newer ? "manual" : "ok",
      currentVersion,
      latestVersion: manifest.version,
      releaseUrl: `${GITHUB_RELEASES_URL}/tag/v${manifest.version}`,
      notes: "notes" in manifest && typeof manifest.notes === "string" ? manifest.notes : undefined,
      checkedAt: Date.now(),
      update: null,
    };
  }
  return {
    status: "available",
    currentVersion: update.currentVersion || currentVersion,
    latestVersion: update.version,
    releaseUrl: `${GITHUB_RELEASES_URL}/tag/v${update.version}`,
    publishedAt: update.date,
    notes: update.body,
    checkedAt: Date.now(),
    update,
  };
}

function isNewerStableVersion(remote: string, current: string): boolean | null {
  const currentMatch = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(current);
  if (!currentMatch) return null;
  const remoteParts = remote.split(".").map(Number);
  const currentParts = currentMatch.slice(1, 4).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (remoteParts[index] !== currentParts[index]) return remoteParts[index] > currentParts[index];
  }
  return current.includes("-");
}
