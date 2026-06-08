import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";

import { HoverTooltip } from "@/components/common/HoverTooltip";
import { getFaceTableSchema, type FaceTableSchema } from "@/ipc/faceTable";

interface Props {
  tomlData: Record<string, string>;
}

type FaceScope = "TOP" | "FBT" | "FLT";
type FaceTableId = "CWR" | Exclude<FaceScope, "TOP">;
type FaceCellKind = "title" | "kvLabel" | "label" | "data" | "formula" | "blank";
type FaceGroupItem = readonly [number, string];

interface FaceCellValue {
  raw: string;
  text: string;
  formula: boolean;
}

interface FaceTableUiState {
  fbtExpanded: boolean;
  fltExpanded: boolean;
  detailBelowLayout: boolean;
  tableOrder: FaceTableId[];
}

interface FaceDragHandleProps {
  draggable: true;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}

const LIMIT_LABEL = "\u6781\u503c\u9650\u5236";
const FACE_ROW_HEIGHT = 24;
const FACE_BORDER_WIDTH = 1;
const FACE_SECTION_ROWS = 5;
const FACE_TABLE_HEIGHT = FACE_ROW_HEIGHT * 4;
const FACE_KV_ROWS = 4;
const FACE_KV_ROW_HEIGHT =
  (FACE_TABLE_HEIGHT - FACE_BORDER_WIDTH * (FACE_KV_ROWS - 1)) / FACE_KV_ROWS;
const FACE_INLINE_SECTION_ROW_HEIGHT =
  (FACE_TABLE_HEIGHT - FACE_BORDER_WIDTH * (FACE_SECTION_ROWS - 1)) / FACE_SECTION_ROWS;
const FACE_TABLE_COLUMN_WIDTHS = [48, 124, 124, 124, 88, 124, 88];
const FACE_TABLE_WIDTH = FACE_TABLE_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0);
const FACE_TABLE_UI_STATE_KEY = "luxe:isp6s:face-table-ui:v1";
const DEFAULT_FACE_TABLE_ORDER: FaceTableId[] = ["CWR", "FBT", "FLT"];
const DEFAULT_FACE_TABLE_UI_STATE: FaceTableUiState = {
  fbtExpanded: true,
  fltExpanded: true,
  detailBelowLayout: true,
  tableOrder: DEFAULT_FACE_TABLE_ORDER,
};

const FACE_TOP_KV = [
  ["Face_LINK", "FLT_THD", "Cal_FLT"],
  ["Link_AE_CWR", "FBT_THD", "Cal_BackTar"],
  ["Normal_CWR", "lowbnd", "Cal_FBT"],
  [LIMIT_LABEL, "highbnd", "Cal_Gain"],
] as const;

const FACE_GROUPS_FBT: readonly (readonly FaceGroupItem[])[] = [
  [[1, "FaceOE_TAR"], [1, "FDTH"], [1, "OETH"], [2, "BackTarget"]],
  [[1, "PURE_TAR"], [1, "OE_SYS"], [1, "FDMINTH"], [1, "FBTCwrTarget"], [1, "FDY"]],
  [[1, "Target"], [1, "FDDR_RA"], [1, "Face_Prob"], [1, "NormalTarget"], [1, "CWV"]],
] as const;

const FACE_GROUPS_FLT: readonly (readonly FaceGroupItem[])[] = [
  [[1, "FaceOE_TAR"], [1, "FDTH"], [1, "OETH"], [2, "Link_FACE_CWR"]],
  [[1, "PURE_TAR"], [1, "OE_SYS"], [1, "FDMINTH"], [1, "FLTCwrTarget"], [1, "FDY"]],
  [[1, "Target"], [1, "FDDR_RA"], [1, "FDSZ_RA"], [1, "NormalTarget"], [1, "CWV"]],
] as const;

const YELLOW_PAIR = new Set(["NormalTarget", "FDSZ_RA", "Face_Prob"]);
const WHITE_FG = new Set(["FDTH", "OETH", "OE_SYS", "FDMINTH", "FDDR_RA", "FDY", "CWV"]);

