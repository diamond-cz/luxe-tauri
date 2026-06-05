import { APP_VERSION } from "@/services/appVersion";

export const GITHUB_REPOSITORY_URL = "https://github.com/diamond-cz/LUXE";
export const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases`;
export const LATEST_RELEASE_API_URL = "https://api.github.com/repos/diamond-cz/LUXE/releases/latest";
export const CURRENT_VERSION = APP_VERSION;

interface GithubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
}

export interface UpdateCheckResult {
  status: "ok" | "available";
  currentVersion: string;
  latestVersion: string;
  releaseName?: string;
  releaseUrl: string;
  publishedAt?: string;
  notes?: string;
  checkedAt: number;
}

export async function checkForUpdate(signal?: AbortSignal): Promise<UpdateCheckResult> {
  const res = await fetch(LATEST_RELEASE_API_URL, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);

  const data = await res.json() as GithubRelease;
  const latestVersion = normaliseVersion(data.tag_name ?? "");
  if (!latestVersion) throw new Error("未找到最新版本号");

  const releaseUrl = data.html_url ?? releaseUrlFromTag(data.tag_name, latestVersion);
  const status = compareVersions(latestVersion, CURRENT_VERSION) > 0
    ? "available"
    : "ok";

  return {
    status,
    currentVersion: CURRENT_VERSION,
    latestVersion,
    releaseName: data.name,
    releaseUrl,
    publishedAt: data.published_at,
    notes: data.body,
    checkedAt: Date.now(),
  };
}

export function normaliseVersion(raw: string): string | null {
  const match = raw.trim().match(/^v?(\d+(?:\.\d+){0,2})/i);
  return match?.[1] ?? null;
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));
  const len = Math.max(left.length, right.length, 3);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function releaseUrlFromTag(tagName: string | undefined, version: string): string {
  const tag = tagName?.trim() || `v${version}`;
  return `${GITHUB_REPOSITORY_URL}/releases/tag/${encodeURIComponent(tag)}`;
}
