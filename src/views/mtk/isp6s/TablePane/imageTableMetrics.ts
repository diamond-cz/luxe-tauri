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

export function isCwrEvFormula(source: string): boolean {
  return /^=?\s*log2\s*\(\s*CWR_new\s*\/\s*CWR_old\s*\)$/i.test(source.trim());
}

export function isCwrDeltaFormula(source: string): boolean {
  return /^=?\s*CWR_new\s*-\s*CWR_old$/i.test(source.trim());
}

export function formatCwrEvTriplet(normal: number | null, back: number | null, face: number | null): string {
  return [normal, back, face].map(formatDeltaEv).join("|");
}

export function parseMetricResult(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function parseMetricPair(text: string): { first: string; second: string; difference: number } | null {
  const pair = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\)\s*$/.exec(text);
  if (!pair) return null;
  const oldValue = Number(pair[1]);
  const newValue = Number(pair[2]);
  if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) return null;
  return { first: pair[1], second: pair[2], difference: Number((newValue - oldValue).toFixed(6)) };
}

export function metricDirection(value: number | null, threshold: number): "positive" | "negative" | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value > threshold) return "positive";
  if (value < -threshold) return "negative";
  return null;
}