function loadFaceTableUiState(): FaceTableUiState {
  if (typeof window === "undefined") return DEFAULT_FACE_TABLE_UI_STATE;

  try {
    const raw = window.localStorage.getItem(FACE_TABLE_UI_STATE_KEY);
    if (!raw) return DEFAULT_FACE_TABLE_UI_STATE;
    const parsed = JSON.parse(raw) as Partial<FaceTableUiState>;
    return {
      fbtExpanded: typeof parsed.fbtExpanded === "boolean"
        ? parsed.fbtExpanded
        : DEFAULT_FACE_TABLE_UI_STATE.fbtExpanded,
      fltExpanded: typeof parsed.fltExpanded === "boolean"
        ? parsed.fltExpanded
        : DEFAULT_FACE_TABLE_UI_STATE.fltExpanded,
      detailBelowLayout: typeof parsed.detailBelowLayout === "boolean"
        ? parsed.detailBelowLayout
        : DEFAULT_FACE_TABLE_UI_STATE.detailBelowLayout,
      tableOrder: sanitizeFaceTableOrder(parsed.tableOrder),
    };
  } catch {
    return DEFAULT_FACE_TABLE_UI_STATE;
  }
}

function saveFaceTableUiState(state: FaceTableUiState): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(FACE_TABLE_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Persisted UI state should not block table rendering.
  }
}

function sanitizeFaceTableOrder(value: unknown): FaceTableId[] {
  if (!Array.isArray(value)) return DEFAULT_FACE_TABLE_ORDER;

  const seen = new Set<FaceTableId>();
  const out: FaceTableId[] = [];
  value.forEach((item) => {
    if (isFaceTableId(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  });
  DEFAULT_FACE_TABLE_ORDER.forEach((item) => {
    if (!seen.has(item)) out.push(item);
  });
  return out;
}

function isFaceTableId(value: unknown): value is FaceTableId {
  return value === "CWR" || value === "FBT" || value === "FLT";
}

function moveFaceTable(order: FaceTableId[], from: FaceTableId, to: FaceTableId): FaceTableId[] {
  if (from === to) return order;
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return order;

  const next = order.slice();
  const [item] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, item);
  return next;
}

export function FaceTable({ tomlData }: Props) {
  const [schema, setSchema] = useState<FaceTableSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialUiState] = useState<FaceTableUiState>(() => loadFaceTableUiState());
  const [fbtExpanded, setFbtExpanded] = useState(initialUiState.fbtExpanded);
  const [fltExpanded, setFltExpanded] = useState(initialUiState.fltExpanded);
  const [detailBelowLayout, setDetailBelowLayout] = useState(initialUiState.detailBelowLayout);
  const [tableOrder, setTableOrder] = useState<FaceTableId[]>(initialUiState.tableOrder);
  const [draggingTable, setDraggingTable] = useState<FaceTableId | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFaceTableSchema()
      .then((next) => {
        if (!cancelled) setSchema(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    saveFaceTableUiState({ fbtExpanded, fltExpanded, detailBelowLayout, tableOrder });
  }, [fbtExpanded, fltExpanded, detailBelowLayout, tableOrder]);

  const lookup = useMemo(() => withLookupAliases(tomlData), [tomlData]);
  const display = useMemo(
    () => schema ? evaluateFaceTable(schema, lookup) : new Map<string, string>(),
    [schema, lookup],
  );
  const topTableOrder = detailBelowLayout ? tableOrder.slice(0, 2) : tableOrder;
  const bottomTableOrder = detailBelowLayout ? tableOrder.slice(2) : [];

  const makeDragHandleProps = (id: FaceTableId): FaceDragHandleProps => ({
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      setDraggingTable(id);
    },
    onDragEnd: () => setDraggingTable(null),
  });

  const dropFaceTable = (from: FaceTableId, to: FaceTableId) => {
    setTableOrder((order) => moveFaceTable(order, from, to));
    setDraggingTable(null);
  };

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs"
           style={{ color: "var(--colorPaletteRedForeground1)" }}>
        face_table.toml load failed: {error}
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--colorNeutralForeground3)" }}>
        Loading face table...
      </div>
    );
  }

  if (Object.keys(schema.FBT ?? {}).length === 0 && Object.keys(schema.FLT ?? {}).length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--colorNeutralForeground3)" }}>
        face_table.toml has no FBT / FLT sections
      </div>
    );
  }

  return (
    <div
      className="h-full w-full overflow-auto"
      style={{ backgroundColor: "var(--normal-sheet-bg, #ffffff)" }}
    >
      <div style={faceCanvasStyle()}>
        <div style={faceTopRowStyle()}>
          {topTableOrder.map((id) => renderFaceTableById({
            id,
            schema,
            display,
            lookup,
            detailBelowLayout,
            fbtExpanded,
            fltExpanded,
            draggingTable,
            onToggleDetailLayout: () => setDetailBelowLayout((below) => !below),
            onToggleFbt: () => setFbtExpanded((expanded) => !expanded),
            onToggleFlt: () => setFltExpanded((expanded) => !expanded),
            dragHandleProps: makeDragHandleProps(id),
            onDropTable: dropFaceTable,
          }))}
        </div>
        {detailBelowLayout && bottomTableOrder.length > 0 && (
          <div style={faceBottomRowStyle()}>
            {bottomTableOrder.map((id) => renderFaceTableById({
              id,
              schema,
              display,
              lookup,
              detailBelowLayout,
              fbtExpanded,
              fltExpanded,
              draggingTable,
              onToggleDetailLayout: () => setDetailBelowLayout((below) => !below),
              onToggleFbt: () => setFbtExpanded((expanded) => !expanded),
              onToggleFlt: () => setFltExpanded((expanded) => !expanded),
              dragHandleProps: makeDragHandleProps(id),
              onDropTable: dropFaceTable,
            }))}
          </div>
        )}
      </div>
    </div>
  );
}

