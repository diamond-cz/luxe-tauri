import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import {
  getNormalTableSchema,
  type NormalTableBlock,
  type NormalTableSchema,
} from "@/ipc/normalTable";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import {
  calculationCellBackground,
  calculationCellForeground,
  formatSubstitutedValue,
  tableCellTooltip,
} from "./tableCellPresentation";

interface Props {
  tomlData: Record<string, string>;
}

type SymbolTable = Record<string, string>;
type CellTone =
  | "peach"
  | "orange"
  | "yellow"
  | "cream"
  | "grey"
  | "green"
  | "paleGreen"
  | "softGreen"
  | "formula"
  | "blank";

interface CellData {
  text: string;
  raw: string;
  substituted?: string;
}

interface SheetModel {
  blocks: NormalTableBlock[];
  lookup: Record<string, string>;
  display: Map<string, string>;
  substitutions: Map<string, string>;
  blockByTitle: Map<string, number>;
  kvBlockIdx: number;
}

const DETAIL_SECTION_ROWS = 4;
const DETAIL_LABEL_COLUMN_WIDTH = "clamp(40px, 12cqw, 96px)";
const SHEET_ROW_HEIGHT = 23;

export function NormalTable({ tomlData }: Props) {
  const [schema, setSchema] = useState<NormalTableSchema | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNormalTableSchema()
      .then((next) => {
        if (!cancelled) setSchema(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, []);

  const blocks = schema?.block ?? [];
  const lookup = useMemo(() => withLookupAliases(tomlData), [tomlData]);
  const model = useMemo(() => buildSheetModel(blocks, lookup), [blocks, lookup]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs"
           style={{ color: "var(--colorPaletteRedForeground1)" }}>
        normal_table.toml load failed: {error}
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--colorNeutralForeground3)" }}>
        Loading normal table...
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--colorNeutralForeground3)" }}>
        normal_table.toml has no blocks
      </div>
    );
  }

  return renderFixedSheet(model);
}

