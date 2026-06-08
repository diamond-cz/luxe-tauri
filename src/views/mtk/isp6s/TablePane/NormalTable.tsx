import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import {
  getNormalTableSchema,
  type NormalTableBlock,
  type NormalTableSchema,
} from "@/ipc/normalTable";
import { HoverTooltip } from "@/components/common/HoverTooltip";

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
  | "blank";

interface CellData {
  text: string;
  raw: string;
}

interface SheetModel {
  blocks: NormalTableBlock[];
  lookup: Record<string, string>;
  display: Map<string, string>;
  blockByTitle: Map<string, number>;
  kvBlockIdx: number;
}

interface NormalTableUiState {
  topTripletExpanded: boolean;
  mainTExpanded: boolean;
  hsExpanded: boolean;
  nsExpanded: boolean;
  detailBelowLayout: boolean;
}

const DETAIL_SECTION_ROWS = 4;
const SHEET_ROW_HEIGHT = 23;
const SHEET_BORDER_WIDTH = 1;
const NORMAL_TABLE_UI_STATE_KEY = "luxe:isp6s:normal-table-ui:v1";
const DEFAULT_NORMAL_TABLE_UI_STATE: NormalTableUiState = {
  topTripletExpanded: true,
  mainTExpanded: true,
  hsExpanded: true,
  nsExpanded: true,
  detailBelowLayout: false,
};

function loadNormalTableUiState(): NormalTableUiState {
  if (typeof window === "undefined") return DEFAULT_NORMAL_TABLE_UI_STATE;

  try {
    const raw = window.localStorage.getItem(NORMAL_TABLE_UI_STATE_KEY);
    if (!raw) return DEFAULT_NORMAL_TABLE_UI_STATE;
    const parsed = JSON.parse(raw) as Partial<NormalTableUiState>;
    return {
      topTripletExpanded: typeof parsed.topTripletExpanded === "boolean"
        ? parsed.topTripletExpanded
        : DEFAULT_NORMAL_TABLE_UI_STATE.topTripletExpanded,
      mainTExpanded: typeof parsed.mainTExpanded === "boolean"
        ? parsed.mainTExpanded
        : DEFAULT_NORMAL_TABLE_UI_STATE.mainTExpanded,
      hsExpanded: typeof parsed.hsExpanded === "boolean"
        ? parsed.hsExpanded
        : DEFAULT_NORMAL_TABLE_UI_STATE.hsExpanded,
      nsExpanded: typeof parsed.nsExpanded === "boolean"
        ? parsed.nsExpanded
        : DEFAULT_NORMAL_TABLE_UI_STATE.nsExpanded,
      detailBelowLayout: typeof parsed.detailBelowLayout === "boolean"
        ? parsed.detailBelowLayout
        : DEFAULT_NORMAL_TABLE_UI_STATE.detailBelowLayout,
    };
  } catch {
    return DEFAULT_NORMAL_TABLE_UI_STATE;
  }
}

function saveNormalTableUiState(state: NormalTableUiState): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(NORMAL_TABLE_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; UI state should not block table rendering.
  }
}

export function NormalTable({ tomlData }: Props) {
  const [schema, setSchema] = useState<NormalTableSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialUiState] = useState<NormalTableUiState>(() => loadNormalTableUiState());
  const [topTripletExpanded, setTopTripletExpanded] = useState(initialUiState.topTripletExpanded);
  const [mainTExpanded, setMainTExpanded] = useState(initialUiState.mainTExpanded);
  const [hsExpanded, setHsExpanded] = useState(initialUiState.hsExpanded);
  const [nsExpanded, setNsExpanded] = useState(initialUiState.nsExpanded);
  const [detailBelowLayout, setDetailBelowLayout] = useState(initialUiState.detailBelowLayout);

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

  useEffect(() => {
    saveNormalTableUiState({
      topTripletExpanded,
      mainTExpanded,
      hsExpanded,
      nsExpanded,
      detailBelowLayout,
    });
  }, [topTripletExpanded, mainTExpanded, hsExpanded, nsExpanded, detailBelowLayout]);

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

  return renderFixedSheet(
    model,
    topTripletExpanded,
    () => setTopTripletExpanded((expanded) => !expanded),
    mainTExpanded,
    () => setMainTExpanded((expanded) => !expanded),
    hsExpanded,
    () => setHsExpanded((expanded) => !expanded),
    nsExpanded,
    () => setNsExpanded((expanded) => !expanded),
    detailBelowLayout,
    () => setDetailBelowLayout((below) => !below),
  );
}