function renderFaceTableById({
  id,
  schema,
  display,
  lookup,
  detailBelowLayout,
  fbtExpanded,
  fltExpanded,
  draggingTable,
  onToggleDetailLayout,
  onToggleFbt,
  onToggleFlt,
  dragHandleProps,
  onDropTable,
}: {
  id: FaceTableId;
  schema: FaceTableSchema;
  display: Map<string, string>;
  lookup: Record<string, string>;
  detailBelowLayout: boolean;
  fbtExpanded: boolean;
  fltExpanded: boolean;
  draggingTable: FaceTableId | null;
  onToggleDetailLayout: () => void;
  onToggleFbt: () => void;
  onToggleFlt: () => void;
  dragHandleProps: FaceDragHandleProps;
  onDropTable: (from: FaceTableId, to: FaceTableId) => void;
}) {
  let body: ReactNode;
  if (id === "CWR") {
    body = (
      <FaceKvTable
        schema={schema}
        display={display}
        lookup={lookup}
        detailBelowLayout={detailBelowLayout}
        onToggleDetailLayout={onToggleDetailLayout}
        dragHandleProps={dragHandleProps}
      />
    );
  } else {
    const expanded = id === "FBT" ? fbtExpanded : fltExpanded;
    body = (
      <FaceSectionTable
        scope={id}
        groups={id === "FBT" ? FACE_GROUPS_FBT : FACE_GROUPS_FLT}
        schema={schema}
        display={display}
        lookup={lookup}
        expanded={expanded}
        onToggle={id === "FBT" ? onToggleFbt : onToggleFlt}
        rowHeight={FACE_INLINE_SECTION_ROW_HEIGHT}
        dragHandleProps={dragHandleProps}
      />
    );
  }

  return (
    <FaceTableShell
      key={id}
      id={id}
      draggingTable={draggingTable}
      onDropTable={onDropTable}
    >
      {body}
    </FaceTableShell>
  );
}