function renderFixedSheet(model: SheetModel) {
  const cwr = kvCell(model, "CWR(目标亮度)");
  const finalTarget = kvCell(model, "Final_Target");
  const targetAblMtHs = kvCell(model, "Target_ABL_MT_HS");
  const prob = gridCell(model, "NS_Prob", "Prob", "Value");
  const nsNorTCal = gridCell(model, "NS+ABL", "NorT", "Cal");
  const minCwr = lookupValue(model.lookup, "AE_TAG_MIN_CWV_RECMD") ?? "-";
  const maxCwr = lookupValue(model.lookup, "AE_TAG_MAX_CWV_RECMD") ?? "-";
  const range = `[${minCwr}, ${maxCwr}]`;

  return (
    <div
      className="normal-sheet-viewport h-full w-full min-w-0 overflow-x-hidden overflow-y-auto"
      style={{
        backgroundColor: "var(--normal-sheet-bg, #ffffff)",
        containerType: "inline-size",
      }}
    >
      <div style={sheetCanvasStyle}>
        <SheetTable>
          <tr>
            <SheetCell tone="peach" strong width="24%">
              CWR(目标亮度)
            </SheetCell>
            <SheetCell tone="cream" strong width="16%" title={tableCellTooltip(cwr.raw, cwr.text)}>
              {cwr.text}
            </SheetCell>
            <SheetCell tone="orange">
              MainT+HS
            </SheetCell>
            <SheetCell tone="yellow">MainT</SheetCell>
            <SheetCell tone="yellow">HS</SheetCell>
            <SheetCell tone="yellow">ABL</SheetCell>
            <SheetCell tone="yellow">NS</SheetCell>
          </tr>
          <tr>
            <SheetCell tone="green" strong>
              Cal_final_target
            </SheetCell>
            <SheetCell tone="formula" title={tableCellTooltip(finalTarget.raw, finalTarget.text, finalTarget.substituted)}>
              {finalTarget.text}
            </SheetCell>
            <SheetCell tone="yellow">Wt</SheetCell>
            {topValueCells(model, "Wt")}
          </tr>
          <tr>
            <SheetCell tone="green" strong>
              Cal_mt+hs+abl_target
            </SheetCell>
            <SheetCell tone="formula" title={tableCellTooltip(targetAblMtHs.raw, targetAblMtHs.text, targetAblMtHs.substituted)}>
              {targetAblMtHs.text}
            </SheetCell>
            <SheetCell tone="yellow">Tar</SheetCell>
            {topValueCells(model, "Tar")}
          </tr>
          <tr>
            <SheetCell tone="peach" strong>极值限制</SheetCell>
            <SheetCell tone="cream" strong title={`AE_TAG_MIN_CWV_RECMD = ${minCwr}\nAE_TAG_MAX_CWV_RECMD = ${maxCwr}`}>
              {range}
            </SheetCell>
            <SheetCell tone="green">Cal</SheetCell>
            {topValueCells(model, "Cal", true)}
          </tr>
        </SheetTable>

        <div style={sheetDividerStyle()} />

        <div style={sheetSideStackStyle}>
          <SheetTable>
            <tr>
              <SheetCell
                tone="orange"
                rowSpan={DETAIL_SECTION_ROWS}
                width={DETAIL_LABEL_COLUMN_WIDTH}
              >
                MainT
              </SheetCell>
              <SheetCell tone="cream">THD</SheetCell>
              <SheetCell tone="cream">MTWV</SheetCell>
              <SheetCell tone="cream">CWV</SheetCell>
              <SheetCell tone="cream">DR_Midratio</SheetCell>
              <SheetCell tone="orange">HS</SheetCell>
              <SheetCell tone="cream">THD</SheetCell>
              <SheetCell tone="cream">_Final_Y</SheetCell>
              <SheetCell tone="cream">Tar</SheetCell>
              <SheetCell tone="green">Cal</SheetCell>
            </tr>
            <tr>
              {dataCell(model, "MainT", "THD", "Value")}
              {dataCell(model, "MainT", "MTWV", "Value")}
              {dataCell(model, "MainT", "CWV", "Value")}
              {dataCell(model, "MainT", "DR_Midratio", "Value")}
              <SheetCell tone="yellow">BT</SheetCell>
              {hsDetailCells(model, "BT")}
            </tr>
            <tr>
              <SheetCell tone="green">THD_Cal</SheetCell>
              <SheetCell tone="cream">BASE</SheetCell>
              <SheetCell tone="cream">EXP</SheetCell>
              <SheetCell tone="green">THD_MAX</SheetCell>
              <SheetCell tone="yellow">MT</SheetCell>
              {hsDetailCells(model, "MT")}
            </tr>
            <tr>
              {dataCell(model, "MainT", "THD", "Cal", "softGreen")}
              {dataCell(model, "MainT", "BASE", "Value")}
              {dataCell(model, "MainT", "EXP", "Value")}
              {dataCell(model, "MainT", "BASE", "Cal", "softGreen")}
              <SheetCell tone="yellow">DT</SheetCell>
              {hsDetailCells(model, "DT")}
            </tr>
          </SheetTable>

          <SheetTable>
            <tr>
              <SheetCell tone="orange" width={DETAIL_LABEL_COLUMN_WIDTH} rowSpan={DETAIL_SECTION_ROWS}>NS</SheetCell>
              <SheetCell tone="yellow" colSpan={2}>Prob</SheetCell>
              <SheetCell tone="cream" colSpan={2}>THD</SheetCell>
              <SheetCell tone="cream">_Final_Y</SheetCell>
              <SheetCell tone="cream">NorT</SheetCell>
              <SheetCell tone="cream">BT</SheetCell>
              <SheetCell tone="cream">DT</SheetCell>
              <SheetCell tone="cream">DT_Limit</SheetCell>
            </tr>
            <tr>
              <SheetCell tone="yellow">BV Prob</SheetCell>
              <SheetCell tone="yellow">CDF Prob</SheetCell>
              <SheetCell tone="yellow">NorT</SheetCell>
              {dataCell(model, "NS", "NorT_THD", "Value")}
              {dataCell(model, "NS", "NorT_Y", "Value")}
              <SheetCell tone="formula" rowSpan={3} title={tableCellTooltip(nsNorTCal.raw, nsNorTCal.text, nsNorTCal.substituted)}>
                {nsNorTCal.text}
              </SheetCell>
              {dataCell(model, "NS+ABL", "BT", "Tar")}
              {dataCell(model, "NS+ABL", "DT", "Tar")}
              <SheetCell
                tone="grey"
                rowSpan={3}
                title={tableCellTooltip(
                  gridCell(model, "NS+ABL", "DT_Limit", "Tar").raw,
                  gridCell(model, "NS+ABL", "DT_Limit", "Tar").text,
                )}
              >
                {gridCell(model, "NS+ABL", "DT_Limit", "Tar").text}
              </SheetCell>
            </tr>
            <tr>
              {dataCell(model, "NS_Prob", "BV Prob", "Value")}
              {dataCell(model, "NS_Prob", "CDF Prob", "Value")}
              <SheetCell tone="yellow">BT</SheetCell>
              {dataCell(model, "NS", "BT_THD", "Value")}
              {dataCell(model, "NS", "BT_Y", "Value")}
              {dataCell(model, "NS+ABL", "BT", "Cal", "softGreen", false, 2)}
              {dataCell(model, "NS+ABL", "DT", "Cal", "softGreen", false, 2)}
            </tr>
            <tr>
              <SheetCell tone="formula" colSpan={2} title={tableCellTooltip(prob.raw, prob.text, prob.substituted)}>
                {prob.text}
              </SheetCell>
              <SheetCell tone="yellow">DT</SheetCell>
              {dataCell(model, "NS", "DT_THD", "Value")}
              {dataCell(model, "NS", "DT_Y", "Value")}
            </tr>
          </SheetTable>
        </div>
      </div>
    </div>
  );
}