function renderFixedSheet(
  model: SheetModel,
  topTripletExpanded: boolean,
  onToggleTopTriplet: () => void,
  mainTExpanded: boolean,
  onToggleMainT: () => void,
  hsExpanded: boolean,
  onToggleHs: () => void,
  nsExpanded: boolean,
  onToggleNs: () => void,
  detailBelowLayout: boolean,
  onToggleDetailLayout: () => void,
) {
  const cwr = kvCell(model, "CWR(目标亮度)");
  const finalTarget = kvCell(model, "Final_Target");
  const targetAblMtHs = kvCell(model, "Target_ABL_MT_HS");
  const prob = gridCell(model, "NS_Prob", "Prob", "Value");
  const minCwr = lookupValue(model.lookup, "AE_TAG_MIN_CWV_RECMD") ?? "-";
  const maxCwr = lookupValue(model.lookup, "AE_TAG_MAX_CWV_RECMD") ?? "-";
  const range = `[${minCwr}, ${maxCwr}]`;
  const detailHasBody = mainTExpanded || hsExpanded;

  return (
    <div
      className="h-full w-full overflow-auto"
      style={{
        backgroundColor: "var(--normal-sheet-bg, #ffffff)",
      }}
    >
      <div style={sheetCanvasStyle(detailBelowLayout)}>
        <SheetTable fillWidth={detailBelowLayout}>
          <tr>
            <SheetCell tone="peach" strong title={cellTooltip(cwr.raw, cwr.text, model.lookup)}>
              <LayoutToggleHeader
                belowLayout={detailBelowLayout}
                onToggle={onToggleDetailLayout}
              />
            </SheetCell>
            <SheetCell tone="cream" strong title={cellTooltip(cwr.raw, cwr.text, model.lookup)}>
              {cwr.text}
            </SheetCell>
            <SheetCell tone="orange">
              <div style={headerToggleWrapStyle()}>
                <span>MainT+HS</span>
                <button
                  type="button"
                  title={topTripletExpanded ? "折叠 BT/MT/DT" : "展开 BT/MT/DT"}
                  aria-label={topTripletExpanded ? "折叠 BT/MT/DT" : "展开 BT/MT/DT"}
                  onClick={onToggleTopTriplet}
                  style={toggleButtonStyle()}
                >
                  {topTripletExpanded ? "−" : "+"}
                </button>
              </div>
            </SheetCell>
            <SheetCell tone="yellow">MainT</SheetCell>
            <SheetCell tone="yellow">HS</SheetCell>
            {topTripletExpanded && (
              <>
                <SheetCell tone="cream">BT</SheetCell>
                <SheetCell tone="cream">MT</SheetCell>
                <SheetCell tone="cream">DT</SheetCell>
              </>
            )}
            <SheetCell tone="yellow">ABL</SheetCell>
            <SheetCell tone="yellow">NS</SheetCell>
            <SheetCell tone="yellow" colSpan={2}>Prob</SheetCell>
          </tr>
          <tr>
            <SheetCell tone="orange" strong title={cellTooltip(finalTarget.raw, finalTarget.text, model.lookup)}>
              Normal Final Target_cal
            </SheetCell>
            <SheetCell tone="cream" title={cellTooltip(finalTarget.raw, finalTarget.text, model.lookup)}>
              {finalTarget.text}
            </SheetCell>
            <SheetCell tone="yellow">Wt</SheetCell>
            {topValueCells(model, "Wt", false, topTripletExpanded)}
            <SheetCell tone="yellow">BV Prob</SheetCell>
            <SheetCell tone="yellow">CDF Prob</SheetCell>
          </tr>
          <tr>
            <SheetCell tone="orange" strong title={cellTooltip(targetAblMtHs.raw, targetAblMtHs.text, model.lookup)}>
              Target_ABL_MT_HS_cal
            </SheetCell>
            <SheetCell tone="cream" title={cellTooltip(targetAblMtHs.raw, targetAblMtHs.text, model.lookup)}>
              {targetAblMtHs.text}
            </SheetCell>
            <SheetCell tone="yellow">Tar</SheetCell>
            {topValueCells(model, "Tar", false, topTripletExpanded)}
            {dataCell(model, "NS_Prob", "BV Prob", "Value")}
            {dataCell(model, "NS_Prob", "CDF Prob", "Value")}
          </tr>
          <tr>
            <SheetCell tone="peach" strong>极值限制</SheetCell>
            <SheetCell tone="cream" strong title={`AE_TAG_MIN_CWV_RECMD = ${minCwr}\nAE_TAG_MAX_CWV_RECMD = ${maxCwr}`}>
              {range}
            </SheetCell>
            <SheetCell tone="green">Cal</SheetCell>
            {topValueCells(model, "Cal", true, topTripletExpanded)}
            <SheetCell tone="softGreen" colSpan={2} title={cellTooltip(prob.raw, prob.text, model.lookup)}>
              {prob.text}
            </SheetCell>
          </tr>
        </SheetTable>

        {detailBelowLayout && <div style={sheetDividerStyle()} />}

        <div style={sheetSideStackStyle(detailBelowLayout)}>
          <SheetTable>
            <tr>
              <SheetCell
                tone="orange"
                rowSpan={DETAIL_SECTION_ROWS}
                heightRows={!mainTExpanded ? DETAIL_SECTION_ROWS : undefined}
              >
                <ToggleHeader
                  label="MainT"
                  expanded={mainTExpanded}
                  onToggle={onToggleMainT}
                />
              </SheetCell>
              {mainTExpanded && (
                <>
                  <SheetCell tone="cream">THD</SheetCell>
                  <SheetCell tone="cream">MTWV</SheetCell>
                  <SheetCell tone="cream">CWV</SheetCell>
                  <SheetCell tone="cream">DR_Midratio</SheetCell>
                </>
              )}
              <SheetCell
                tone="orange"
                rowSpan={!hsExpanded ? DETAIL_SECTION_ROWS : undefined}
                heightRows={!hsExpanded ? DETAIL_SECTION_ROWS : undefined}
              >
                <ToggleHeader
                  label="HS"
                  expanded={hsExpanded}
                  onToggle={onToggleHs}
                />
              </SheetCell>
              {hsExpanded && (
                <>
                  <SheetCell tone="cream">THD</SheetCell>
                  <SheetCell tone="cream">_Final_Y</SheetCell>
                </>
              )}
            </tr>
            {detailHasBody && (
              <>
                <tr>
                  {mainTExpanded && (
                    <>
                      {dataCell(model, "MainT", "THD", "Value")}
                      {dataCell(model, "MainT", "MTWV", "Value")}
                      {dataCell(model, "MainT", "CWV", "Value")}
                      {dataCell(model, "MainT", "DR_Midratio", "Value")}
                    </>
                  )}
                  {hsExpanded && (
                    <>
                      <SheetCell tone="yellow">BT</SheetCell>
                      {hsDetailCells(model, "BT")}
                    </>
                  )}
                </tr>
                <tr>
                  {mainTExpanded && (
                    <>
                      <SheetCell tone="green">THD_Cal</SheetCell>
                      <SheetCell tone="cream">BASE</SheetCell>
                      <SheetCell tone="cream">EXP</SheetCell>
                      <SheetCell tone="green">THD_MAX</SheetCell>
                    </>
                  )}
                  {hsExpanded && (
                    <>
                      <SheetCell tone="yellow">MT</SheetCell>
                      {hsDetailCells(model, "MT")}
                    </>
                  )}
                </tr>
                <tr>
                  {mainTExpanded && (
                    <>
                      {dataCell(model, "MainT", "THD", "Cal", "softGreen")}
                      {dataCell(model, "MainT", "BASE", "Value")}
                      {dataCell(model, "MainT", "EXP", "Value")}
                      {dataCell(model, "MainT", "BASE", "Cal", "softGreen")}
                    </>
                  )}
                  {hsExpanded && (
                    <>
                      <SheetCell tone="yellow">DT</SheetCell>
                      {hsDetailCells(model, "DT")}
                    </>
                  )}
                </tr>
              </>
            )}
          </SheetTable>

          <SheetTable>
            <tr>
              <SheetCell
                tone="orange"
                heightRows={!nsExpanded ? DETAIL_SECTION_ROWS : undefined}
              >
                <ToggleHeader
                  label="NS"
                  expanded={nsExpanded}
                  onToggle={onToggleNs}
                />
              </SheetCell>
              {nsExpanded && (
                <>
                  <SheetCell tone="cream">THD</SheetCell>
                  <SheetCell tone="cream">_Final_Y</SheetCell>
                  <SheetCell tone="cream">NorT</SheetCell>
                  <SheetCell tone="cream">BT</SheetCell>
                  <SheetCell tone="cream">DT</SheetCell>
                  <SheetCell tone="cream">DT_Limit</SheetCell>
                </>
              )}
            </tr>
            {nsExpanded && (
              <>
                <tr>
                  <SheetCell tone="yellow">NorT</SheetCell>
                  {dataCell(model, "NS", "NorT_THD", "Value")}
                  {dataCell(model, "NS", "NorT_Y", "Value")}
                  <SheetCell tone="softGreen" rowSpan={3}>
                    {gridCell(model, "NS+ABL", "NorT", "Cal").text}
                  </SheetCell>
                  {dataCell(model, "NS+ABL", "BT", "Tar")}
                  {dataCell(model, "NS+ABL", "DT", "Tar")}
                  <SheetCell
                    tone="grey"
                    rowSpan={3}
                    title={cellTooltip(
                      gridCell(model, "NS+ABL", "DT_Limit", "Tar").raw,
                      gridCell(model, "NS+ABL", "DT_Limit", "Tar").text,
                      model.lookup,
                    )}
                  >
                    {gridCell(model, "NS+ABL", "DT_Limit", "Tar").text}
                  </SheetCell>
                </tr>
                <tr>
                  <SheetCell tone="yellow">BT</SheetCell>
                  {dataCell(model, "NS", "BT_THD", "Value")}
                  {dataCell(model, "NS", "BT_Y", "Value")}
                  {dataCell(model, "NS+ABL", "BT", "Cal", "softGreen", false, 2)}
                  {dataCell(model, "NS+ABL", "DT", "Cal", "softGreen", false, 2)}
                </tr>
                <tr>
                  <SheetCell tone="yellow">DT</SheetCell>
                  {dataCell(model, "NS", "DT_THD", "Value")}
                  {dataCell(model, "NS", "DT_Y", "Value")}
                </tr>
              </>
            )}
          </SheetTable>
        </div>
      </div>
    </div>
  );
}

