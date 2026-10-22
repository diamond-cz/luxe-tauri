export function deltaEv(oldValue: number | null, newValue: number | null): number | null {
  return oldValue !== null && newValue !== null && oldValue > 0 && newValue > 0
    ? Math.log2(newValue / oldValue) : null;
}

export function selectImageTableEv(
  sceneOnly: boolean, rowKind: "scene" | "portrait" | "na" | undefined,
  normalEv: number | null, faceEv: number | null,
): number | null {
  return sceneOnly || rowKind === "scene" ? normalEv : faceEv;
}

export function formatDeltaEv(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

export function parseMetricResult(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function metricDirection(value: number | null, threshold: number): "positive" | "negative" | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value > threshold) return "positive";
  if (value < -threshold) return "negative";
  return null;
}