function SheetTable({ children }: { children: ReactNode }) {
  return (
    <table
      style={{
        borderCollapse: "collapse",
        color: "var(--normal-sheet-text, #202020)",
        fontFamily: '"Microsoft YaHei", "Segoe UI", Arial, sans-serif',
        fontSize: "clamp(8px, 2.2cqw, 12px)",
        tableLayout: "fixed",
        width: "100%",
        minWidth: 0,
      }}
    >
      <tbody>{children}</tbody>
    </table>
  );
}

const sheetCanvasStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  minWidth: 0,
};

const sheetSideStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 6,
  width: "100%",
  minWidth: 0,
};

function sheetDividerStyle(): CSSProperties {
  return {
    height: 6,
    width: "100%",
    boxSizing: "border-box",
    borderTop: "1px solid var(--normal-sheet-divider, rgba(255, 255, 255, 0.18))",
    borderBottom: "1px solid var(--normal-sheet-divider-shadow, rgba(0, 0, 0, 0.34))",
    background:
      "linear-gradient(90deg, transparent 0%, var(--normal-sheet-divider-fill, rgba(255, 255, 255, 0.06)) 18%, var(--normal-sheet-divider-fill, rgba(255, 255, 255, 0.06)) 82%, transparent 100%)",
  };
}

function topValueCells(
  model: SheetModel,
  row: "Wt" | "Tar" | "Cal",
  strong = false,
) {
  const tone = row === "Cal" ? "paleGreen" : "grey";
  const mappedRow = row === "Wt" ? "Prob" : row;
  return (
    <>
      {dataCell(model, "MainT+HS", "MainT", row, tone, strong)}
      {dataCell(model, "MainT+HS", "HS", row, tone, strong)}
      {dataCell(model, "NS+ABL", "ABL", mappedRow, tone, strong)}
      {dataCell(model, "NS+ABL", "NS", mappedRow, tone, strong)}
    </>
  );
}