function SheetTable({ children, fillWidth = false }: { children: ReactNode; fillWidth?: boolean }) {
  return (
    <table
      style={{
        borderCollapse: "collapse",
        color: "var(--normal-sheet-text, #202020)",
        fontFamily: '"Microsoft YaHei", "Segoe UI", Arial, sans-serif',
        fontSize: 12,
        tableLayout: "auto",
        width: fillWidth ? "100%" : "max-content",
      }}
    >
      <tbody>{children}</tbody>
    </table>
  );
}

function sheetCanvasStyle(detailBelowLayout: boolean): CSSProperties {
  if (detailBelowLayout) {
    return {
      display: "inline-grid",
      gridTemplateColumns: "max-content",
      gridAutoRows: "max-content",
      alignItems: "stretch",
      gap: 0,
      minWidth: "max-content",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: 0,
    minWidth: "max-content",
  };
}

function sheetSideStackStyle(detailBelowLayout: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 0,
    marginLeft: detailBelowLayout ? 0 : -1,
    width: detailBelowLayout ? "100%" : "max-content",
    minWidth: "max-content",
  };
}

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
  includeTriplet = true,
) {
  const tone = row === "Cal" ? "paleGreen" : "grey";
  const mappedRow = row === "Wt" ? "Prob" : row;
  return (
    <>
      {dataCell(model, "MainT+HS", "MainT", row, tone, strong)}
      {dataCell(model, "MainT+HS", "HS", row, tone, strong)}
      {includeTriplet && (
        <>
          {dataCell(model, "MainT+HS", "BT", row, tone, strong)}
          {dataCell(model, "MainT+HS", "MT", row, tone, strong)}
          {dataCell(model, "MainT+HS", "DT", row, tone, strong)}
        </>
      )}
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
    <SheetCell tone={tone} strong={strong} rowSpan={rowSpan} title={cellTooltip(cell.raw, cell.text, model.lookup)}>
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
  };
}