function FaceTableShell({
  id,
  draggingTable,
  onDropTable,
  children,
}: {
  id: FaceTableId;
  draggingTable: FaceTableId | null;
  onDropTable: (from: FaceTableId, to: FaceTableId) => void;
  children: ReactNode;
}) {
  const activeDrop = draggingTable !== null && draggingTable !== id;

  return (
    <div
      style={faceTableShellStyle(activeDrop)}
      onDragOver={(event) => {
        if (!activeDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const raw = event.dataTransfer.getData("text/plain");
        const from = isFaceTableId(raw) ? raw : draggingTable;
        if (from) onDropTable(from, id);
      }}
    >
      {children}
    </div>
  );
}

function FaceKvTable({
  schema,
  display,
  lookup,
  detailBelowLayout,
  onToggleDetailLayout,
  dragHandleProps,
}: {
  schema: FaceTableSchema;
  display: Map<string, string>;
  lookup: Record<string, string>;
  detailBelowLayout: boolean;
  onToggleDetailLayout: () => void;
  dragHandleProps: FaceDragHandleProps;
}) {
  return (
    <table style={faceTableStyle(true)}>
      <FaceColGroup />
      <tbody>
        {FACE_TOP_KV.map(([leftLabel, midLabel, rightLabel], rowIdx) => {
          const left = leftLabel === LIMIT_LABEL
            ? limitRangeCell(schema, display)
            : faceValue(schema, display, "TOP", leftLabel);
          const middle = faceValue(schema, display, "TOP", midLabel);
          const right = faceValue(schema, display, "TOP", rightLabel);

          return (
            <tr key={`top-${rowIdx}`}>
              {rowIdx === 0 && (
                <FaceCell kind="title" strong rowSpan={FACE_KV_ROWS} compact rowHeight={FACE_KV_ROW_HEIGHT}>
                  <LayoutToggleHeader
                    belowLayout={detailBelowLayout}
                    onToggle={onToggleDetailLayout}
                    dragHandleProps={dragHandleProps}
                  />
                </FaceCell>
              )}
              <FaceCell kind="kvLabel" strong align="left" rowHeight={FACE_KV_ROW_HEIGHT}>
                {leftLabel}
              </FaceCell>
              <FaceValueCell cell={left} rowHeight={FACE_KV_ROW_HEIGHT} tooltip={leftLabel === LIMIT_LABEL
                ? limitRangeTooltip(schema, display, lookup)
                : cellTooltip(left.raw, left.text, lookup)}
              />
              <FaceCell kind="kvLabel" strong align="left" rowHeight={FACE_KV_ROW_HEIGHT}>
                {midLabel}
              </FaceCell>
              <FaceValueCell cell={middle} rowHeight={FACE_KV_ROW_HEIGHT} tooltip={cellTooltip(middle.raw, middle.text, lookup)} />
              <FaceCell kind="title" strong align="left" rowHeight={FACE_KV_ROW_HEIGHT}>
                {rightLabel}
              </FaceCell>
              <FaceValueCell cell={right} rowHeight={FACE_KV_ROW_HEIGHT} tooltip={cellTooltip(right.raw, right.text, lookup)} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FaceSectionTable({
  scope,
  groups,
  schema,
  display,
  lookup,
  expanded,
  onToggle,
  rowHeight,
  dragHandleProps,
}: {
  scope: Exclude<FaceScope, "TOP">;
  groups: readonly (readonly FaceGroupItem[])[];
  schema: FaceTableSchema;
  display: Map<string, string>;
  lookup: Record<string, string>;
  expanded: boolean;
  onToggle: () => void;
  rowHeight: number;
  dragHandleProps: FaceDragHandleProps;
}) {
  return (
    <table style={faceTableStyle(expanded)}>
      <FaceColGroup collapsed={!expanded} />
      <tbody>
        {renderFaceSectionRows(scope, groups, schema, display, lookup, expanded, onToggle, rowHeight, dragHandleProps)}
      </tbody>
    </table>
  );
}

function FaceColGroup({ collapsed = false }: { collapsed?: boolean }) {
  const widths = collapsed ? [FACE_TABLE_COLUMN_WIDTHS[0]] : FACE_TABLE_COLUMN_WIDTHS;
  return (
    <colgroup>
      {widths.map((width, idx) => (
        <col key={idx} style={{ width }} />
      ))}
    </colgroup>
  );
}

function renderFaceSectionRows(
  scope: Exclude<FaceScope, "TOP">,
  groups: readonly (readonly FaceGroupItem[])[],
  schema: FaceTableSchema,
  display: Map<string, string>,
  lookup: Record<string, string>,
  expanded: boolean,
  onToggle: () => void,
  rowHeight: number,
  dragHandleProps: FaceDragHandleProps,
) {
  const titleCell = (
    <FaceCell key={`${scope}-title`} kind="title" strong rowSpan={FACE_SECTION_ROWS} compact rowHeight={rowHeight}>
      <SectionToggleHeader
        label={scope}
        expanded={expanded}
        onToggle={onToggle}
        dragHandleProps={dragHandleProps}
      />
    </FaceCell>
  );

  if (!expanded) {
    return (
      <tr key={`${scope}-collapsed`}>
        {titleCell}
      </tr>
    );
  }

  const rows: ReactNode[][] = Array.from({ length: FACE_SECTION_ROWS }, () => []);
  rows[0].push(titleCell);

  groups.forEach((group, groupIdx) => {
    let rowCursor = 0;
    group.forEach(([rowSpan, name], itemIdx) => {
      if (rowCursor >= FACE_SECTION_ROWS) return;

      const keyBase = `${scope}-${groupIdx}-${itemIdx}`;
      if (!name) {
        rows[rowCursor].push(
          <FaceCell key={`${keyBase}-label`} kind="blank" rowSpan={rowSpan} rowHeight={rowHeight} />,
          <FaceCell key={`${keyBase}-value`} kind="blank" rowSpan={rowSpan} rowHeight={rowHeight} />,
        );
        rowCursor += rowSpan;
        return;
      }

      const cell = faceValue(schema, display, scope, name);
      const paired = YELLOW_PAIR.has(name);
      const forceDataFg = WHITE_FG.has(name);
      rows[rowCursor].push(
        <FaceCell
          key={`${keyBase}-label`}
          kind={paired ? "kvLabel" : "label"}
          rowSpan={rowSpan}
          strong
          align="left"
          forceDataFg={forceDataFg}
          rowHeight={rowHeight}
        >
          {name}
        </FaceCell>,
        <FaceValueCell
          key={`${keyBase}-value`}
          cell={cell}
          rowSpan={rowSpan}
          kind={paired ? "kvLabel" : undefined}
          forceDataFg={forceDataFg && !cell.formula}
          tooltip={cellTooltip(cell.raw, cell.text, lookup)}
          rowHeight={rowHeight}
        />,
      );
      rowCursor += rowSpan;
    });
  });

  return rows.map((cells, rowIdx) => (
    <tr key={`${scope}-row-${rowIdx}`}>{cells}</tr>
  ));
}

function FaceValueCell({
  cell,
  rowSpan,
  kind,
  tooltip,
  forceDataFg,
  rowHeight,
}: {
  cell: FaceCellValue;
  rowSpan?: number;
  kind?: FaceCellKind;
  tooltip?: string;
  forceDataFg?: boolean;
  rowHeight?: number;
}) {
  return (
    <FaceCell
      kind={kind ?? (cell.formula ? "formula" : "data")}
      rowSpan={rowSpan}
      title={tooltip}
      forceDataFg={forceDataFg}
      rowHeight={rowHeight}
    >
      {cell.text}
    </FaceCell>
  );
}

function LayoutToggleHeader({
  belowLayout,
  onToggle,
  dragHandleProps,
}: {
  belowLayout: boolean;
  onToggle: () => void;
  dragHandleProps: FaceDragHandleProps;
}) {
  return (
    <div style={sectionToggleWrapStyle()}>
      <span style={sectionToggleLabelStyle()}>C{"\n"}W{"\n"}R</span>
      <DragHandleButton
        title={belowLayout ? "\u5207\u6362\u4e3a\u4e00\u884c\u663e\u793a" : "\u5207\u6362\u4e3a\u4e24\u884c\u663e\u793a"}
        aria-label={belowLayout ? "\u5207\u6362\u4e3a\u4e00\u884c\u663e\u793a" : "\u5207\u6362\u4e3a\u4e24\u884c\u663e\u793a"}
        onPress={onToggle}
        dragHandleProps={dragHandleProps}
      >
        {belowLayout ? "\u2194" : "\u21a7"}
      </DragHandleButton>
    </div>
  );
}

function SectionToggleHeader({
  label,
  expanded,
  onToggle,
  dragHandleProps,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  dragHandleProps: FaceDragHandleProps;
}) {
  return (
    <div style={sectionToggleWrapStyle()}>
      <span style={sectionToggleLabelStyle()}>{label.split("").join("\n")}</span>
      <DragHandleButton
        title={`${expanded ? "\u6298\u53e0" : "\u5c55\u5f00"} ${label}`}
        aria-label={`${expanded ? "\u6298\u53e0" : "\u5c55\u5f00"} ${label}`}
        onPress={onToggle}
        dragHandleProps={dragHandleProps}
      >
        {expanded ? "-" : "+"}
      </DragHandleButton>
    </div>
  );
}

function DragHandleButton({
  title,
  "aria-label": ariaLabel,
  onPress,
  dragHandleProps,
  children,
}: {
  title: string;
  "aria-label": string;
  onPress: () => void;
  dragHandleProps: FaceDragHandleProps;
  children: ReactNode;
}) {
  const draggedRef = useRef(false);

  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      draggable={dragHandleProps.draggable}
      onDragStart={(event) => {
        draggedRef.current = true;
        dragHandleProps.onDragStart(event);
      }}
      onDragEnd={() => {
        dragHandleProps.onDragEnd();
        window.setTimeout(() => { draggedRef.current = false; }, 0);
      }}
      onClick={(event) => {
        if (draggedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onPress();
      }}
      style={sectionToggleButtonStyle()}
    >
      {children}
    </button>
  );
}

function FaceCell({
  children,
  kind,
  strong,
  colSpan,
  rowSpan,
  title,
  align = "center",
  compact,
  forceDataFg,
  gap,
  rowHeight,
}: {
  children?: ReactNode;
  kind: FaceCellKind;
  strong?: boolean;
  colSpan?: number;
  rowSpan?: number;
  title?: string;
  align?: "left" | "center";
  compact?: boolean;
  forceDataFg?: boolean;
  gap?: boolean;
  rowHeight?: number;
}) {
  const body = title ? (
    <HoverTooltip content={title} positioning="below-start" wrap maxWidth={520} inline>
      <span style={faceCellContentStyle()}>{children}</span>
    </HoverTooltip>
  ) : children;

  return (
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={faceCellStyle(kind, {
        strong,
        heightRows: rowSpan ?? 1,
        align,
        compact,
        forceDataFg,
        gap,
        rowHeight,
      })}
    >
      {body}
    </td>
  );
}

function faceCanvasStyle(): CSSProperties {
  return {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "flex-start",
    minWidth: "max-content",
    padding: 0,
  };
}

function faceTopRowStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: 3,
    minWidth: "max-content",
  };
}

function faceBottomRowStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: 3,
    marginTop: 3,
    minWidth: "max-content",
  };
}

function faceTableShellStyle(activeDrop: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "flex-start",
    outline: activeDrop ? "1px dashed var(--normal-sheet-orange-bg, #ff8a00)" : "none",
    outlineOffset: 2,
  };
}

function faceTableStyle(expanded = true): CSSProperties {
  return {
    borderCollapse: "collapse",
    color: "var(--normal-sheet-text, #202020)",
    fontFamily: '"Microsoft YaHei", "Segoe UI", Arial, sans-serif',
    fontSize: 12,
    tableLayout: "fixed",
    width: expanded ? FACE_TABLE_WIDTH : FACE_TABLE_COLUMN_WIDTHS[0],
    height: FACE_TABLE_HEIGHT,
  };
}

function sectionToggleWrapStyle(): CSSProperties {
  return {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minWidth: 0,
  };
}

function sectionToggleLabelStyle(): CSSProperties {
  return {
    display: "inline-block",
    lineHeight: "15px",
    whiteSpace: "pre-line",
  };
}

function sectionToggleButtonStyle(): CSSProperties {
  return toggleButtonStyle();
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
    cursor: "grab",
    font: "inherit",
    fontWeight: 700,
    lineHeight: 1,
  };
}

function faceCellContentStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
  };
}

