/** Recorded node order; suffixes identify percentiles, not the chart's x coordinates. */
export const LCE_CURVE_PIVOTS = ["0", "1", "50", "250", "500", "750", "950", "999"] as const;
export const LCE_CURVE_MAX = 3700;

function valueAt(data: Record<string, string>, key: string): number {
  const raw = (data[key] ?? data[key.toLowerCase()])?.trim();
  if (!raw || raw === "-") return NaN;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

export function lceLinearBoundToLog(value: number): number {
  if (!Number.isFinite(value) || value < 0) return NaN;
  return value === 0 ? 0 : Math.floor(Math.log10(value) * 1024 + 0.5);
}

/** Mirror ToneTool's recorded curve: LCE_P + GCE_O (packed software debug tags modulo 10000).
 * Without GCE output, explicitly fall back to the existing SW_LCE_O series.
 * Do not synthesize a simulator result or mix missing nodes between output families.
 */
export function buildLceCurve(data: Record<string, string>) {
  const finalValues = LCE_CURVE_PIVOTS.map((suffix) => valueAt(data, `SW_LCE_GCEO${suffix}`));
  const useFinal = finalValues.some(Number.isFinite);
  const outputPrefix = useFinal ? "SW_LCE_GCEO" : "SW_LCE_O";
  const nodes = LCE_CURVE_PIVOTS.map((suffix, index) => {
    const p = valueAt(data, `SW_LCE_P${suffix}`);
    const rawOutput = useFinal ? finalValues[index] : valueAt(data, `${outputPrefix}${suffix}`);
    const o = Number.isFinite(rawOutput) && rawOutput >= 0 ? (useFinal ? rawOutput % 10000 : rawOutput) : NaN;
    return { index, suffix, p, o, gain: o - p, valid: p >= 0 && p <= LCE_CURVE_MAX && o >= 0 && o <= LCE_CURVE_MAX,
      pKey: `SW_LCE_P${suffix}`, oKey: `${outputPrefix}${suffix}` };
  });
  // Missing/out-of-order nodes break the polyline rather than connecting unrelated neighbors.
  const segments: typeof nodes[] = [];
  let current: typeof nodes = [];
  for (const node of nodes) {
    if (!node.valid || (current.length > 0 && node.p <= current[current.length - 1].p)) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    if (node.valid) current.push(node);
  }
  if (current.length > 0) segments.push(current);
  const bounds = ["SW_LCE_FaceLoBound", "SW_LCE_FaceHiBound"].map((key) => {
    const linear = valueAt(data, key);
    return { key, linear, log: lceLinearBoundToLog(linear) };
  });
  return { nodes, segments, bounds, outputPrefix, useFinal, available: nodes.some((node) => node.valid) };
}