function buildSheetModel(blocks: NormalTableBlock[], lookup: Record<string, string>): SheetModel {
  const blockByTitle = new Map<string, number>();
  let kvBlockIdx = 0;
  blocks.forEach((block, idx) => {
    if (block.type === "grid") blockByTitle.set(String(block.title ?? ""), idx);
    if (block.type === "kv" && kvBlockIdx === 0) kvBlockIdx = idx;
  });
  return {
    blocks,
    lookup,
    display: evaluateNormalTable(blocks, lookup),
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
  heightRows,
  title,
}: {
  children?: ReactNode;
  tone: CellTone;
  strong?: boolean;
  colSpan?: number;
  rowSpan?: number;
  heightRows?: number;
  title?: string;
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
      style={sheetCellStyle(tone, strong, heightRows)}
    >
      {body}
    </td>
  );
}

function sheetCellContentStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
  };
}

function LayoutToggleHeader({
  belowLayout,
  onToggle,
}: {
  belowLayout: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={headerToggleWrapStyle()}>
      <span>CWR(目标亮度)</span>
      <button
        type="button"
        title={belowLayout ? "切换为一行显示" : "切换为下方两行显示"}
        aria-label={belowLayout ? "切换为一行显示" : "切换为下方两行显示"}
        onClick={onToggle}
        style={toggleButtonStyle()}
      >
        {belowLayout ? "↔" : "↧"}
      </button>
    </div>
  );
}