function faceCellStyle(
  kind: FaceCellKind,
  opts: {
    strong?: boolean;
    heightRows: number;
    align: "left" | "center";
    compact?: boolean;
    forceDataFg?: boolean;
    gap?: boolean;
    rowHeight?: number;
  },
): CSSProperties {
  const palette: Record<FaceCellKind, { bg: string; fg: string; border?: string }> = {
    title: {
      bg: "var(--normal-sheet-orange-bg, #ff8a00)",
      fg: "var(--normal-sheet-orange-fg, #111111)",
    },
    kvLabel: {
      bg: "var(--normal-sheet-yellow-bg, #ffd95a)",
      fg: "var(--normal-sheet-yellow-fg, #222222)",
    },
    label: {
      bg: "var(--normal-sheet-grey-bg, #d8dde2)",
      fg: "var(--normal-sheet-grey-fg, #222222)",
    },
    data: {
      bg: "var(--face-sheet-data-bg, var(--normal-sheet-cream-bg, #fbf2d3))",
      fg: "var(--face-sheet-data-fg, var(--normal-sheet-cream-fg, #242424))",
    },
    formula: {
      bg: "var(--face-sheet-formula-bg, rgba(80, 120, 180, 0.24))",
      fg: "var(--face-sheet-formula-fg, #5b87c7)",
    },
    blank: {
      bg: "var(--face-sheet-blank-bg, var(--normal-sheet-bg, #ffffff))",
      fg: "var(--normal-sheet-text, #202020)",
      border: "transparent",
    },
  };
  const color = palette[kind];
  const heightRows = opts.gap ? 1 : opts.heightRows;
  const rowHeight = opts.rowHeight ?? FACE_ROW_HEIGHT;
  return {
    height: opts.gap
      ? 8
      : rowHeight * heightRows + FACE_BORDER_WIDTH * Math.max(0, heightRows - 1),
    minWidth: opts.compact ? 30 : kind === "data" || kind === "formula" ? 58 : 82,
    padding: opts.gap ? 0 : opts.compact ? "0 6px" : "0 8px",
    border: opts.gap
      ? "none"
      : `1px solid ${color.border ?? "var(--normal-sheet-line, #303030)"}`,
    background: color.bg,
    color: opts.forceDataFg ? "var(--face-sheet-data-fg, var(--normal-sheet-cream-fg, #242424))" : color.fg,
    fontWeight: opts.strong ? 700 : 500,
    textAlign: opts.align,
    verticalAlign: "middle",
    whiteSpace: opts.compact ? "pre-line" : "nowrap",
    lineHeight: opts.compact ? "15px" : `${rowHeight}px`,
    boxSizing: "border-box",
  };
}