function hsDetailCells(model: SheetModel, name: "BT" | "MT" | "DT") {
  const thdCol = `${name}_THD`;
  const yCol = `${name}_Y`;
  return (
    <>
      {dataCell(model, "HS", thdCol, "Value")}
      {dataCell(model, "HS", yCol, "Value")}
      {dataCell(model, "MainT+HS", name, "Tar")}
      {dataCell(model, "MainT+HS", name, "Cal", "softGreen")}
    </>
  );
}

function dataCell(
  model: SheetModel,
  title: string,
  col: string,
  row: string,
  tone: CellTone = "grey",
  strong = false,
  rowSpan?: number,
) {
  const cell = gridCell(model, title, col, row);
  return (
    <SheetCell tone={cell.raw.trim().startsWith("=") ? "formula" : tone} strong={strong} rowSpan={rowSpan} title={tableCellTooltip(cell.raw, cell.text, cell.substituted)}>
      {cell.text}
    </SheetCell>
  );
}

function kvCell(model: SheetModel, label: string): CellData {
  const name = nameOfKvLabel(label);
  const block = model.blocks[model.kvBlockIdx];
  let raw = "";
  if (block?.type === "kv") {
    raw = String(block.items?.find((item) => nameOfKvLabel(String(item.label ?? "")) === name)?.value ?? "");
  }
  return {
    raw,
    text: model.display.get(displayKey(model.kvBlockIdx, name)) ?? "-",
    substituted: model.substitutions.get(displayKey(model.kvBlockIdx, name)),
  };
}

function gridCell(model: SheetModel, title: string, col: string, row: string): CellData {
  const bi = model.blockByTitle.get(title) ?? -1;
  const name = nameOfGridCell(col, row);
  const block = model.blocks[bi];
  let raw = "";
  if (block?.type === "grid") {
    const rowSpec = block.rows?.find((item) => String(item.label ?? "") === row);
    const colIdx = block.columns?.findIndex((item) => item === col) ?? -1;
    if (rowSpec && colIdx >= 0) raw = String(rowSpec.cells?.[colIdx] ?? "");
  }
  return {
    raw,
    text: model.display.get(displayKey(bi, name)) ?? "-",
    substituted: model.substitutions.get(displayKey(bi, name)),
  };
}

function buildSheetModel(blocks: NormalTableBlock[], lookup: Record<string, string>): SheetModel {
  const blockByTitle = new Map<string, number>();
  let kvBlockIdx = 0;
  blocks.forEach((block, idx) => {
    if (block.type === "grid") blockByTitle.set(String(block.title ?? ""), idx);
    if (block.type === "kv" && kvBlockIdx === 0) kvBlockIdx = idx;
  });
  const evaluated = evaluateNormalTable(blocks, lookup);
  return {
    blocks,
    lookup,
    display: evaluated.display,
    substitutions: evaluated.substitutions,
    blockByTitle,
    kvBlockIdx,
  };
}

function SheetCell({
  children,
  tone,
  strong,
  colSpan,
  rowSpan,
  title,
  width,
}: {
  children?: ReactNode;
  tone: CellTone;
  strong?: boolean;
  colSpan?: number;
  rowSpan?: number;
  title?: string;
  width?: CSSProperties["width"];
}) {
  const body = title ? (
    <HoverTooltip content={title} positioning="below-start" wrap maxWidth={520} inline>
      <span style={sheetCellContentStyle()}>{children}</span>
    </HoverTooltip>
  ) : children;

  return (
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={{
        ...sheetCellStyle(tone, strong),
        ...(width === undefined ? {} : { width, minWidth: width, boxSizing: "border-box" as const }),
      }}
    >
      {body}
    </td>
  );
}

function sheetCellContentStyle(): CSSProperties {
  return {
    display: "inline-block",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  };
}

