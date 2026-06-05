import { APP_VERSION } from "@/services/appVersion";

export const GITHUB_REPOSITORY_OWNER = "diamond-cz";
export const GITHUB_REPOSITORY_NAME = "luxe-tauri";
export const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}`;
export const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases`;
export const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}/releases`;
export const LATEST_RELEASE_API_URL = `${RELEASES_API_URL}/latest`;
export const CURRENT_VERSION = APP_VERSION;

interface GithubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface UpdateCheckResult {
  status: "ok" | "available" | "unknown";
  currentVersion: string;
  latestVersion: string | null;
  releaseName?: string;
  releaseUrl: string;
  publishedAt?: string;
  notes?: string;
  message?: string;
  checkedAt: number;
}

export async function checkForUpdate(signal?: AbortSignal): Promise<UpdateCheckResult> {
  const data = await fetchLatestRelease(signal);
  if (!data) {
    return manualCheckResult("无法通过 GitHub API 自动判断版本，请打开 Releases 页面查看");
  }

  const latestVersion = normaliseVersion(data.tag_name ?? "");
  if (!latestVersion) {
    return manualCheckResult("GitHub Release 未找到可解析的版本号，请打开 Releases 页面查看");
  }

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

async function fetchLatestRelease(signal?: AbortSignal): Promise<GithubRelease | null> {
  const latestRes = await fetchGithub(LATEST_RELEASE_API_URL, signal);
  if (latestRes.ok) return await latestRes.json() as GithubRelease;

  // GitHub returns 404 for `/latest` when the repo has only prereleases.
  // Fall back to the release list so a manually created prerelease still works.
  if (latestRes.status === 404) {
    const listRes = await fetchGithub(`${RELEASES_API_URL}?per_page=10`, signal);
    if (listRes.ok) {
      const releases = await listRes.json() as GithubRelease[];
      const release = releases.find((item) => item.tag_name && !item.draft);
      if (release) return release;
      return null;
    }
    if (listRes.status === 404) return null;
  }

  throw new Error(
    `GitHub 返回 ${latestRes.status}，请确认仓库 ${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME} 存在且 Release 已发布`,
  );
}

function manualCheckResult(message: string): UpdateCheckResult {
  return {
    status: "unknown",
    currentVersion: CURRENT_VERSION,
    latestVersion: null,
    releaseUrl: GITHUB_RELEASES_URL,
    message,
    checkedAt: Date.now(),
  };
}

function fetchGithub(url: string, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal,
  });
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