function limitRangeCell(schema: FaceTableSchema, display: Map<string, string>): FaceCellValue {
  const lowKey = `${LIMIT_LABEL}_low`;
  const highKey = `${LIMIT_LABEL}_high`;
  const low = display.get(qual("TOP", lowKey)) ?? "-";
  const high = display.get(qual("TOP", highKey)) ?? "-";
  return {
    raw: `${rawOf(schema, "TOP", lowKey)}\n${rawOf(schema, "TOP", highKey)}`,
    text: `[${low}, ${high}]`,
    formula: false,
  };
}

function limitRangeTooltip(
  schema: FaceTableSchema,
  display: Map<string, string>,
  lookup: Record<string, string>,
): string {
  const lowKey = `${LIMIT_LABEL}_low`;
  const highKey = `${LIMIT_LABEL}_high`;
  const lowRaw = rawOf(schema, "TOP", lowKey);
  const highRaw = rawOf(schema, "TOP", highKey);
  const result = limitRangeCell(schema, display).text;
  if (!lowRaw && !highRaw) return "";
  const lowValue = display.get(qual("TOP", lowKey)) ?? "-";
  const highValue = display.get(qual("TOP", highKey)) ?? "-";
  return [
    "\u516c\u5f0f",
    `low: ${formatTooltipFormula(lowRaw)}`,
    `high: ${formatTooltipFormula(highRaw)}`,
    "",
    "\u7ed3\u679c",
    `${result}  (low=${lowValue}, high=${highValue})`,
    "",
    "\u6570\u636e\u6e90",
    `AE_TAG_AE_TARGET = ${lookupValue(lookup, "AE_TAG_AE_TARGET") ?? "(missing)"}`,
    `AE_TAG_FACE_LOW_BOUND = ${lookupValue(lookup, "AE_TAG_FACE_LOW_BOUND") ?? "(missing)"}`,
    `AE_TAG_FACE_HIGH_BOUND = ${lookupValue(lookup, "AE_TAG_FACE_HIGH_BOUND") ?? "(missing)"}`,
  ].join("\n");
}

