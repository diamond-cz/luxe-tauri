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
import {
  calculationCellBackground,
  calculationCellForeground,
  calculationTooltip,
  formatSubstitutedValue,
  tableCellTooltip,
} from "./tableCellPresentation";

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
  substituted?: string;
}

interface FaceTableEvaluation {
  display: Map<string, string>;
  substitutions: Map<string, string>;
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

interface FaceViewportSize {
  width: number;
  height: number;
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
const FACE_TABLE_GAP = 3;
const FACE_TABLE_MIN_SCALE = 0.56;
const FACE_TABLE_SCROLLBAR_RESERVE = 18;
const FACE_TABLE_UI_STATE_KEY = "luxe:isp6s:face-table-ui:v1";
const DEFAULT_FACE_TABLE_ORDER: FaceTableId[] = ["CWR", "FBT", "FLT"];
const PREVIOUS_FACE_TABLE_ORDER: FaceTableId[] = ["CWR", "FLT", "FBT"];
const DEFAULT_FACE_TABLE_UI_STATE: FaceTableUiState = {
  fbtExpanded: true,
  fltExpanded: true,
  detailBelowLayout: true,
  tableOrder: DEFAULT_FACE_TABLE_ORDER,
};

const FACE_TOP_KV = [
  ["Face_LINK", "FLT_THD", "Cal_FLT"],
  ["Link_AE_CWR", "FBT_THD", "Cal_BackTar"],
  ["Normal_CWR", "Normal_Target", "Cal_FBT"],
  [LIMIT_LABEL, "LCE_Gain", "Cal_Gain"],
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
  if (out.length === PREVIOUS_FACE_TABLE_ORDER.length
    && out.every((item, idx) => item === PREVIOUS_FACE_TABLE_ORDER[idx])) {
    return DEFAULT_FACE_TABLE_ORDER;
  }
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [schema, setSchema] = useState<FaceTableSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialUiState] = useState<FaceTableUiState>(() => loadFaceTableUiState());
  const [fbtExpanded, setFbtExpanded] = useState(initialUiState.fbtExpanded);
  const [fltExpanded, setFltExpanded] = useState(initialUiState.fltExpanded);
  const [detailBelowLayout, setDetailBelowLayout] = useState(initialUiState.detailBelowLayout);
  const [tableOrder, setTableOrder] = useState<FaceTableId[]>(initialUiState.tableOrder);
  const [draggingTable, setDraggingTable] = useState<FaceTableId | null>(null);
  const [viewportSize, setViewportSize] = useState<FaceViewportSize>({ width: 0, height: 0 });

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
    const el = viewportRef.current;
    if (!el) return;

    const updateSize = () => {
      setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    saveFaceTableUiState({ fbtExpanded, fltExpanded, detailBelowLayout, tableOrder });
  }, [fbtExpanded, fltExpanded, detailBelowLayout, tableOrder]);