function ToggleHeader({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={headerToggleWrapStyle()}>
      <span>{label}</span>
      <button
        type="button"
        title={expanded ? `折叠 ${label}` : `展开 ${label}`}
        aria-label={expanded ? `折叠 ${label}` : `展开 ${label}`}
        onClick={onToggle}
        style={toggleButtonStyle()}
      >
        {expanded ? "−" : "+"}
      </button>
    </div>
  );
}

function headerToggleWrapStyle(): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minWidth: 0,
  };
}

function toggleButtonStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 18,
    padding: 0,
    border: "1px solid currentColor",
    borderRadius: 4,
    background: "var(--normal-sheet-button-bg, rgba(255, 255, 255, 0.28))",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    fontWeight: 700,
    lineHeight: 1,
  };
}

function sheetCellStyle(tone: CellTone, strong = false, heightRows = 1): CSSProperties {
  const palette: Record<CellTone, { bg: string; fg: string; border?: string; style?: "solid" | "dotted" }> = {
    peach:     { bg: "var(--normal-sheet-peach-bg, #f7cda0)", fg: "var(--normal-sheet-peach-fg, #111111)" },
    orange:    { bg: "var(--normal-sheet-orange-bg, #ff8a00)", fg: "var(--normal-sheet-orange-fg, #111111)" },
    yellow:    { bg: "var(--normal-sheet-yellow-bg, #ffd95a)", fg: "var(--normal-sheet-yellow-fg, #222222)" },
    cream:     { bg: "var(--normal-sheet-cream-bg, #fbf2d3)", fg: "var(--normal-sheet-cream-fg, #242424)" },
    grey:      { bg: "var(--normal-sheet-grey-bg, #d8dde2)", fg: "var(--normal-sheet-grey-fg, #222222)", style: "dotted" },
    green:     { bg: "var(--normal-sheet-green-bg, #bee32b)", fg: "var(--normal-sheet-green-fg, #202020)" },
    paleGreen: { bg: "var(--normal-sheet-palegreen-bg, #eef5cd)", fg: "var(--normal-sheet-palegreen-fg, #202020)", style: "dotted" },
    softGreen: { bg: "var(--normal-sheet-softgreen-bg, #ddf2d8)", fg: "var(--normal-sheet-softgreen-fg, #202020)", style: "dotted" },
    blank:     { bg: "transparent", fg: "var(--normal-sheet-text, #202020)", border: "transparent" },
  };
  const color = palette[tone];
  return {
    height: SHEET_ROW_HEIGHT * heightRows + SHEET_BORDER_WIDTH * Math.max(0, heightRows - 1),
    minWidth: tone === "blank" ? 0 : 48,
    padding: tone === "blank" ? 0 : "0 8px",
    border: `1px ${color.style ?? "solid"} ${color.border ?? "var(--normal-sheet-line, #303030)"}`,
    background: color.bg,
    color: color.fg,
    fontWeight: strong ? 700 : 400,
    textAlign: "center",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    lineHeight: `${SHEET_ROW_HEIGHT}px`,
  };
}