function formatTooltipFormula(raw: string): string {
  const s = raw.trim();
  return s.startsWith("=") ? s.slice(1).trim() : s;
}

function faceValue(
  schema: FaceTableSchema,
  display: Map<string, string>,
  scope: FaceScope,
  name: string,
): FaceCellValue {
  const raw = rawOf(schema, scope, name);
  return {
    raw,
    text: display.get(qual(scope, name)) ?? "-",
    formula: raw.trim().startsWith("="),
  };
}

function rawOf(schema: FaceTableSchema, scope: FaceScope, name: string): string {
  const syms = symbolsForScope(schema, scope);
  return String(syms[name] ?? "");
}

function symbolsForScope(schema: FaceTableSchema, scope: FaceScope): Record<string, string> {
  if (scope === "FBT") return schema.FBT ?? {};
  if (scope === "FLT") return schema.FLT ?? {};
  return schema.top_kv ?? {};
}

function evaluateFaceTable(
  schema: FaceTableSchema,
  lookup: Record<string, string>,
): Map<string, string> {
  const scopes: Record<FaceScope, Record<string, string>> = {
    TOP: schema.top_kv ?? {},
    FBT: schema.FBT ?? {},
    FLT: schema.FLT ?? {},
  };
  const cache = new Map<string, number | string | null>();
  const visiting = new Set<string>();

  const resolve = (scope: FaceScope, name: string): number | string | null => {
    const key = qual(scope, name);
    if (cache.has(key)) return cache.get(key) ?? null;
    if (visiting.has(key)) {
      cache.set(key, null);
      return null;
    }

    visiting.add(key);
    try {
      let raw = scopes[scope]?.[name];
      if (raw === undefined && scope !== "TOP") raw = scopes.TOP[name];
      if (raw === undefined) {
        const direct = tagNumber(lookup, name);
        cache.set(key, direct);
        return direct;
      }

      const s = String(raw).trim();
      let value: number | string | null;
      if (!s || s === "-") value = null;
      else if (s.startsWith("=")) value = evalFaceExpression(s.slice(1).trim(), scope, resolve);
      else if (isDataKey(s)) value = tagNumber(lookup, s);
      else value = toNumber(s) ?? s;

      cache.set(key, value);
      return value;
    } finally {
      visiting.delete(key);
    }
  };

  (Object.keys(scopes) as FaceScope[]).forEach((scope) => {
    Object.keys(scopes[scope]).forEach((name) => resolve(scope, name));
  });

  const display = new Map<string, string>();
  (Object.keys(scopes) as FaceScope[]).forEach((scope) => {
    Object.entries(scopes[scope]).forEach(([name, raw]) => {
      const key = qual(scope, name);
      const value = cache.get(key);
      const s = String(raw).trim();
      const isFormula = s.startsWith("=");

      if (typeof value === "number" && Number.isFinite(value)) {
        display.set(key, formatFaceNumber(value, isFormula, scope, name));
        return;
      }
      if (typeof value === "string" && value !== "") {
        display.set(key, value);
        return;
      }
      if (!s || s === "-" || isFormula) {
        display.set(key, "-");
        return;
      }
      if (isDataKey(s)) {
        const current = lookupValue(lookup, s);
        display.set(key, current === undefined || current === "" ? "-" : String(current));
        return;
      }
      display.set(key, s);
    });
  });

  return display;
}

