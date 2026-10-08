export const calculationCellBackground = "var(--normal-sheet-softgreen-bg, #ddf2d8)";
export const calculationCellForeground = "var(--normal-sheet-softgreen-fg, #202020)";

export function formatSubstitutedValue(value: number): string {
  const formatted = value.toFixed(2);
  return value < 0 ? `(${formatted})` : formatted;
}

export function calculationTooltip(expression: string, result: string, substituted?: string): string {
  return `公式\n${expression}${substituted ? `\n\n代入数值\n${substituted}` : ""}\n\n结果\n${result}`;
}

export function tableCellTooltip(raw: string, result: string, substituted?: string): string {
  const source = raw.trim();
  if (!source || source === "-") return "";
  if (source.startsWith("=")) return calculationTooltip(source.slice(1).trim(), result, substituted);
  if (source.startsWith("AE_TAG_") || source.startsWith("SW_")) return `数据源\n${source}`;
  return `固定值\n${source}`;
}