  const lookup = useMemo(() => withLookupAliases(tomlData), [tomlData]);
  const evaluated = useMemo<FaceTableEvaluation>(
    () => schema ? evaluateFaceTable(schema, lookup) : { display: new Map(), substitutions: new Map() },
    [schema, lookup],
  );
  const { display, substitutions } = evaluated;
  const tableRows: FaceTableId[][] = detailBelowLayout ? tableOrder.map((id) => [id]) : [tableOrder];
  const canvasSize = faceCanvasBaseSize(tableRows, fbtExpanded, fltExpanded);
  const fitWidthLayout = detailBelowLayout;
  const canvasScale = fitWidthLayout ? 1 : faceCanvasScale(viewportSize, canvasSize);

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
      ref={viewportRef}
      className="h-full w-full overflow-auto"
      style={{
        backgroundColor: "var(--normal-sheet-bg, #ffffff)",
        overflowX: fitWidthLayout ? "hidden" : "auto",
        overflowY: "auto",
        scrollbarGutter: "stable",
      }}
    >
      <div style={faceScaledViewportStyle(canvasSize, canvasScale, fitWidthLayout)}>
        <div style={faceScaledCanvasStyle(canvasSize, canvasScale, fitWidthLayout)}>
          <div style={faceCanvasStyle(fitWidthLayout)}>
            {tableRows.map((row, rowIdx) => (
              <div key={row.join("-")} style={faceTableRowStyle(rowIdx, fitWidthLayout)}>
                {row.map((id) => renderFaceTableById({
                  id,
                  schema,
                  display,
                  substitutions,
                  detailBelowLayout,
                  fbtExpanded,
                  fltExpanded,
                  draggingTable,
                  onToggleDetailLayout: () => setDetailBelowLayout((below) => !below),
                  onToggleFbt: () => setFbtExpanded((expanded) => !expanded),
                  onToggleFlt: () => setFltExpanded((expanded) => !expanded),
                  dragHandleProps: makeDragHandleProps(id),
                  onDropTable: dropFaceTable,
                  fitWidth: fitWidthLayout && row.length === 1,
                }))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderFaceTableById({
  id,
  schema,
  display,
  substitutions,
  detailBelowLayout,
  fbtExpanded,
  fltExpanded,
  draggingTable,
  onToggleDetailLayout,
  onToggleFbt,
  onToggleFlt,
  dragHandleProps,
  onDropTable,
  fitWidth,
}: {
  id: FaceTableId;
  schema: FaceTableSchema;
  display: Map<string, string>;
  substitutions: Map<string, string>;
  detailBelowLayout: boolean;
  fbtExpanded: boolean;
  fltExpanded: boolean;
  draggingTable: FaceTableId | null;
  onToggleDetailLayout: () => void;
  onToggleFbt: () => void;
  onToggleFlt: () => void;
  dragHandleProps: FaceDragHandleProps;
  onDropTable: (from: FaceTableId, to: FaceTableId) => void;
  fitWidth: boolean;
}) {
  let body: ReactNode;
  if (id === "CWR") {
    body = (
      <FaceKvTable
        schema={schema}
        display={display}
        substitutions={substitutions}
        detailBelowLayout={detailBelowLayout}
        onToggleDetailLayout={onToggleDetailLayout}
        dragHandleProps={dragHandleProps}
        fitWidth={fitWidth}
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
        substitutions={substitutions}
        expanded={expanded}
        onToggle={id === "FBT" ? onToggleFbt : onToggleFlt}
        rowHeight={FACE_INLINE_SECTION_ROW_HEIGHT}
        dragHandleProps={dragHandleProps}
        fitWidth={fitWidth}
      />
    );
  }

  return (
    <FaceTableShell
      key={id}
      id={id}
      draggingTable={draggingTable}
      onDropTable={onDropTable}
      fitWidth={fitWidth}
    >
      {body}
    </FaceTableShell>
  );
}

function FaceTableShell({
  id,
  draggingTable,
  onDropTable,
  fitWidth,
  children,
}: {
  id: FaceTableId;
  draggingTable: FaceTableId | null;
  onDropTable: (from: FaceTableId, to: FaceTableId) => void;
  fitWidth: boolean;
  children: ReactNode;
}) {
  const activeDrop = draggingTable !== null && draggingTable !== id;

  return (
    <div
      style={faceTableShellStyle(activeDrop, fitWidth)}
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
  substitutions,
  detailBelowLayout,
  onToggleDetailLayout,
  dragHandleProps,
  fitWidth,
}: {
  schema: FaceTableSchema;
  display: Map<string, string>;
  substitutions: Map<string, string>;
  detailBelowLayout: boolean;
  onToggleDetailLayout: () => void;
  dragHandleProps: FaceDragHandleProps;
  fitWidth: boolean;
}) {
  return (
    <table style={faceTableStyle(true, fitWidth)}>
      <FaceColGroup fitWidth={fitWidth} />
      <tbody>
        {FACE_TOP_KV.map(([leftLabel, midLabel, rightLabel], rowIdx) => {
          const left = leftLabel === LIMIT_LABEL
            ? limitRangeCell(schema, display)
            : faceValue(schema, display, substitutions, "TOP", leftLabel);
          const middle = faceValue(schema, display, substitutions, "TOP", midLabel);
          const right = faceValue(schema, display, substitutions, "TOP", rightLabel);

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
              <FaceValueCell cell={left} kind={leftLabel === LIMIT_LABEL ? "formula" : undefined} rowHeight={FACE_KV_ROW_HEIGHT} tooltip={leftLabel === LIMIT_LABEL
                ? limitRangeTooltip(schema, display, substitutions)
                : tableCellTooltip(left.raw, left.text, left.substituted)}
              />
              <FaceCell kind="kvLabel" strong align="left" rowHeight={FACE_KV_ROW_HEIGHT}>
                {midLabel}
              </FaceCell>
              <FaceValueCell
                cell={middle}
                rowHeight={FACE_KV_ROW_HEIGHT}
                forceDataFg
                tooltip={tableCellTooltip(middle.raw, middle.text, middle.substituted)}
              />
              <FaceCell kind="title" strong align="left" rowHeight={FACE_KV_ROW_HEIGHT}>
                {rightLabel}
              </FaceCell>
              <FaceValueCell cell={right} rowHeight={FACE_KV_ROW_HEIGHT} tooltip={tableCellTooltip(right.raw, right.text, right.substituted)} />
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
  substitutions,
  expanded,
  onToggle,
  rowHeight,
  dragHandleProps,
  fitWidth,
}: {
  scope: Exclude<FaceScope, "TOP">;
  groups: readonly (readonly FaceGroupItem[])[];
  schema: FaceTableSchema;
  display: Map<string, string>;
  substitutions: Map<string, string>;
  expanded: boolean;
  onToggle: () => void;
  rowHeight: number;
  dragHandleProps: FaceDragHandleProps;
  fitWidth: boolean;
}) {
  return (
    <table style={faceTableStyle(expanded, fitWidth)}>
      <FaceColGroup collapsed={!expanded} fitWidth={fitWidth} />
      <tbody>
        {renderFaceSectionRows(scope, groups, schema, display, substitutions, expanded, onToggle, rowHeight, dragHandleProps)}
      </tbody>
    </table>
  );
}

function FaceColGroup({
  collapsed = false,
  fitWidth = false,
}: {
  collapsed?: boolean;
  fitWidth?: boolean;
}) {
  const widths = collapsed ? [FACE_TABLE_COLUMN_WIDTHS[0]] : FACE_TABLE_COLUMN_WIDTHS;
  return (
    <colgroup>
      {widths.map((width, idx) => (
        <col key={idx} style={{ width: fitWidth && !collapsed ? `${(width / FACE_TABLE_WIDTH) * 100}%` : width }} />
      ))}
    </colgroup>
  );
}

function renderFaceSectionRows(
  scope: Exclude<FaceScope, "TOP">,
  groups: readonly (readonly FaceGroupItem[])[],
  schema: FaceTableSchema,
  display: Map<string, string>,
  substitutions: Map<string, string>,
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

      const cell = faceValue(schema, display, substitutions, scope, name);
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
          tooltip={tableCellTooltip(cell.raw, cell.text, cell.substituted)}
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
      kind={cell.formula ? "formula" : kind ?? "data"}
      rowSpan={rowSpan}
      title={tooltip}
      forceDataFg={cell.formula ? false : forceDataFg}
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

function faceCanvasBaseSize(
  rows: FaceTableId[][],
  fbtExpanded: boolean,
  fltExpanded: boolean,
): FaceViewportSize {
  const width = rows.reduce((maxWidth, row) => {
    const rowWidth = row.reduce(
      (sum, id) => sum + faceTableBaseWidth(id, fbtExpanded, fltExpanded),
      0,
    ) + FACE_TABLE_GAP * Math.max(0, row.length - 1);
    return Math.max(maxWidth, rowWidth);
  }, 0);

  return {
    width: Math.max(FACE_TABLE_COLUMN_WIDTHS[0], width),
    height: FACE_TABLE_HEIGHT * rows.length + FACE_TABLE_GAP * Math.max(0, rows.length - 1),
  };
}

function faceTableBaseWidth(
  id: FaceTableId,
  fbtExpanded: boolean,
  fltExpanded: boolean,
): number {
  if (id === "CWR") return FACE_TABLE_WIDTH;
  const expanded = id === "FBT" ? fbtExpanded : fltExpanded;
  return expanded ? FACE_TABLE_WIDTH : FACE_TABLE_COLUMN_WIDTHS[0];
}

function faceCanvasScale(viewport: FaceViewportSize, canvas: FaceViewportSize): number {
  if (viewport.width <= 0 || viewport.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return 1;
  }

  const availableWidth = Math.max(1, viewport.width - FACE_TABLE_SCROLLBAR_RESERVE);
  const availableHeight = Math.max(1, viewport.height - FACE_TABLE_SCROLLBAR_RESERVE);
  const fitScale = Math.min(1, availableWidth / canvas.width, availableHeight / canvas.height);
  return Math.max(FACE_TABLE_MIN_SCALE, fitScale);
}

function faceScaledViewportStyle(
  canvas: FaceViewportSize,
  scale: number,
  fitWidth: boolean,
): CSSProperties {
  return {
    position: "relative",
    width: fitWidth ? "100%" : canvas.width * scale,
    height: canvas.height * scale,
    minWidth: fitWidth ? 0 : canvas.width * scale,
    minHeight: canvas.height * scale,
  };
}

function faceScaledCanvasStyle(
  canvas: FaceViewportSize,
  scale: number,
  fitWidth: boolean,
): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: fitWidth ? "100%" : canvas.width,
    height: canvas.height,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  };
}

function faceCanvasStyle(fitWidth: boolean): CSSProperties {
  return {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "flex-start",
    width: fitWidth ? "100%" : "max-content",
    padding: 0,
  };
}

function faceTableRowStyle(rowIdx: number, fitWidth: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: FACE_TABLE_GAP,
    marginTop: rowIdx === 0 ? 0 : FACE_TABLE_GAP,
    width: fitWidth ? "100%" : undefined,
    minWidth: fitWidth ? 0 : "max-content",
  };
}

function faceTableShellStyle(activeDrop: boolean, fitWidth: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "flex-start",
    width: fitWidth ? "100%" : undefined,
    minWidth: fitWidth ? 0 : undefined,
    outline: activeDrop ? "1px dashed var(--normal-sheet-orange-bg, #ff8a00)" : "none",
    outlineOffset: 2,
  };
}

function faceTableStyle(expanded = true, fitWidth = false): CSSProperties {
  return {
    borderCollapse: "collapse",
    color: "var(--normal-sheet-text, #202020)",
    fontFamily: '"Microsoft YaHei", "Segoe UI", Arial, sans-serif',
    fontSize: 12,
    tableLayout: "fixed",
    width: expanded && fitWidth ? "100%" : expanded ? FACE_TABLE_WIDTH : FACE_TABLE_COLUMN_WIDTHS[0],
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
    display: "inline-block",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    verticalAlign: "middle",
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
      bg: calculationCellBackground,
      fg: calculationCellForeground,
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
    minWidth: 0,
    padding: opts.gap ? 0 : opts.compact ? "0 6px" : "0 8px",
    border: opts.gap
      ? "none"
      : `1px solid ${color.border ?? "var(--normal-sheet-line, #303030)"}`,
    background: color.bg,
    color: opts.forceDataFg ? "#000000" : color.fg,
    fontWeight: opts.strong ? 700 : 500,
    textAlign: opts.align,
    verticalAlign: "middle",
    whiteSpace: opts.compact ? "pre-line" : "nowrap",
    lineHeight: opts.compact ? "15px" : `${rowHeight}px`,
    overflow: "hidden",
    textOverflow: "ellipsis",
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
  substitutions: Map<string, string>,
): string {
  const lowKey = `${LIMIT_LABEL}_low`;
  const highKey = `${LIMIT_LABEL}_high`;
  const lowRaw = rawOf(schema, "TOP", lowKey);
  const highRaw = rawOf(schema, "TOP", highKey);
  const result = limitRangeCell(schema, display).text;
  if (!lowRaw && !highRaw) return "";
  const expression = `low: ${formatTooltipFormula(lowRaw)}\nhigh: ${formatTooltipFormula(highRaw)}`;
  const lowSubstituted = substitutions.get(qual("TOP", lowKey));
  const highSubstituted = substitutions.get(qual("TOP", highKey));
  const substituted = lowSubstituted && highSubstituted
    ? `low: ${lowSubstituted}\nhigh: ${highSubstituted}`
    : undefined;
  return calculationTooltip(expression, result, substituted);
}

function formatTooltipFormula(raw: string): string {
  const s = raw.trim();
  return s.startsWith("=") ? s.slice(1).trim() : s;
}

function faceValue(
  schema: FaceTableSchema,
  display: Map<string, string>,
  substitutions: Map<string, string>,
  scope: FaceScope,
  name: string,
): FaceCellValue {
  const raw = rawOf(schema, scope, name);
  return {
    raw,
    text: display.get(qual(scope, name)) ?? "-",
    formula: raw.trim().startsWith("="),
    substituted: substitutions.get(qual(scope, name)),
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
): FaceTableEvaluation {
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
  const substitutions = new Map<string, string>();
  (Object.keys(scopes) as FaceScope[]).forEach((scope) => {
    Object.entries(scopes[scope]).forEach(([name, raw]) => {
      const key = qual(scope, name);
      const value = cache.get(key);
      const s = String(raw).trim();
      const isFormula = s.startsWith("=");
      if (isFormula) {
        const substituted = substituteFaceExpression(s.slice(1).trim(), scope, resolve);
        if (substituted !== null) substitutions.set(key, substituted);
      }

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

  return { display, substitutions };
}

function substituteFaceExpression(
  expr: string,
  scope: FaceScope,
  resolve: (scope: FaceScope, name: string) => number | string | null,
): string | null {
  try {
    const tokens = tokenize(expr);
    let substituted = "";
    let cursor = 0;
    tokens.forEach((token, index) => {
      if (token.type !== "ident" || tokens[index + 1]?.value === "(") return;
      let symbolScope = scope;
      let symbolName = token.value;
      let end = token.end;
      if (tokens[index + 1]?.value === "." && tokens[index + 2]?.type === "ident") {
        if (symbolName !== "TOP" && symbolName !== "FBT" && symbolName !== "FLT") return;
        symbolScope = symbolName;
        symbolName = tokens[index + 2].value;
        end = tokens[index + 2].end;
      } else if (index > 0 && tokens[index - 1].value === ".") {
        return;
      }
      const resolved = resolve(symbolScope, symbolName);
      const value = typeof resolved === "number" ? resolved : toNumber(resolved);
      if (value === null) return;
      substituted += expr.slice(cursor, token.start);
      substituted += formatSubstitutedValue(value);
      cursor = end;
    });
    return substituted + expr.slice(cursor);
  } catch {
    return null;
  }
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
    const ident = rest.match(/^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*/);
    if (ident) {
      tokens.push({ type: "ident", value: ident[0], start: i, end: i + ident[0].length });
      i += ident[0].length;
      continue;
    }
    const op = rest.startsWith("**") || rest.startsWith("//") ? rest.slice(0, 2) : ch;
    if ("+-*/%(),.".includes(op) || op === "**" || op === "//") {
      tokens.push({ type: "op", value: op, start: i, end: i + op.length });
      i += op.length;
      continue;
    }
    throw new Error(`invalid token at ${i}`);
  }
  tokens.push({ type: "eof", value: "", start: i, end: i });
  return tokens;
}

function formatFaceNumber(value: number, isFormula: boolean, scope: FaceScope, name: string): string {
  if (isFormula) {
    if (scope === "TOP" && (name === "Cal_Gain" || name === "LCE_Gain")) return value.toFixed(2);
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