function sheetCellStyle(tone: CellTone, strong = false): CSSProperties {
  const palette: Record<CellTone, { bg: string; fg: string; border?: string; style?: "solid" | "dotted" }> = {
    peach:     { bg: "var(--normal-sheet-peach-bg, #f7cda0)", fg: "var(--normal-sheet-peach-fg, #111111)" },
    orange:    { bg: "var(--normal-sheet-orange-bg, #ff8a00)", fg: "var(--normal-sheet-orange-fg, #111111)" },
    yellow:    { bg: "var(--normal-sheet-yellow-bg, #ffd95a)", fg: "var(--normal-sheet-yellow-fg, #222222)" },
    cream:     { bg: "var(--normal-sheet-cream-bg, #fbf2d3)", fg: "var(--normal-sheet-cream-fg, #242424)" },
    grey:      { bg: "var(--normal-sheet-grey-bg, #d8dde2)", fg: "var(--normal-sheet-grey-fg, #222222)", style: "dotted" },
    green:     { bg: "var(--normal-sheet-green-bg, #bee32b)", fg: "var(--normal-sheet-green-fg, #202020)" },
    paleGreen: { bg: "var(--normal-sheet-palegreen-bg, #eef5cd)", fg: "var(--normal-sheet-palegreen-fg, #202020)", style: "dotted" },
    softGreen: { bg: "var(--normal-sheet-softgreen-bg, #ddf2d8)", fg: "var(--normal-sheet-softgreen-fg, #202020)", style: "dotted" },
    formula:   { bg: calculationCellBackground, fg: calculationCellForeground, style: "dotted" },
    blank:     { bg: "transparent", fg: "var(--normal-sheet-text, #202020)", border: "transparent" },
  };
  const color = palette[tone];
  return {
    height: SHEET_ROW_HEIGHT,
    minWidth: 0,
    padding: tone === "blank" ? 0 : "2px clamp(2px, 0.5cqw, 8px)",
    border: `1px ${color.style ?? "solid"} ${color.border ?? "var(--normal-sheet-line, #303030)"}`,
    background: color.bg,
    color: color.fg,
    fontWeight: strong ? 700 : 400,
    textAlign: "center",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    lineHeight: 1.2,
  };
}