function evalFaceExpression(
  expr: string,
  scope: FaceScope,
  resolve: (scope: FaceScope, name: string) => number | string | null,
): number | null {
  try {
    const parser = new FaceExpressionParser(expr, scope, resolve);
    const value = parser.parse();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

class FaceExpressionParser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(
    expr: string,
    private readonly scope: FaceScope,
    private readonly resolveSymbol: (scope: FaceScope, name: string) => number | string | null,
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
      if (this.match(".")) {
        const field = this.advance();
        if (field.type !== "ident") throw new Error("expected attribute");
        return this.resolveQualified(token.value, field.value);
      }
      return this.resolveScoped(this.scope, token.value);
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
    if (upper === "CLAMP" || name === "limit") {
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

  private resolveQualified(scopeName: string, name: string): number {
    if (scopeName !== "TOP" && scopeName !== "FBT" && scopeName !== "FLT") {
      throw new Error(`unknown scope: ${scopeName}`);
    }
    return this.resolveScoped(scopeName, name);
  }

  private resolveScoped(scope: FaceScope, name: string): number {
    const value = this.resolveSymbol(scope, name);
    const n = typeof value === "number" ? value : toNumber(value);
    if (n === null) throw new Error(`unknown identifier: ${scope}.${name}`);
    return n;
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
    const ident = rest.match(/^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*/);
    if (ident) {
      tokens.push({ type: "ident", value: ident[0] });
      i += ident[0].length;
      continue;
    }
    const op = rest.startsWith("**") || rest.startsWith("//") ? rest.slice(0, 2) : ch;
    if ("+-*/%(),.".includes(op) || op === "**" || op === "//") {
      tokens.push({ type: "op", value: op });
      i += op.length;
      continue;
    }
    throw new Error(`invalid token at ${i}`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

function formatFaceNumber(value: number, isFormula: boolean, scope: FaceScope, name: string): string {
  if (isFormula) {
    if (scope === "TOP" && name === "Cal_Gain") return value.toFixed(2);
    return value.toFixed(1);
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/0+$/, "").replace(/\.$/, "");
}

function qual(scope: FaceScope, name: string): string {
  return `${scope}\u0000${name}`;
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

function isDataKey(value: string): boolean {
  return value.startsWith("AE_TAG_") || value.startsWith("SW_");
}

function cellTooltip(raw: string, value: string, lookup: Record<string, string>): string {
  const s = String(raw).trim();
  if (!s || s === "-") return "";
  if (s.startsWith("=")) return `\u516c\u5f0f\n${s.slice(1).trim()}\n\n\u7ed3\u679c\n${value}`;
  if (isDataKey(s)) {
    const current = lookupValue(lookup, s);
    return `\u6570\u636e\u6e90\n${s}\n\n\u5f53\u524d\u503c\n${current === undefined || current === "" ? "(missing)" : current}`;
  }
  return `\u56fa\u5b9a\u503c\n${s}`;
}