function evaluateNormalTable(
  blocks: NormalTableBlock[],
  lookup: Record<string, string>,
): Map<string, string> {
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
  perBlock.forEach((syms, bi) => {
    for (const [name, raw] of Object.entries(syms)) {
      const value = cache.get(displayKey(bi, name));
      if (value !== undefined && value !== null) {
        display.set(displayKey(bi, name), formatNumber(value, String(raw).trim().startsWith("=")));
        continue;
      }

      const s = String(raw).trim();
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

  return display;
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
    return this.tokens[this.pos] ?? { type: "eof", value: "" };
  }
}

type Token = { type: "number" | "ident" | "op" | "eof"; value: string };

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
      tokens.push({ type: "number", value: number[0] });
      i += number[0].length;
      continue;
    }
    const ident = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (ident) {
      tokens.push({ type: "ident", value: ident[0] });
      i += ident[0].length;
      continue;
    }
    const op = rest.startsWith("**") || rest.startsWith("//") ? rest.slice(0, 2) : ch;
    if ("+-*/%(),".includes(op) || op === "**" || op === "//") {
      tokens.push({ type: "op", value: op });
      i += op.length;
      continue;
    }
    throw new Error(`invalid token at ${i}`);
  }
  tokens.push({ type: "eof", value: "" });
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

function cellTooltip(raw: string, value: string, lookup: Record<string, string>): string {
  const s = String(raw).trim();
  if (!s || s === "-") return "";
  if (s.startsWith("=")) return `公式\n${s.slice(1).trim()}\n\n结果\n${value}`;
  if (isDataKey(s)) {
    const current = lookupValue(lookup, s);
    return `数据源\n${s}\n\n当前值\n${current === undefined || current === "" ? "(missing)" : current}`;
  }
  return `固定值\n${s}`;
}
