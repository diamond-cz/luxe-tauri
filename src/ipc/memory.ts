import { invoke, isTauri } from "@tauri-apps/api/core";

let lastTrimAt = 0;
let lastClearAt = 0;
let inFlight: Promise<void> | null = null;

export async function trimMemory(clearCaches = false): Promise<void> {
  if (!isTauri()) return;
  if (inFlight) {
    if (!clearCaches) return;
    await inFlight.catch(() => {});
  }
  const now = Date.now();
  if (clearCaches && now - lastClearAt < 5000) return;
  if (!clearCaches && now - lastTrimAt < 30_000) return;
  const request = invoke<void>("trim_memory", { clearCaches });
  inFlight = request;
  try {
    await request;
    lastTrimAt = Date.now();
    if (clearCaches) lastClearAt = lastTrimAt;
  } finally {
    if (inFlight === request) inFlight = null;
  }
}