function evaluateNormalTable(
  blocks: NormalTableBlock[],
  lookup: Record<string, string>,
): { display: Map<string, string>; substitutions: Map<string, string> } {
  const perBlock: SymbolTable[] = [];
  const globalSyms: SymbolTable = {};

  for (const block of blocks) {
    const bsyms: SymbolTable = {};
    if (block.type === "kv") {
      for (const item of block.items ?? []) {
        const name = nameOfKvLabel(String(item.label ?? ""));
        if (!name) continue;
        const value = String(item.value ?? "");
        bsyms[name] = value;
        globalSyms[name] = value;
      }
    } else if (block.type === "grid") {
      const columns = block.columns ?? [];
      for (const row of block.rows ?? []) {
        const rowLabel = String(row.label ?? "");
        columns.forEach((col, i) => {
          const name = nameOfGridCell(col, rowLabel);
          if (name) bsyms[name] = String(row.cells?.[i] ?? "");
        });
      }
    }
    perBlock.push(bsyms);
  }

  for (const syms of perBlock) {
    if (syms.NS_Prob !== undefined && syms.NS_Wt === undefined) {
      syms.NS_Wt = syms.NS_Prob;
    }
  }

  const cache = new Map<string, number | null>();
  const visiting = new Set<string>();

  const resolve = (bi: number, name: string): number | null => {
    const key = displayKey(bi, name);
    if (cache.has(key)) return cache.get(key) ?? null;
    if (visiting.has(key)) {
      cache.set(key, null);
      return null;
    }

    visiting.add(key);
    try {
      let raw = perBlock[bi]?.[name] ?? globalSyms[name];
      if (raw === undefined) {
        for (let obi = 0; obi < perBlock.length; obi += 1) {
          if (obi === bi) continue;
          if (perBlock[obi][name] !== undefined) {
            const v = resolve(obi, name);
            cache.set(key, v);
            return v;
          }
        }
      }
      if (raw === undefined) {
        const v = tagNumber(lookup, name);
        cache.set(key, v);
        return v;
      }

      const s = String(raw).trim();
      let value: number | null;
      if (!s || s === "-") value = null;
      else if (s.startsWith("=")) value = evalExpression(s.slice(1).trim(), (ident) => resolve(bi, ident));
      else if (isDataKey(s)) value = tagNumber(lookup, s);
      else value = toNumber(s);

      cache.set(key, value);
      return value;
    } finally {
      visiting.delete(key);
    }
  };

  perBlock.forEach((syms, bi) => {
    for (const name of Object.keys(syms)) resolve(bi, name);
  });

  const display = new Map<string, string>();
  const substitutions = new Map<string, string>();
  perBlock.forEach((syms, bi) => {
    for (const [name, raw] of Object.entries(syms)) {
      const s = String(raw).trim();
      if (s.startsWith("=")) {
        const substituted = substituteExpression(s.slice(1).trim(), (ident) => resolve(bi, ident));
        if (substituted !== null) substitutions.set(displayKey(bi, name), substituted);
      }
      const value = cache.get(displayKey(bi, name));
      if (value !== undefined && value !== null) {
        display.set(displayKey(bi, name), formatNumber(value, s.startsWith("=")));
        continue;
      }

      if (!s || s === "-" || s.startsWith("=")) {
        display.set(displayKey(bi, name), "-");
      } else if (isDataKey(s)) {
        const v = lookupValue(lookup, s);
        display.set(displayKey(bi, name), v === undefined || v === "" ? "-" : String(v));
      } else {
        display.set(displayKey(bi, name), s);
      }
    }
  });

  return { display, substitutions };
}

function substituteExpression(expr: string, resolveIdent: (name: string) => number | null): string | null {
  try {
    const tokens = tokenize(expr);
    let substituted = "";
    let cursor = 0;
    tokens.forEach((token, index) => {
      if (token.type !== "ident" || tokens[index + 1]?.value === "(") return;
      const value = resolveIdent(token.value);
      if (value === null) return;
      substituted += expr.slice(cursor, token.start);
      substituted += formatSubstitutedValue(value);
      cursor = token.end;
    });
    return substituted + expr.slice(cursor);
  } catch {
    return null;
  }
}

