import type { Monitor } from "@tauri-apps/api/window";

export function columnSettingsPlacement(monitor: Monitor) {
  const scale = monitor.scaleFactor;
  const area = monitor.workArea;
  const areaWidth = area.size.width / scale;
  const areaHeight = area.size.height / scale;
  const width = Math.round(Math.min(920, Math.max(1, areaWidth - 32)));
  const height = Math.round(Math.min(720, Math.max(1, areaHeight - 32)));
  return {
    x: Math.round(area.position.x / scale + (areaWidth - width) / 2),
    y: Math.round(area.position.y / scale + (areaHeight - height) / 2),
    width,
    height,
    minWidth: Math.min(680, width),
    minHeight: Math.min(500, height),
  };
}
