function exifNumber(data: Record<string, string>, key: string): number {
  const raw = (data[key] ?? data[key.toLowerCase()])?.trim();
  if (!raw || raw === "-") return NaN;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

function probability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1000;
}

/** Weights of the recorded EXIF blend, independent of target values and UI rounding. */
export function lceTargetWeights(lvProb: number, lumaFlatProb: number) {
  if (!probability(lvProb) || !probability(lumaFlatProb)) return null;
  const lv = lvProb / 1000;
  const flat = (1 - lv) * lumaFlatProb / 1000;
  const luma = (1 - lv) * (1 - lumaFlatProb / 1000);
  return { lv, luma, flat };
}

/** Rebuild the whole chain from raw inputs; recorded intermediate values are comparisons only. */
export function calculateLceTarget(data: Record<string, string>, parameterLvTarget: number) {
  const lvTarget = exifNumber(data, "SW_LCE_LVTarget");
  const lvProb = exifNumber(data, "SW_LCE_LVProb");
  const lumaTarget = exifNumber(data, "SW_LCE_LumaTarget");
  const lumaProb = exifNumber(data, "SW_LCE_LumaProb");
  const flatTarget = exifNumber(data, "SW_LCE_FlatTarget");
  const flatProb = exifNumber(data, "SW_LCE_FlatProb");
  const recordedLumaFlatProb = exifNumber(data, "SW_LCE_LumaFlatProb");
  const recordedLumaFlatTarget = exifNumber(data, "SW_LCE_LumaFlatTarget");
  const recordedFinalTarget = exifNumber(data, "SW_LCE_FinalTarget");
  // Keep the existing integer probability convention; display rounding never feeds back here.
  const lumaFlatProb = probability(lumaProb) && probability(flatProb)
    ? Math.round(lumaProb * flatProb / 1000) : NaN;
  const lumaFlatTarget = (flatTarget * lumaFlatProb + lumaTarget * (1000 - lumaFlatProb)) / 1000;
  const blend = (target: number) => probability(lvProb)
    ? Math.round((target * lvProb + lumaFlatTarget * (1000 - lvProb)) / 1000) : NaN;
  return {
    lvTarget, lvProb, lumaTarget, lumaProb, flatTarget, flatProb,
    lumaFlatProb, lumaFlatTarget, finalTarget: blend(lvTarget), parameterFinalTarget: blend(parameterLvTarget),
    recordedLumaFlatProb, recordedLumaFlatTarget, recordedFinalTarget,
    weights: lceTargetWeights(lvProb, recordedLumaFlatProb),
  };
}

export type LceTargetCalculation = ReturnType<typeof calculateLceTarget>;