function evalExpression(expr: string, resolveIdent: (name: string) => number | null): number | null {
  try {
    const parser = new ExpressionParser(expr, resolveIdent);
    const value = parser.parse();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

class ExpressionParser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(
    expr: string,
    private readonly resolveIdent: (name: string) => number | null,
  ) {
    this.tokens = tokenize(expr);
  }

  parse(): number {
    const value = this.parseAddSub();
    if (this.peek().type !== "eof") throw new Error("trailing token");
    return value;
  }

  private parseAddSub(): number {
    let left = this.parseMulDiv();
    while (this.match("+") || this.match("-")) {
      const op = this.previous().value;
      const right = this.parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private parseMulDiv(): number {
    let left = this.parsePower();
    while (this.match("*") || this.match("/") || this.match("//") || this.match("%")) {
      const op = this.previous().value;
      const right = this.parsePower();
      if (op === "*") left *= right;
      else if (op === "/") left /= right;
      else if (op === "//") left = Math.floor(left / right);
      else left %= right;
    }
    return left;
  }

  private parsePower(): number {
    let left = this.parseUnary();
    if (this.match("**")) {
      const right = this.parsePower();
      left = left ** right;
    }
    return left;
  }

  private parseUnary(): number {
    if (this.match("+")) return this.parseUnary();
    if (this.match("-")) return -this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.advance();
    if (token.type === "number") return Number(token.value);
    if (token.value === "(") {
      const value = this.parseAddSub();
      this.consume(")");
      return value;
    }
    if (token.type === "ident") {
      if (this.match("(")) return this.callFunction(token.value);
      const value = this.resolveIdent(token.value);
      if (value === null) throw new Error(`unknown identifier: ${token.value}`);
      return value;
    }
    throw new Error(`unexpected token: ${token.value}`);
  }

  private callFunction(name: string): number {
    const args: number[] = [];
    if (!this.check(")")) {
      do {
        args.push(this.parseAddSub());
      } while (this.match(","));
    }
    this.consume(")");

    const upper = name.toUpperCase();
    if (upper === "MAX") return Math.max(...args);
    if (upper === "MIN") return Math.min(...args);
    if (upper === "CLAMP") {
      if (args.length !== 3) throw new Error("CLAMP expects 3 args");
      const lo = Math.min(args[1], args[2]);
      const hi = Math.max(args[1], args[2]);
      return Math.max(lo, Math.min(args[0], hi));
    }
    if (upper === "PIECEWISE") {
      if (args.length !== 6) throw new Error("PIECEWISE expects 6 args");
      return args[0] < args[1] ? args[2] : args[0] < args[3] ? args[4] : args[5];
    }
    throw new Error(`unknown function: ${name}`);
  }

  private match(value: string): boolean {
    if (!this.check(value)) return false;
    this.pos += 1;
    return true;
  }

  private consume(value: string): void {
    if (!this.match(value)) throw new Error(`expected ${value}`);
  }

  private check(value: string): boolean {
    return this.peek().value === value;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.type !== "eof") this.pos += 1;
    return token;
  }

  private previous(): Token {
    return this.tokens[this.pos - 1];
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "eof", value: "", start: 0, end: 0 };
  }
}

type Token = { type: "number" | "ident" | "op" | "eof"; value: string; start: number; end: number };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const rest = expr.slice(i);
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      tokens.push({ type: "number", value: number[0], start: i, end: i + number[0].length });
      i += number[0].length;
      continue;
    }
    const ident = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (ident) {
      tokens.push({ type: "ident", value: ident[0], start: i, end: i + ident[0].length });
      i += ident[0].length;
      continue;
    }
    const op = rest.startsWith("**") || rest.startsWith("//") ? rest.slice(0, 2) : ch;
    if ("+-*/%(),".includes(op) || op === "**" || op === "//") {
      tokens.push({ type: "op", value: op, start: i, end: i + op.length });
      i += op.length;
      continue;
    }
    throw new Error(`invalid token at ${i}`);
  }
  tokens.push({ type: "eof", value: "", start: i, end: i });
  return tokens;
}

function withLookupAliases(data: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value;
    if (out[key.toLowerCase()] === undefined) out[key.toLowerCase()] = value;
    const parts = key.split(".");
    const leaf = parts[parts.length - 1];
    if (leaf && leaf !== key) {
      if (out[leaf] === undefined) out[leaf] = value;
      if (out[leaf.toLowerCase()] === undefined) out[leaf.toLowerCase()] = value;
    }
  }
  return out;
}

function lookupValue(lookup: Record<string, string>, key: string): string | undefined {
  return lookup[key] ?? lookup[key.toLowerCase()];
}

function tagNumber(lookup: Record<string, string>, key: string): number | null {
  return toNumber(lookupValue(lookup, key));
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === "-") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value: number, isFormula: boolean): string {
  if (isFormula) return value.toFixed(2);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function nameOfKvLabel(label: string): string {
  return label.replace(/\([^)]*\)/g, "").replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
}

function nameOfGridCell(colName: string, rowLabel: string): string {
  return `${colName}_${rowLabel}`.replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
}

function displayKey(blockIdx: number, name: string): string {
  return `${blockIdx}\u0000${name}`;
}

function isDataKey(value: string): boolean {
  return value.startsWith("AE_TAG_") || value.startsWith("SW_");
}
