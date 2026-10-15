import { check, type Update } from "@tauri-apps/plugin-updater";
import { APP_VERSION } from "@/services/appVersion";

export const GITHUB_REPOSITORY_OWNER = "diamond-cz";
export const GITHUB_REPOSITORY_NAME = "luxe-tauri";
export const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}`;
export const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases`;
export const CURRENT_VERSION = APP_VERSION;

export interface UpdateCheckResult {
  status: "ok" | "available";
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  publishedAt?: string;
  notes?: string;
  checkedAt: number;
  update: Update | null;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const update = await check({ timeout: 15000 });
  return {
    status: update ? "available" : "ok",
    currentVersion: CURRENT_VERSION,
    latestVersion: update?.version ?? null,
    releaseUrl: update ? `${GITHUB_RELEASES_URL}/tag/v${update.version}` : GITHUB_RELEASES_URL,
    publishedAt: update?.date,
    notes: update?.body,
    checkedAt: Date.now(),
    update,
  };
}
