export type ImageTableKind = "scene" | "portrait" | "na";

export interface ImageTableFaceValues {
  aeGain: string;
  normalCwr: string;
  backCwr: string;
  cwr: string;
  normalDelta: number | null;
  backDelta: number | null;
  linkDelta: number | null;
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim() && value.trim() !== "-");
}

export function classifyImageTableRow(
  data: Record<string, string>,
  face: ImageTableFaceValues,
  fdyKey: string,
  extraKeys: readonly string[],
): ImageTableKind {
  if (hasValue(face.aeGain) && hasValue(data[fdyKey])) return "portrait";

  const hasFollowingValue = [face.normalCwr, face.backCwr, face.cwr].some(hasValue)
    || [face.normalDelta, face.backDelta, face.linkDelta].some((value) => value !== null)
    || extraKeys.some((key) => hasValue(data[key]));
  return hasFollowingValue ? "scene" : "na";
}

export function shouldShowImageTableRow(
  kind: ImageTableKind,
  showScene: boolean,
  showPortrait: boolean,
): boolean {
  if (showScene && showPortrait) return true;
  if (!showScene && !showPortrait) return kind === "na";
  return kind === (showScene ? "scene" : "portrait");
}
