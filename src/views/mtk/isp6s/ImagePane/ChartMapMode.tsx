import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import {
  DndContext, closestCenter, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, rectSortingStrategy, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown24Regular, ChevronUp24Regular, Code24Regular, TableLink24Regular } from "@fluentui/react-icons";

import {
  cppGetFieldsAtPath,
  cppGetFieldsInRange,
  cppResolveCardSource,
  type CardSourceSpec,
  type Isp6sSchemaRoot,
} from "@/ipc/cppParser";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import type { FieldEntry } from "@/types/cpp_parser";

type ChartTabId = "MainT" | "HS" | "NS" | "ABL" | "Face" | "Face_FLT" | "Touch";
type StepperDirection = "up" | "down";
type MidChartMode = "thd" | "corr_mid" | "b2d_ori" | "b2d_corr";
type MidChartSource = "mid" | "mid_value" | "corr_dr_midratio" | "dr_midratio_ori" | "b2d";
type BindingPanelKind = "bv" | "mid";
type MainTMetricCardId = "mainThd" | "mtwv" | "mainTarget";
type HsMetricCardId = "hsTarget" | "hsWeight" | "hsBright" | "hsMiddle" | "hsDark";
type HsWeightToneId = "target" | "dark" | "middle" | "bright";
type HsWeightCellTarget =
  | { kind: "bv"; bvIndex: number }
  | { kind: "dr"; bvIndex: number; drIndex: number }
  | { kind: "mid"; midIndex: number }
  | { kind: "value"; bvIndex: number; drIndex: number; midIndex: number; channelIndex: number };
type HsAreaCellTarget =
  | { kind: "rowHeader"; rowIndex: number }
  | { kind: "columnHeader"; columnIndex: number }
  | { kind: "value"; rowIndex: number; columnIndex: number };

interface Props {
  filePath: string;
  schema:   Isp6sSchemaRoot;
  tomlData: Record<string, string>;
  activeCard?: string;
  activeCardKey?: number;
  focusTarget?: ChartFocusTarget | null;
  sourceRevision?: number;
  sourceDraftText?: string | null;
  onSourceDraftTextChange?: (text: string) => void;
  onSourceJump?: (label: string, spec: CardSourceSpec) => void;
}

interface ChartFocusTarget {
  label: string;
  key:   number;
}

interface ChartSection {
  id:    string;
  title: string;
  subtitle?: string;
  rows:  ChartRow[];
}

interface ChartRow {
  id:     string;
  line:   number;
  label:  string;
  path:   string;
  values: string[];
}

interface MainTargetThresholdRow {
  label:  "BV" | "Base" | "Exp";
  path:   string;
  values: string[];
  fields: FieldEntry[];
}

interface MtwvTableRow {
  id:     string;
  line:   number;
  path:   string;
  values: string[];
  fields: FieldEntry[];
}

interface MtwvSource {
  path: string;
  rows: MtwvTableRow[];
}

interface HsWeightSource {
  bvPath: string;
  drB2dPath: string;
  midPath: string;
  matrixPath: string;
  bvAxis: number[];
  bvAxisFields: Array<FieldEntry | null>;
  drB2dRows: number[][];
  drB2dFields: Array<Array<FieldEntry | null>>;
  midAxis: number[];
  midAxisFields: Array<FieldEntry | null>;
  values: number[][][][];
  valueFields: Array<Array<Array<Array<FieldEntry | null>>>>;
  fields: FieldEntry[];
}

interface HsAreaSource {
  rowHeaderPath: string;
  columnHeaderPath: string;
  valuePath: string;
  rowCountPath: string;
  columnCountPath: string;
  rowCount: number;
  columnCount: number;
  rowHeaders: number[];
  rowHeaderFields: Array<FieldEntry | null>;
  columnHeaders: number[];
  columnHeaderFields: Array<FieldEntry | null>;
  values: number[][];
  valueFields: Array<Array<FieldEntry | null>>;
  fields: FieldEntry[];
}

interface HsAreaSourceConfig {
  rowHeaderPath: string;
  columnHeaderPath: string;
  valuePath: string;
  rowCountPath: string;
  columnCountPath: string;
}

interface MidCurveSource {
  x1: string[];
  y1: string[];
  x2: string[];
  y2: string[];
}

interface B2dCurveSource {
  x: string[];
  y: string[];
}

interface B2dCorrCurveSource {
  value: string[];
  x1: string[];
  y1: string[];
  x2: string[];
  y2: string[];
}

interface BindingEntry {
  id: string;
  label: string;
  path: string;
  values: string[];
}

const CHART_TABS: ChartTabId[] = ["MainT", "HS", "NS", "ABL", "Face", "Face_FLT", "Touch"];
const SOURCE_NUMBER_RE = /[-+]?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
const MAIN_T_METRIC_CARD_ORDER: MainTMetricCardId[] = ["mainThd", "mtwv", "mainTarget"];
const HS_METRIC_CARD_ORDER: HsMetricCardId[] = ["hsTarget", "hsWeight", "hsBright", "hsMiddle", "hsDark"];
const HS_TARGET_TERM_ORDER = ["BT", "MT", "DT"];
const HS_TARGET_AREA_CARD_BY_ID: Record<string, HsMetricCardId> = {
  BT: "hsBright",
  MT: "hsMiddle",
  DT: "hsDark",
};
const HS_TARGET_AREA_LABEL_BY_ID: Record<string, string> = {
  BT: "HS Bright Area 卡片",
  MT: "HS Middle Area 卡片",
  DT: "HS Dark Area 卡片",
};
const MAIN_TARGET_CWV_KEY = "AE_TAG_FACE_20_CWV";
const HS_TARGET_CWV_KEY = "AE_TAG_CWV";
const MTWV_VALUE_KEY = "AE_TAG_MTV6_MAINT_Y";
const MTWV_WEIGHT_TABLE_PATH = "[0][3][1][20]" as const;
const HS_WEIGHT_CHANNELS: Array<{ id: HsWeightToneId }> = [
  { id: "target" },
  { id: "dark" },
  { id: "middle" },
  { id: "bright" },
];
const HS_WEIGHT_RESULT_ITEMS: Array<{ id: HsWeightToneId; label: string; wetKey: string }> = [
  { id: "target", label: "MT%",     wetKey: "AE_TAG_HSV6_MAINT_WET" },
  { id: "dark",   label: "Dark%",   wetKey: "AE_TAG_HSV6_DT_WET" },
  { id: "middle", label: "Middle%", wetKey: "AE_TAG_HSV6_MT_WET" },
  { id: "bright", label: "Bright%", wetKey: "AE_TAG_HSV6_BT_WET" },
];
const HS_WEIGHT_BV_COLUMN_WIDTH = 42;
const HS_WEIGHT_DR_COLUMN_WIDTH = 52;
const HS_WEIGHT_MID_COLUMN_WIDTH = 150;
const HS_WEIGHT_MINI_TABLE_WIDTH = 120;
const HS_WEIGHT_MID_COLUMN_GAP = (HS_WEIGHT_MID_COLUMN_WIDTH - HS_WEIGHT_MINI_TABLE_WIDTH) / 2;
const HS_WEIGHT_BV_PATH = "[0][3][1][40]" as const;
const HS_WEIGHT_DR_B2D_PATH = "[0][3][1][41]" as const;
const HS_WEIGHT_MID_PATH = "[0][3][1][42]" as const;
const HS_WEIGHT_VALUE_PATH = "[0][3][1][43]" as const;
const HS_BRIGHT_EVD_KEY = "AE_TAG_HS_EVD";
const HS_BRIGHT_AREA_ROW_HEADER_PATH = "[0][3][1][25]" as const;
const HS_BRIGHT_AREA_COLUMN_HEADER_PATH = "[0][3][1][27]" as const;
const HS_BRIGHT_AREA_VALUE_PATH = "[0][3][1][28]" as const;
const HS_BRIGHT_AREA_ROW_COUNT_PATH = "[0][3][1].93" as const;
const HS_BRIGHT_AREA_COLUMN_COUNT_PATH = "[0][3][1].94" as const;
const HS_BRIGHT_AREA_SOURCE_PATHS = [
  HS_BRIGHT_AREA_ROW_HEADER_PATH,
  HS_BRIGHT_AREA_COLUMN_HEADER_PATH,
  HS_BRIGHT_AREA_VALUE_PATH,
  HS_BRIGHT_AREA_ROW_COUNT_PATH,
  HS_BRIGHT_AREA_COLUMN_COUNT_PATH,
] as const;
const HS_BRIGHT_AREA_SOURCE_CONFIG: HsAreaSourceConfig = {
  rowHeaderPath: HS_BRIGHT_AREA_ROW_HEADER_PATH,
  columnHeaderPath: HS_BRIGHT_AREA_COLUMN_HEADER_PATH,
  valuePath: HS_BRIGHT_AREA_VALUE_PATH,
  rowCountPath: HS_BRIGHT_AREA_ROW_COUNT_PATH,
  columnCountPath: HS_BRIGHT_AREA_COLUMN_COUNT_PATH,
};
const HS_MIDDLE_B2M_KEY = "AE_TAG_DRV6_B2M";
const HS_MIDDLE_AREA_ROW_HEADER_PATH = "[0][3][1][33]" as const;
const HS_MIDDLE_AREA_COLUMN_HEADER_PATH = "[0][3][1][35]" as const;
const HS_MIDDLE_AREA_VALUE_PATH = "[0][3][1][36]" as const;
const HS_MIDDLE_AREA_ROW_COUNT_PATH = "[0][3][1].98" as const;
const HS_MIDDLE_AREA_COLUMN_COUNT_PATH = "[0][3][1].99" as const;
const HS_MIDDLE_AREA_SOURCE_PATHS = [
  HS_MIDDLE_AREA_ROW_HEADER_PATH,
  HS_MIDDLE_AREA_COLUMN_HEADER_PATH,
  HS_MIDDLE_AREA_VALUE_PATH,
  HS_MIDDLE_AREA_ROW_COUNT_PATH,
  HS_MIDDLE_AREA_COLUMN_COUNT_PATH,
] as const;
const HS_MIDDLE_AREA_SOURCE_CONFIG: HsAreaSourceConfig = {
  rowHeaderPath: HS_MIDDLE_AREA_ROW_HEADER_PATH,
  columnHeaderPath: HS_MIDDLE_AREA_COLUMN_HEADER_PATH,
  valuePath: HS_MIDDLE_AREA_VALUE_PATH,
  rowCountPath: HS_MIDDLE_AREA_ROW_COUNT_PATH,
  columnCountPath: HS_MIDDLE_AREA_COLUMN_COUNT_PATH,
};
const HS_DARK_AREA_ROW_HEADER_PATH = "[0][3][1][37]" as const;
const HS_DARK_AREA_COLUMN_HEADER_PATH = "[0][3][1][38]" as const;
const HS_DARK_AREA_VALUE_PATH = "[0][3][1][39]" as const;
const HS_DARK_AREA_ROW_COUNT_PATH = "[0][3][1].100" as const;
const HS_DARK_AREA_COLUMN_COUNT_PATH = "[0][3][1].101" as const;
const HS_DARK_AREA_SOURCE_PATHS = [
  HS_DARK_AREA_ROW_HEADER_PATH,
  HS_DARK_AREA_COLUMN_HEADER_PATH,
  HS_DARK_AREA_VALUE_PATH,
  HS_DARK_AREA_ROW_COUNT_PATH,
  HS_DARK_AREA_COLUMN_COUNT_PATH,
] as const;
const HS_DARK_AREA_SOURCE_CONFIG: HsAreaSourceConfig = {
  rowHeaderPath: HS_DARK_AREA_ROW_HEADER_PATH,
  columnHeaderPath: HS_DARK_AREA_COLUMN_HEADER_PATH,
  valuePath: HS_DARK_AREA_VALUE_PATH,
  rowCountPath: HS_DARK_AREA_ROW_COUNT_PATH,
  columnCountPath: HS_DARK_AREA_COLUMN_COUNT_PATH,
};
const HS_TARGET_INPUTS = [
  {
    id: "BT",
    label: "BT",
    thdKey: "AE_TAG_HSV6_BT_THD",
    yKey: "AE_TAG_HSV6_BT_Final_Y",
    wetKey: "AE_TAG_HSV6_BT_WET",
    targetKey: "AE_TAG_HSV6_BT_TARGET",
  },
  {
    id: "MT",
    label: "MT",
    thdKey: "AE_TAG_HSV6_MT_THD",
    yKey: "AE_TAG_HSV6_MT_Final_Y",
    wetKey: "AE_TAG_HSV6_MT_WET",
    targetKey: "AE_TAG_HSV6_MT_TARGET",
  },
  {
    id: "DT",
    label: "DT",
    thdKey: "AE_TAG_HSV6_DT_THD",
    yKey: "AE_TAG_HSV6_DT_Final_Y",
    wetKey: "AE_TAG_HSV6_DT_WET",
    targetKey: "AE_TAG_HSV6_DT_TARGET",
  },
] as const;
const MAIN_TARGET_THRESHOLD_PATHS = ["[0][3][1][22]", "[0][3][1][23]", "[0][3][1][24]"] as const;
const MID_CURVE_PATHS = {
  x1: "[0][3][1].65",
  y1: "[0][3][1].66",
  x2: "[0][3][1].67",
  y2: "[0][3][1].68",
} as const;
const MID_CURVE_SOURCE_PATHS = [MID_CURVE_PATHS.x1, MID_CURVE_PATHS.y1, MID_CURVE_PATHS.x2, MID_CURVE_PATHS.y2] as const;
const B2D_CURVE_PATHS = {
  x: "[0][3][1][45]",
  y: "[0][3][1][46]",
} as const;
const B2D_CURVE_SOURCE_PATHS = [B2D_CURVE_PATHS.x, B2D_CURVE_PATHS.y] as const;
const B2D_CORR_CURVE_PATHS = {
  value: "[0][3][1].73",
  x1: "[0][3][1].74",
  y1: "[0][3][1].75",
  x2: "[0][3][1].76",
  y2: "[0][3][1].77",
} as const;
const B2D_CORR_CURVE_SOURCE_PATHS = [
  B2D_CORR_CURVE_PATHS.value,
  B2D_CORR_CURVE_PATHS.x1,
  B2D_CORR_CURVE_PATHS.y1,
  B2D_CORR_CURVE_PATHS.x2,
  B2D_CORR_CURVE_PATHS.y2,
] as const;
const MID_CONTROL_SOURCE_PATHS = [
  ...MID_CURVE_SOURCE_PATHS,
  ...B2D_CORR_CURVE_SOURCE_PATHS,
  ...B2D_CURVE_SOURCE_PATHS,
] as const;
const MAIN_T_SOURCE_GROUPS: Array<{ id: string; title: string; paths: readonly string[] }> = [
  { id: "mtwv", title: "MTWV", paths: [MTWV_WEIGHT_TABLE_PATH] },
  { id: "threshold", title: "Main Target Threshold", paths: MAIN_TARGET_THRESHOLD_PATHS },
  { id: "mid", title: "Mid 曲线", paths: MID_CURVE_SOURCE_PATHS },
  { id: "b2dOri", title: "B2D ori", paths: B2D_CURVE_SOURCE_PATHS },
  { id: "b2dCorr", title: "B2D corr", paths: B2D_CORR_CURVE_SOURCE_PATHS },
];
const MAIN_TARGET_THRESHOLD_SOURCE_SPEC: CardSourceSpec = {
  paths: [...MAIN_TARGET_THRESHOLD_PATHS],
  jump_to: "first",
  highlight: "ranges",
};
const MID_CONTROL_SOURCE_SPEC: CardSourceSpec = {
  paths: [...MID_CONTROL_SOURCE_PATHS],
  jump_to: "first",
  highlight: "ranges",
};
const MTWV_SOURCE_SPEC: CardSourceSpec = {
  paths: [MTWV_WEIGHT_TABLE_PATH],
  jump_to: "first",
  highlight: "ranges",
};
const MAIN_TARGET_THRESHOLD_ROWS: Array<{ label: MainTargetThresholdRow["label"]; path: string }> = [
  { label: "BV",   path: MAIN_TARGET_THRESHOLD_PATHS[0] },
  { label: "Base", path: MAIN_TARGET_THRESHOLD_PATHS[1] },
  { label: "Exp",  path: MAIN_TARGET_THRESHOLD_PATHS[2] },
];

export function ChartMapMode({
  filePath,
  schema,
  tomlData,
  activeCard,
  activeCardKey,
  focusTarget,
  sourceRevision,
  sourceDraftText,
  onSourceDraftTextChange,
  onSourceJump,
}: Props) {
  const visual = useIsp6sVisualStore((state) => state.visual);
  const patchVis = useIsp6sVisualStore((state) => state.patch);
  const [tab, setTabState] = useState<ChartTabId>(() => coerceTab(activeCard) ?? coerceTab(visual.chart_map_tab) ?? "MainT");
  const [sections, setSections] = useState<ChartSection[]>([]);
  const [mainTargetThreshold, setMainTargetThreshold] = useState<MainTargetThresholdRow[] | null>(null);
  const [mainTargetMtwv, setMainTargetMtwv] = useState<MtwvSource | null>(null);
  const [mainTargetMidCurve, setMainTargetMidCurve] = useState<MidCurveSource | null>(null);
  const [mainTargetB2dCurve, setMainTargetB2dCurve] = useState<B2dCurveSource | null>(null);
  const [mainTargetB2dCorrCurve, setMainTargetB2dCorrCurve] = useState<B2dCorrCurveSource | null>(null);
  const [hsWeightSource, setHsWeightSource] = useState<HsWeightSource | null>(null);
  const [hsBrightAreaSource, setHsBrightAreaSource] = useState<HsAreaSource | null>(null);
  const [hsMiddleAreaSource, setHsMiddleAreaSource] = useState<HsAreaSource | null>(null);
  const [hsDarkAreaSource, setHsDarkAreaSource] = useState<HsAreaSource | null>(null);
  const [hsSourceIdentity, setHsSourceIdentity] = useState<string | null>(null);
  const [mainThdValue, setMainThdValue] = useState(NaN);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mainTCardSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const setTab = useCallback((next: ChartTabId) => {
    setTabState(next);
    patchVis({ chart_map_tab: next });
  }, [patchVis]);

  useEffect(() => {
    const next = coerceTab(activeCard);
    if (next) setTab(next);
  }, [activeCard, activeCardKey, setTab]);

  useEffect(() => {
    if (focusTarget?.label.startsWith("Main_Target_Threshold") || focusTarget?.label.startsWith("MTWV")) {
      setTab("MainT");
    }
    if (hsMetricCardIdForFocusLabel(focusTarget?.label)) {
      setTab("HS");
    }
  }, [focusTarget, setTab]);

  const sourceKey = useMemo(() => tab, [tab]);
  const sourceIdentity = useMemo(
    () => filePath ? `${filePath}\u0000${sourceRevision ?? 0}` : null,
    [filePath, sourceRevision],
  );
  const currentHsWeightSource = hsSourceIdentity === sourceIdentity ? hsWeightSource : null;
  const currentHsBrightAreaSource = hsSourceIdentity === sourceIdentity ? hsBrightAreaSource : null;
  const currentHsMiddleAreaSource = hsSourceIdentity === sourceIdentity ? hsMiddleAreaSource : null;
  const currentHsDarkAreaSource = hsSourceIdentity === sourceIdentity ? hsDarkAreaSource : null;
  const imageBvValue = useMemo(
    () => readTomlValue(tomlData, schema.Image?.BV ?? "AE_TAG_REALBVX1000"),
    [schema.Image, tomlData],
  );
  const imageMtwvValue = useMemo(
    () => readTomlValue(tomlData, MTWV_VALUE_KEY),
    [tomlData],
  );
  const imageCwvValue = useMemo(
    () => readTomlValue(tomlData, MAIN_TARGET_CWV_KEY),
    [tomlData],
  );
  const hsCwvValue = useMemo(
    () => readTomlValue(tomlData, HS_TARGET_CWV_KEY) ?? imageCwvValue,
    [imageCwvValue, tomlData],
  );
  const hsTargetInputs = useMemo(
    () => HS_TARGET_INPUTS.map((input) => ({
      ...input,
      thd: readTomlValue(tomlData, input.thdKey),
      y: readTomlValue(tomlData, input.yKey),
      wet: readTomlValue(tomlData, schema.card?.Normal?.wt?.[input.id] ?? input.wetKey),
      targetValue: readTomlValue(tomlData, input.targetKey),
    })),
    [schema.card, tomlData],
  );
  const hsWeightWetValues = useMemo(
    () => Object.fromEntries(
      HS_WEIGHT_RESULT_ITEMS.map((item) => [item.id, readTomlValue(tomlData, item.wetKey)]),
    ) as Record<HsWeightToneId, string | null>,
    [tomlData],
  );
  const imageMidratioValue = useMemo(
    () => readTomlValue(tomlData, "AE_TAG_MTV6_MAINT_MID_INTRATIO"),
    [tomlData],
  );
  const corrDrMidratioValue = useMemo(
    () => readTomlValue(tomlData, "AE_TAG_DRV6_CORR_MIDRATIO"),
    [tomlData],
  );
  const midratioOriValue = useMemo(
    () => readTomlValue(tomlData, "AE_TAG_DRV6_CORR_MIDRATIO_ORI"),
    [tomlData],
  );
  const midratioValue = useMemo(
    () => readTomlValue(tomlData, "AE_TAG_DRV6_MIDRATIO"),
    [tomlData],
  );
  const b2dValue = useMemo(
    () => readTomlValue(tomlData, "AE_TAG_DRV6_B2D"),
    [tomlData],
  );
  const b2mValue = useMemo(
    () => readTomlValue(tomlData, HS_MIDDLE_B2M_KEY),
    [tomlData],
  );
  const evdValue = useMemo(
    () => readTomlValue(tomlData, HS_BRIGHT_EVD_KEY),
    [tomlData],
  );
  const mainTCardOrder = useMemo(
    () => sanitiseMainTMetricOrder(visual.chart_main_t_card_order),
    [visual.chart_main_t_card_order],
  );
  const mainTCardCollapsedIds = useMemo(
    () => sanitiseMainTMetricCollapsed(visual.chart_main_t_card_collapsed),
    [visual.chart_main_t_card_collapsed],
  );
  const hsCardOrder = useMemo(
    () => sanitiseHsMetricOrder(visual.chart_hs_card_order),
    [visual.chart_hs_card_order],
  );
  const hsCardCollapsedIds = useMemo(
    () => sanitiseHsMetricCollapsed(visual.chart_hs_card_collapsed),
    [visual.chart_hs_card_collapsed],
  );
  const visibleMainTCardOrder = useMemo(
    () => mainTCardOrder.filter((cardId) =>
      cardId === "mainTarget" ||
      (cardId === "mainThd" && mainTargetThreshold) ||
      (cardId === "mtwv" && mainTargetMtwv),
    ),
    [mainTCardOrder, mainTargetMtwv, mainTargetThreshold],
  );
  const persistMainTMidChartState = useCallback((state: {
    mode: MidChartMode;
    source: MidChartSource;
    readoutMode: "value" | "percent";
  }) => {
    patchVis({
      chart_main_t_mid_chart_mode: state.mode,
      chart_main_t_mid_chart_source: state.source,
      chart_main_t_mid_readout_mode: state.readoutMode,
    });
  }, [patchVis]);

  useEffect(() => {
    let cancelled = false;
    const spec = schema.card_source?.[sourceKey];
    if (!filePath) {
      setSections([]);
      setMainTargetThreshold(null);
      setMainTargetMtwv(null);
      setMainTargetMidCurve(null);
      setMainTargetB2dCurve(null);
      setMainTargetB2dCorrCurve(null);
      setHsWeightSource(null);
      setHsBrightAreaSource(null);
      setHsMiddleAreaSource(null);
      setHsDarkAreaSource(null);
      setHsSourceIdentity(null);
      setMainThdValue(NaN);
      setMessage("请先导入 AE.cpp 参数文件");
      return;
    }
    if (!spec) {
      setSections([]);
      setMainTargetThreshold(null);
      setMainTargetMtwv(null);
      setMainTargetMidCurve(null);
      setMainTargetB2dCurve(null);
      setMainTargetB2dCorrCurve(null);
      if (tab === "HS") {
        setHsWeightSource(null);
        setHsBrightAreaSource(null);
        setHsMiddleAreaSource(null);
        setHsDarkAreaSource(null);
        setHsSourceIdentity(null);
      }
      setMessage(`[card_source.${sourceKey}] 未配置`);
      return;
    }

    setLoading(true);
    setMessage(null);
    (async () => {
      let threshold: MainTargetThresholdRow[] | null = null;
      let mtwv: MtwvSource | null = null;
      let midCurve: MidCurveSource | null = null;
      let b2dCurve: B2dCurveSource | null = null;
      let b2dCorrCurve: B2dCorrCurveSource | null = null;
      let hsWeight: HsWeightSource | null = null;
      let hsBrightArea: HsAreaSource | null = null;
      let hsMiddleArea: HsAreaSource | null = null;
      let hsDarkArea: HsAreaSource | null = null;
      if (tab === "MainT") {
        [threshold, midCurve, b2dCurve, b2dCorrCurve, mtwv] = await Promise.all([
          loadMainTargetThreshold(filePath),
          loadMainTargetMidCurve(filePath),
          loadMainTargetB2dCurve(filePath),
          loadMainTargetB2dCorrCurve(filePath),
          loadMtwvWeightTable(filePath),
        ]);
      }
      if (tab === "HS") {
        [hsWeight, hsBrightArea, hsMiddleArea, hsDarkArea] = await Promise.all([
          loadHsWeightSource(filePath),
          loadHsBrightAreaSource(filePath),
          loadHsMiddleAreaSource(filePath),
          loadHsDarkAreaSource(filePath),
        ]);
      }
      const hit = await cppResolveCardSource(filePath, spec);
      const fields: FieldEntry[] = [];
      for (const [start, end] of hit.ranges) {
        const chunk = await cppGetFieldsInRange(filePath, start, end);
        fields.push(...chunk);
      }
      const excludedPaths = tab === "MainT" ? [...MAIN_TARGET_THRESHOLD_PATHS, MTWV_WEIGHT_TABLE_PATH] : [];
      const nextSections = tab === "MainT" ? [] : buildSections(tab, hit.ranges, dedupeFields(fields), excludedPaths);
      if (!cancelled) {
        setSections(nextSections);
        setMainTargetThreshold(threshold);
        setMainTargetMtwv(mtwv);
        setMainTargetMidCurve(midCurve);
        setMainTargetB2dCurve(b2dCurve);
        setMainTargetB2dCorrCurve(b2dCorrCurve);
        if (tab === "HS") {
          setHsWeightSource(hsWeight);
          setHsBrightAreaSource(hsBrightArea);
          setHsMiddleAreaSource(hsMiddleArea);
          setHsDarkAreaSource(hsDarkArea);
          setHsSourceIdentity(sourceIdentity);
        }
        setMessage(nextSections.length === 0 && !threshold && tab !== "HS" ? "当前源码范围内没有可展示字段" : null);
        setLoading(false);
      }
    })().catch((err) => {
      if (!cancelled) {
        setSections([]);
        setMainTargetThreshold(null);
        setMainTargetMtwv(null);
        setMainTargetMidCurve(null);
        setMainTargetB2dCurve(null);
        setMainTargetB2dCorrCurve(null);
        if (tab === "HS") {
          setHsWeightSource(null);
          setHsBrightAreaSource(null);
          setHsMiddleAreaSource(null);
          setHsDarkAreaSource(null);
          setHsSourceIdentity(null);
        }
        setMainThdValue(NaN);
        setMessage(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, schema, sourceIdentity, sourceKey, sourceRevision, tab]);

  const setMainTCardExpanded = (cardId: MainTMetricCardId, expanded: boolean) => {
    const collapsed = new Set(mainTCardCollapsedIds);
    if (expanded) {
      collapsed.delete(cardId);
    } else {
      collapsed.add(cardId);
    }
    patchVis({ chart_main_t_card_collapsed: MAIN_T_METRIC_CARD_ORDER.filter((id) => collapsed.has(id)) });
  };

  const onMainTCardDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = mainTCardOrder.indexOf(String(active.id) as MainTMetricCardId);
    const newIndex = mainTCardOrder.indexOf(String(over.id) as MainTMetricCardId);
    if (oldIndex < 0 || newIndex < 0) return;
    patchVis({ chart_main_t_card_order: arrayMove(mainTCardOrder, oldIndex, newIndex) });
  };

  const setHsCardExpanded = (cardId: HsMetricCardId, expanded: boolean) => {
    const collapsed = new Set(hsCardCollapsedIds);
    if (expanded) {
      collapsed.delete(cardId);
    } else {
      collapsed.add(cardId);
    }
    patchVis({ chart_hs_card_collapsed: HS_METRIC_CARD_ORDER.filter((id) => collapsed.has(id)) });
  };

  useEffect(() => {
    const targetCardId = hsMetricCardIdForFocusLabel(focusTarget?.label);
    if (!targetCardId) return;
    setTab("HS");
    setHsCardExpanded(targetCardId, true);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(hsMetricCardDomId(targetCardId))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusTarget]);

  const jumpToHsAreaCard = (sourceId: string) => {
    const targetCardId = HS_TARGET_AREA_CARD_BY_ID[sourceId];
    if (!targetCardId) return;
    setHsCardExpanded(targetCardId, true);
    window.requestAnimationFrame(() => {
      document.getElementById(hsMetricCardDomId(targetCardId))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const onHsCardDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = hsCardOrder.indexOf(String(active.id) as HsMetricCardId);
    const newIndex = hsCardOrder.indexOf(String(over.id) as HsMetricCardId);
    if (oldIndex < 0 || newIndex < 0) return;
    patchVis({ chart_hs_card_order: arrayMove(hsCardOrder, oldIndex, newIndex) });
  };

  const renderMainTMetricCard = (cardId: MainTMetricCardId) => {
    const sortableWrapper = (children: ReactNode) => (
      <SortableMetricCard key={cardId} id={cardId} disabled={!mainTCardCollapsedIds.includes(cardId)}>
        {children}
      </SortableMetricCard>
    );

    if (cardId === "mainThd" && mainTargetThreshold) {
      return sortableWrapper(
          <MainTargetThresholdCard
            filePath={filePath}
            rows={mainTargetThreshold}
            imageBvValue={imageBvValue}
            imageMidratioValue={imageMidratioValue}
            corrDrMidratioValue={corrDrMidratioValue}
            midratioOriValue={midratioOriValue}
            midratioValue={midratioValue}
            b2dValue={b2dValue}
            midCurve={mainTargetMidCurve}
            b2dCurve={mainTargetB2dCurve}
            b2dCorrCurve={mainTargetB2dCorrCurve}
            sourceSpec={schema.card_source?.Main_Target_Threshold ?? MAIN_TARGET_THRESHOLD_SOURCE_SPEC}
            focusTarget={focusTarget}
            sourceDraftText={sourceDraftText}
            onSourceDraftTextChange={onSourceDraftTextChange}
            onSourceJump={onSourceJump}
            onMainThdValueChange={setMainThdValue}
            initialExpanded={!mainTCardCollapsedIds.includes(cardId)}
            onExpandedChange={(expanded) => setMainTCardExpanded(cardId, expanded)}
            initialMidChartMode={coerceMidChartMode(visual.chart_main_t_mid_chart_mode)}
            initialMidChartSource={coerceMidChartSource(visual.chart_main_t_mid_chart_source)}
            initialMidReadoutMode={coerceMidReadoutMode(visual.chart_main_t_mid_readout_mode)}
            onMidChartStateChange={persistMainTMidChartState}
          />,
      );
    }

    if (cardId === "mtwv" && mainTargetMtwv) {
      return sortableWrapper(
          <MtwvCard
            filePath={filePath}
            source={mainTargetMtwv}
            mtwvValue={imageMtwvValue}
            sourceSpec={schema.card_source?.MTWV ?? MTWV_SOURCE_SPEC}
            focusTarget={focusTarget}
            sourceDraftText={sourceDraftText}
            onSourceDraftTextChange={onSourceDraftTextChange}
            onSourceJump={onSourceJump}
            initialExpanded={!mainTCardCollapsedIds.includes(cardId)}
            onExpandedChange={(expanded) => setMainTCardExpanded(cardId, expanded)}
          />,
      );
    }

    if (cardId === "mainTarget") {
      return sortableWrapper(
          <MainTargetCard
            cwvValue={imageCwvValue}
            mainThdValue={mainThdValue}
            mtwvValue={imageMtwvValue}
            initialExpanded={!mainTCardCollapsedIds.includes(cardId)}
            onExpandedChange={(expanded) => setMainTCardExpanded(cardId, expanded)}
          />,
      );
    }

    return null;
  };

  const renderHsMetricCard = (cardId: HsMetricCardId) => {
    const collapsed = hsCardCollapsedIds.includes(cardId);
    const sortableWrapper = (children: ReactNode) => (
      <SortableMetricCard key={cardId} id={cardId} disabled={!collapsed}>
        {children}
      </SortableMetricCard>
    );

    if (cardId === "hsTarget") {
      return sortableWrapper(
        <HsTargetCard
          cwvValue={hsCwvValue}
          inputs={hsTargetInputs}
          onAreaJump={jumpToHsAreaCard}
          initialExpanded={!collapsed}
          onExpandedChange={(expanded) => setHsCardExpanded(cardId, expanded)}
        />,
      );
    }
    if (cardId === "hsWeight") {
      return sortableWrapper(
        <HsWeightCard
          domId={hsMetricCardDomId(cardId)}
          source={currentHsWeightSource}
          bvValue={imageBvValue}
          b2dValue={b2dValue}
          midValue={midratioValue}
          wetValues={hsWeightWetValues}
          sourceDraftText={sourceDraftText}
          onSourceDraftTextChange={onSourceDraftTextChange}
          onSourceJump={onSourceJump}
          initialExpanded={!collapsed}
          onExpandedChange={(expanded) => setHsCardExpanded(cardId, expanded)}
        />,
      );
    }
    if (cardId === "hsBright") {
      const brightInput = hsTargetInputs.find((input) => input.id === "BT");
      return sortableWrapper(
        <HsAreaCard
          domId={hsMetricCardDomId(cardId)}
          title="HS Bright Area"
          source={currentHsBrightAreaSource}
          bvValue={imageBvValue}
          axisValue={evdValue}
          axisLabel="EVD"
          thdLabel="BT_THD"
          thdValue={brightInput?.thd ?? null}
          cornerLabel="BV/EVD"
          sourceJumpLabel="HS.Bright Area"
          sourcePaths={[...HS_BRIGHT_AREA_SOURCE_PATHS]}
          sourceDraftText={sourceDraftText}
          onSourceDraftTextChange={onSourceDraftTextChange}
          onSourceJump={onSourceJump}
          initialExpanded={!collapsed}
          onExpandedChange={(expanded) => setHsCardExpanded(cardId, expanded)}
        />,
      );
    }
    if (cardId === "hsMiddle") {
      const middleInput = hsTargetInputs.find((input) => input.id === "MT");
      return sortableWrapper(
        <HsAreaCard
          domId={hsMetricCardDomId(cardId)}
          title="HS Middle Area"
          source={currentHsMiddleAreaSource}
          bvValue={imageBvValue}
          axisValue={b2mValue}
          axisLabel="B2M"
          thdLabel="MT_THD"
          thdValue={middleInput?.thd ?? null}
          cornerLabel="BV/B2M"
          sourceJumpLabel="HS.Middle Area"
          sourcePaths={[...HS_MIDDLE_AREA_SOURCE_PATHS]}
          sourceDraftText={sourceDraftText}
          onSourceDraftTextChange={onSourceDraftTextChange}
          onSourceJump={onSourceJump}
          initialExpanded={!collapsed}
          onExpandedChange={(expanded) => setHsCardExpanded(cardId, expanded)}
        />,
      );
    }
    if (cardId === "hsDark") {
      const darkInput = hsTargetInputs.find((input) => input.id === "DT");
      return sortableWrapper(
        <HsAreaCard
          domId={hsMetricCardDomId(cardId)}
          title="HS Dark Area"
          source={currentHsDarkAreaSource}
          bvValue={imageBvValue}
          axisValue={b2dValue}
          axisLabel="B2D"
          thdLabel="DT_THD"
          thdValue={darkInput?.thd ?? null}
          cornerLabel="BV/B2D"
          sourceJumpLabel="HS.Dark Area"
          sourcePaths={[...HS_DARK_AREA_SOURCE_PATHS]}
          sourceDraftText={sourceDraftText}
          onSourceDraftTextChange={onSourceDraftTextChange}
          onSourceJump={onSourceJump}
          initialExpanded={!collapsed}
          onExpandedChange={(expanded) => setHsCardExpanded(cardId, expanded)}
        />,
      );
    }
    return null;
  };

  return (
    <div className="flex h-full w-full flex-col" style={canvasStyle}>
      <style>
        {".chart-map-scrollbar-hidden::-webkit-scrollbar{display:none;}"}
      </style>
      <div className="shrink-0 overflow-x-auto px-3 pt-3" style={tabStripWrapStyle}>
        <div className="flex min-w-max items-end gap-0.5">
          {CHART_TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              style={tabButtonStyle(item === tab)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-map-scrollbar-hidden min-h-0 flex-1 overflow-auto px-3 pb-3 pt-2" style={hiddenScrollbarStyle}>
        <div style={innerCanvasStyle}>
          {loading && (
            <div className="mb-2 text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
              loading...
            </div>
          )}

          {tab === "MainT" && (
            <DndContext
              sensors={mainTCardSensors}
              collisionDetection={closestCenter}
              onDragEnd={onMainTCardDragEnd}
            >
              <SortableContext items={visibleMainTCardOrder} strategy={verticalListSortingStrategy}>
                {visibleMainTCardOrder.map(renderMainTMetricCard)}
              </SortableContext>
            </DndContext>
          )}

          {tab === "HS" && (
            <DndContext
              sensors={mainTCardSensors}
              collisionDetection={closestCenter}
              onDragEnd={onHsCardDragEnd}
            >
              <SortableContext items={hsCardOrder} strategy={verticalListSortingStrategy}>
                {hsCardOrder.map(renderHsMetricCard)}
              </SortableContext>
            </DndContext>
          )}

          {tab !== "HS" && sections.map((section) => (
            <section key={section.id} style={sourceSectionStyle}>
              <div style={sourceSectionHeaderStyle}>
                <span style={sourceSectionTitleStyle}>{section.title}</span>
                {section.subtitle && <span style={sourceSectionSubtitleStyle}>{section.subtitle}</span>}
              </div>
              <div className="flex flex-col gap-2">
                {section.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    title={`跳转到源码：${row.path} · L${row.line}`}
                    aria-label={`跳转到源码：${row.path} · L${row.line}`}
                    onClick={() => {
                      if (!onSourceJump || row.line <= 0) return;
                      onSourceJump(`${section.title}.${row.label}`, {
                        line_ranges: [[row.line, row.line]],
                        jump_to: "first",
                        highlight: "ranges",
                      });
                    }}
                    style={sourceRowButtonStyle(Boolean(onSourceJump && row.line > 0))}
                  >
                    <div style={labelStyle} title={`${row.path} · L${row.line}`}>
                      {row.label}
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2">
                      {row.values.map((value, idx) => (
                        <span
                          key={`${row.id}:${idx}`}
                          title={`${row.path} · L${row.line}`}
                          style={valueBoxStyle}
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}

          {!loading && message && (
            <div className="rounded-md border px-3 py-2 text-xs"
                 style={{
                   borderColor: "var(--colorNeutralStroke2)",
                   color: "var(--colorNeutralForeground3)",
                   background: "var(--colorNeutralBackground2)",
                 }}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

async function loadMainTargetThreshold(
  filePath: string,
  rowsConfig: Array<{ label: MainTargetThresholdRow["label"]; path: string }> = MAIN_TARGET_THRESHOLD_ROWS,
): Promise<MainTargetThresholdRow[]> {
  const rows: MainTargetThresholdRow[] = [];
  for (const row of rowsConfig) {
    const fields = await loadFieldEntriesAtPath(filePath, row.path);
    rows.push({
      label: row.label,
      path: row.path,
      values: fields.length > 0 ? fields.map((field) => field.value) : ["-"],
      fields,
    });
  }
  return rows;
}

async function loadMtwvWeightTable(
  filePath: string,
  path: string = MTWV_WEIGHT_TABLE_PATH,
): Promise<MtwvSource> {
  const fields = await loadFieldEntriesAtPath(filePath, path);
  return {
    path,
    rows: buildMtwvRows(path, fields),
  };
}

async function loadHsWeightSource(filePath: string): Promise<HsWeightSource> {
  const [bvFields, drFields, midFields, valueFields] = await Promise.all([
    loadFieldEntriesAtPath(filePath, HS_WEIGHT_BV_PATH),
    loadFieldEntriesAtPath(filePath, HS_WEIGHT_DR_B2D_PATH),
    loadFieldEntriesAtPath(filePath, HS_WEIGHT_MID_PATH),
    loadFieldEntriesAtPath(filePath, HS_WEIGHT_VALUE_PATH),
  ]);
  const bvAxisFields = numericFieldEntries(bvFields);
  const midAxisFields = numericFieldEntries(midFields);
  const bvAxis = bvAxisFields.map((field) => parseFiniteNumber(field.value));
  const midAxis = midAxisFields.map((field) => parseFiniteNumber(field.value));
  const bvCount = Math.max(1, bvAxis.length);
  const midCount = Math.max(1, midAxis.length);
  const matrix = buildHsWeightValues(valueFields, bvCount, midCount);
  const drB2d = buildHsDrB2dRows(drFields, matrix.values);

  return {
    bvPath: HS_WEIGHT_BV_PATH,
    drB2dPath: HS_WEIGHT_DR_B2D_PATH,
    midPath: HS_WEIGHT_MID_PATH,
    matrixPath: HS_WEIGHT_VALUE_PATH,
    bvAxis,
    bvAxisFields,
    drB2dRows: drB2d.rows,
    drB2dFields: drB2d.fields,
    midAxis,
    midAxisFields,
    values: matrix.values,
    valueFields: matrix.fields,
    fields: [...bvFields, ...drFields, ...midFields, ...valueFields].sort(compareFieldEntries),
  };
}

async function loadHsBrightAreaSource(filePath: string): Promise<HsAreaSource> {
  return loadHsAreaSource(filePath, HS_BRIGHT_AREA_SOURCE_CONFIG);
}

async function loadHsMiddleAreaSource(filePath: string): Promise<HsAreaSource> {
  return loadHsAreaSource(filePath, HS_MIDDLE_AREA_SOURCE_CONFIG);
}

async function loadHsDarkAreaSource(filePath: string): Promise<HsAreaSource> {
  return loadHsAreaSource(filePath, HS_DARK_AREA_SOURCE_CONFIG);
}

async function loadHsAreaSource(filePath: string, config: HsAreaSourceConfig): Promise<HsAreaSource> {
  const [rowHeaderFields, columnHeaderFields, valueFields, rowCountFields, columnCountFields] = await Promise.all([
    loadFieldEntriesAtPath(filePath, config.rowHeaderPath),
    loadFieldEntriesAtPath(filePath, config.columnHeaderPath),
    loadFieldEntriesAtPath(filePath, config.valuePath),
    loadFieldEntriesAtPath(filePath, config.rowCountPath),
    loadFieldEntriesAtPath(filePath, config.columnCountPath),
  ]);
  const numericRowHeaderFields = numericFieldEntries(rowHeaderFields);
  const numericColumnHeaderFields = numericFieldEntries(columnHeaderFields);
  const numericValueFields = numericFieldEntries(valueFields);
  const specifiedRowCount = positiveIntegerFieldValue(rowCountFields);
  const specifiedColumnCount = positiveIntegerFieldValue(columnCountFields);
  const inferredShape = inferHsAreaMatrixShape(numericValueFields, config.valuePath);
  const rowCount = specifiedRowCount
    ?? positiveLength(numericRowHeaderFields.length)
    ?? inferredShape.rowCount
    ?? (specifiedColumnCount ? positiveLength(Math.ceil(numericValueFields.length / specifiedColumnCount)) : null)
    ?? 1;
  const columnCount = specifiedColumnCount
    ?? positiveLength(numericColumnHeaderFields.length)
    ?? inferredShape.columnCount
    ?? positiveLength(Math.ceil(numericValueFields.length / rowCount))
    ?? 1;
  const rowAxis = buildHsAreaAxis(numericRowHeaderFields, rowCount);
  const columnAxis = buildHsAreaAxis(numericColumnHeaderFields, columnCount);
  const matrix = buildHsAreaMatrix(numericValueFields, rowCount, columnCount, config.valuePath);

  return {
    rowHeaderPath: config.rowHeaderPath,
    columnHeaderPath: config.columnHeaderPath,
    valuePath: config.valuePath,
    rowCountPath: config.rowCountPath,
    columnCountPath: config.columnCountPath,
    rowCount,
    columnCount,
    rowHeaders: rowAxis.values,
    rowHeaderFields: rowAxis.fields,
    columnHeaders: columnAxis.values,
    columnHeaderFields: columnAxis.fields,
    values: matrix.values,
    valueFields: matrix.fields,
    fields: [...rowHeaderFields, ...columnHeaderFields, ...valueFields, ...rowCountFields, ...columnCountFields]
      .sort(compareFieldEntries),
  };
}

async function loadMainTargetMidCurve(
  filePath: string,
  paths: { x1: string; y1: string; x2: string; y2: string } = MID_CURVE_PATHS,
): Promise<MidCurveSource> {
  const [x1, y1, x2, y2] = await Promise.all(
    [paths.x1, paths.y1, paths.x2, paths.y2].map((path) => loadFieldValuesAtPath(filePath, path, [])),
  );
  return { x1, y1, x2, y2 };
}

async function loadMainTargetB2dCurve(
  filePath: string,
  paths: { x: string; y: string } = B2D_CURVE_PATHS,
): Promise<B2dCurveSource> {
  const [x, y] = await Promise.all(
    [paths.x, paths.y].map((path) => loadFieldValuesAtPath(filePath, path, [])),
  );
  return { x, y };
}

async function loadMainTargetB2dCorrCurve(
  filePath: string,
  paths: { value: string; x1: string; y1: string; x2: string; y2: string } = B2D_CORR_CURVE_PATHS,
): Promise<B2dCorrCurveSource> {
  const [value, x1, y1, x2, y2] = await Promise.all(
    [paths.value, paths.x1, paths.y1, paths.x2, paths.y2].map((path) => loadFieldValuesAtPath(filePath, path, [])),
  );
  return { value, x1, y1, x2, y2 };
}

async function loadFieldEntriesAtPath(filePath: string, path: string): Promise<FieldEntry[]> {
  let fields: FieldEntry[] = [];
  try {
    fields = await cppGetFieldsAtPath(filePath, path);
  } catch {
    fields = [];
  }
  return fields
    .filter((field) => isPathUnder(field.path, path))
    .sort((a, b) => a.index - b.index || a.path.localeCompare(b.path));
}

async function loadFieldValuesAtPath(filePath: string, path: string, fallback: string[]): Promise<string[]> {
  const fields = await loadFieldEntriesAtPath(filePath, path);
  return fields.length > 0 ? fields.map((field) => field.value) : fallback;
}

function coerceTab(value: string | undefined): ChartTabId | null {
  return CHART_TABS.includes(value as ChartTabId) ? (value as ChartTabId) : null;
}

function sanitiseMainTMetricOrder(order: string[] | undefined): MainTMetricCardId[] {
  const known = new Set<MainTMetricCardId>(MAIN_T_METRIC_CARD_ORDER);
  const cleaned = (order ?? [])
    .filter((id): id is MainTMetricCardId => known.has(id as MainTMetricCardId));
  for (const id of MAIN_T_METRIC_CARD_ORDER) {
    if (!cleaned.includes(id)) cleaned.push(id);
  }
  return cleaned;
}

function sanitiseMainTMetricCollapsed(collapsed: string[] | undefined): MainTMetricCardId[] {
  const known = new Set<MainTMetricCardId>(MAIN_T_METRIC_CARD_ORDER);
  return (collapsed ?? [])
    .filter((id): id is MainTMetricCardId => known.has(id as MainTMetricCardId));
}

function sanitiseHsMetricOrder(order: string[] | undefined): HsMetricCardId[] {
  const known = new Set<HsMetricCardId>(HS_METRIC_CARD_ORDER);
  const cleaned = (order ?? [])
    .filter((id): id is HsMetricCardId => known.has(id as HsMetricCardId));
  for (const id of HS_METRIC_CARD_ORDER) {
    if (!cleaned.includes(id)) cleaned.push(id);
  }
  return cleaned;
}

function sanitiseHsMetricCollapsed(collapsed: string[] | undefined): HsMetricCardId[] {
  const known = new Set<HsMetricCardId>(HS_METRIC_CARD_ORDER);
  return (collapsed ?? [])
    .filter((id): id is HsMetricCardId => known.has(id as HsMetricCardId));
}

function hsMetricCardDomId(cardId: HsMetricCardId): string {
  return `chart-hs-card-${cardId}`;
}

function hsMetricCardIdForFocusLabel(label: string | undefined | null): HsMetricCardId | null {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "hs.weight" || normalized.startsWith("hs.weight.")) return "hsWeight";
  if (normalized === "hs.dark area" || normalized.startsWith("hs.dark area.")) return "hsDark";
  if (normalized === "hs.middle area" || normalized.startsWith("hs.middle area.")) return "hsMiddle";
  if (normalized === "hs.bright area" || normalized.startsWith("hs.bright area.")) return "hsBright";
  return null;
}

function coerceMidChartMode(value: string | undefined): MidChartMode {
  return value === "corr_mid" || value === "b2d_ori" || value === "b2d_corr" ? value : "thd";
}

function coerceMidChartSource(value: string | undefined): MidChartSource {
  return value === "mid_value" || value === "corr_dr_midratio" || value === "dr_midratio_ori" || value === "b2d"
    ? value
    : "mid";
}

function coerceMidReadoutMode(value: string | undefined): "value" | "percent" {
  return value === "percent" ? "percent" : "value";
}

function dedupeFields(fields: FieldEntry[]): FieldEntry[] {
  const seen = new Set<string>();
  const out: FieldEntry[] = [];
  for (const field of fields) {
    const key = `${field.path}|${field.line}|${field.index}|${field.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(field);
  }
  return out.sort((a, b) => a.line - b.line || a.index - b.index || a.path.localeCompare(b.path));
}

function buildSections(
  tab: ChartTabId,
  ranges: Array<[number, number]>,
  fields: FieldEntry[],
  excludePathPrefixes: string[] = [],
): ChartSection[] {
  const visibleFields = fields.filter((field) =>
    !excludePathPrefixes.some((prefix) => isPathUnder(field.path, prefix)),
  );
  if (visibleFields.length === 0) return [];
  if (tab === "MainT") {
    const mainTSections = buildGroupedMainTSections(visibleFields);
    if (mainTSections.length > 0) return mainTSections;
  }

  const sections: ChartSection[] = [];
  for (const [rangeIdx, [start, end]] of ranges.entries()) {
    const inRange = visibleFields.filter((field) => field.line >= start && field.line <= end);
    if (inRange.length === 0) continue;
    const rows = groupRows(inRange);
    sections.push({
      id: `${tab}:${start}-${end}:${rangeIdx}`,
      title: ranges.length === 1
        ? `${tab} 源码段`
        : `${tab} 源码段 ${rangeIdx + 1}`,
      subtitle: `L${start}-L${end}`,
      rows,
    });
  }
  return sections;
}

function buildGroupedMainTSections(fields: FieldEntry[]): ChartSection[] {
  const sections: ChartSection[] = [];
  const consumed = new Set<FieldEntry>();

  for (const group of MAIN_T_SOURCE_GROUPS) {
    const groupFields = fields.filter((field) =>
      group.paths.some((prefix) => isPathUnder(field.path, prefix)),
    );
    if (groupFields.length === 0) continue;
    groupFields.forEach((field) => consumed.add(field));
    const lineRange = fieldLineRange(groupFields);
    sections.push({
      id: `MainT:${group.id}`,
      title: `${group.title}源码段`,
      subtitle: lineRange,
      rows: groupRows(groupFields),
    });
  }

  const otherFields = fields.filter((field) => !consumed.has(field));
  if (otherFields.length > 0) {
    sections.push({
      id: "MainT:other",
      title: "MainT 其他源码段",
      subtitle: fieldLineRange(otherFields),
      rows: groupRows(otherFields),
    });
  }
  return sections;
}

function fieldLineRange(fields: FieldEntry[]): string {
  const lines = fields.map((field) => field.line).filter((line) => line > 0);
  if (lines.length === 0) return "";
  const minLine = Math.min(...lines);
  const maxLine = Math.max(...lines);
  return minLine === maxLine ? `L${minLine}` : `L${minLine}-L${maxLine}`;
}

function SortableMetricCard({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        ...metricCardDragWrapStyle(!disabled, isDragging),
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...(!disabled ? { ...attributes, ...listeners } : {})}
    >
      {children}
    </div>
  );
}

function MainTargetThresholdCard({
  filePath,
  rows,
  imageBvValue,
  imageMidratioValue,
  corrDrMidratioValue,
  midratioOriValue,
  midratioValue,
  b2dValue,
  midCurve,
  b2dCurve,
  b2dCorrCurve,
  sourceSpec,
  focusTarget,
  sourceDraftText,
  onSourceDraftTextChange,
  onSourceJump,
  onMainThdValueChange,
  initialExpanded,
  onExpandedChange,
  initialMidChartMode,
  initialMidChartSource,
  initialMidReadoutMode,
  onMidChartStateChange,
}: {
  filePath: string;
  rows: MainTargetThresholdRow[];
  imageBvValue: string | null;
  imageMidratioValue: string | null;
  corrDrMidratioValue: string | null;
  midratioOriValue: string | null;
  midratioValue: string | null;
  b2dValue: string | null;
  midCurve: MidCurveSource | null;
  b2dCurve: B2dCurveSource | null;
  b2dCorrCurve: B2dCorrCurveSource | null;
  sourceSpec: CardSourceSpec;
  focusTarget?: ChartFocusTarget | null;
  sourceDraftText?: string | null;
  onSourceDraftTextChange?: (text: string) => void;
  onSourceJump?: (label: string, spec: CardSourceSpec) => void;
  onMainThdValueChange?: (value: number) => void;
  initialExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  initialMidChartMode?: MidChartMode;
  initialMidChartSource?: MidChartSource;
  initialMidReadoutMode?: "value" | "percent";
  onMidChartStateChange?: (state: {
    mode: MidChartMode;
    source: MidChartSource;
    readoutMode: "value" | "percent";
  }) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded ?? true);
  const [editableRows, setEditableRows] = useState(rows);
  const [editableMidCurve, setEditableMidCurve] = useState<MidCurveSource | null>(midCurve);
  const [editableB2dCurve, setEditableB2dCurve] = useState<B2dCurveSource | null>(b2dCurve);
  const [editableB2dCorrCurve, setEditableB2dCorrCurve] = useState<B2dCorrCurveSource | null>(b2dCorrCurve);
  const [bindingPanel, setBindingPanel] = useState<BindingPanelKind | null>(null);
  const [bvBindingPaths, setBvBindingPaths] = useState<Record<MainTargetThresholdRow["label"], string>>({
    BV: MAIN_TARGET_THRESHOLD_PATHS[0],
    Base: MAIN_TARGET_THRESHOLD_PATHS[1],
    Exp: MAIN_TARGET_THRESHOLD_PATHS[2],
  });
  const [midBindingPaths, setMidBindingPaths] = useState({
    midX1: MID_CURVE_PATHS.x1,
    midY1: MID_CURVE_PATHS.y1,
    midX2: MID_CURVE_PATHS.x2,
    midY2: MID_CURVE_PATHS.y2,
    b2dX: B2D_CURVE_PATHS.x,
    b2dY: B2D_CURVE_PATHS.y,
    corrValue: B2D_CORR_CURVE_PATHS.value,
    corrX1: B2D_CORR_CURVE_PATHS.x1,
    corrY1: B2D_CORR_CURVE_PATHS.y1,
    corrX2: B2D_CORR_CURVE_PATHS.x2,
    corrY2: B2D_CORR_CURVE_PATHS.y2,
  } as Record<"midX1" | "midY1" | "midX2" | "midY2" | "b2dX" | "b2dY" | "corrValue" | "corrX1" | "corrY1" | "corrX2" | "corrY2", string>);
  const [bindingLoading, setBindingLoading] = useState(false);
  const [bindingMessage, setBindingMessage] = useState<string | null>(null);
  const bvSectionRef = useRef<HTMLElement | null>(null);
  const midSectionRef = useRef<HTMLElement | null>(null);
  const sourceDraftTextRef = useRef(sourceDraftText ?? "");
  const bv = editableRows.find((row) => row.label === "BV");
  const base = editableRows.find((row) => row.label === "Base");
  const exp = editableRows.find((row) => row.label === "Exp");
  const orderedRows = [bv, base, exp].filter((row): row is MainTargetThresholdRow => Boolean(row));
  const defaultBv = firstNumericString(bv?.values);
  const initialBv = imageBvValue ?? defaultBv ?? "";
  const [bvInput, setBvInput] = useState(initialBv);
  const [midReadoutMode, setMidReadoutMode] = useState<"value" | "percent">(initialMidReadoutMode ?? "value");
  const [midChartMode, setMidChartMode] = useState<MidChartMode>(initialMidChartMode ?? "thd");
  const [midChartSource, setMidChartSource] = useState<MidChartSource>(initialMidChartSource ?? "mid");
  const [midChartResetKey, setMidChartResetKey] = useState(0);

  useEffect(() => {
    setEditableRows(rows);
  }, [rows]);

  useEffect(() => {
    setEditableMidCurve(midCurve);
  }, [midCurve]);

  useEffect(() => {
    setEditableB2dCurve(b2dCurve);
  }, [b2dCurve]);

  useEffect(() => {
    setEditableB2dCorrCurve(b2dCorrCurve);
  }, [b2dCorrCurve]);

  useEffect(() => {
    sourceDraftTextRef.current = sourceDraftText ?? "";
  }, [sourceDraftText]);

  useEffect(() => {
    onMidChartStateChange?.({
      mode: midChartMode,
      source: midChartSource,
      readoutMode: midReadoutMode,
    });
  }, [midChartMode, midChartSource, midReadoutMode, onMidChartStateChange]);

  useEffect(() => {
    setBvInput(initialBv);
  }, [initialBv]);

  useEffect(() => {
    if (!focusTarget?.label.startsWith("Main_Target_Threshold")) return;
    if (!expanded) {
      setExpanded(true);
      onExpandedChange?.(true);
      return;
    }
    const target = focusTarget.label.endsWith(".mid")
      ? midSectionRef.current
      : focusTarget.label.endsWith(".bv")
        ? bvSectionRef.current
        : null;
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, focusTarget]);

  const bvNumber = parseFiniteNumber(bvInput);
  const baseValue = interpolateTableValue(bvNumber, bv?.values, base?.values);
  const expValue = interpolateTableValue(bvNumber, bv?.values, exp?.values);
  const interpolationColumns = interpolationColumnIndexes(bvNumber, bv?.values);
  const thdMaxValue = Number.isFinite(baseValue) && Number.isFinite(expValue)
    ? baseValue * 2 ** (expValue / 1000)
    : NaN;
  const midCurvePoints = useMemo(() => buildMidCurvePoints(editableMidCurve), [editableMidCurve]);
  const segmentedMidPoints = useMemo(() => buildSegmentedMidPoints(midCurvePoints), [midCurvePoints]);
  const midValue = parseFiniteNumber(imageMidratioValue);
  const corrDrMidratio = parseFiniteNumber(corrDrMidratioValue);
  const midratioOri = parseFiniteNumber(midratioOriValue);
  const midratio = parseFiniteNumber(midratioValue);
  const b2d = parseFiniteNumber(b2dValue);
  const midFunctionValue = midValueAtCorr(corrDrMidratio, segmentedMidPoints, midValue);
  const effectiveMidValue = Number.isFinite(midFunctionValue) ? midFunctionValue : midValue;
  const targetValue = computeSegmentedThd(corrDrMidratio, baseValue, expValue, thdMaxValue, segmentedMidPoints, midValue);
  const mainThdValueText = formatThresholdNumber(targetValue);
  const mainThdLowerText = formatThresholdNumber(baseValue);
  const mainThdUpperText = formatThresholdNumber(thdMaxValue);
  const mainThdLowerActive = mainThdLowerText !== "-" && mainThdLowerText === mainThdValueText;
  const mainThdUpperActive = mainThdUpperText !== "-" && mainThdUpperText === mainThdValueText;
  const mainThdFormulaPrefix = `Main THD = Base(bv:${formatComputedNumber(bvNumber)}) * 2^(Exp(bv:${formatComputedNumber(bvNumber)})/1000 * Mid(corr_dr_midratio:${formatComputedNumber(corrDrMidratio)})/1024) = ${formatThresholdNumber(baseValue)} * 2^(${formatExponentCoefficient(expValue)} * ${formatMidRatioFactor(effectiveMidValue)}) = [`;
  useEffect(() => {
    onMainThdValueChange?.(targetValue);
  }, [onMainThdValueChange, targetValue]);
  const b2dCurvePoints = useMemo(() => buildB2dCurvePoints(editableB2dCurve), [editableB2dCurve]);
  const b2dCorrCurvePoints = useMemo(() => buildB2dCorrCurvePoints(editableB2dCorrCurve), [editableB2dCorrCurve]);
  const b2dCorrValue = parseFiniteNumber(firstNumericString(editableB2dCorrCurve?.value));
  const b2dOriFactor = computeRatioFromKeyPoints(b2d, b2dCurvePoints);
  const computedDrMidratioOri = Number.isFinite(midratio) && Number.isFinite(b2dOriFactor)
    ? (midratio * b2dOriFactor) / 1024
    : midratioOri;
  const restoreBvTitle = imageBvValue
    ? `恢复图片 BV 值：${imageBvValue}`
    : defaultBv
      ? `恢复默认 BV 值：${defaultBv}`
      : "无可恢复 BV 值";

  const updateThresholdCell = (rowLabel: MainTargetThresholdRow["label"], cellIndex: number, nextValue: string) => {
    const currentRow = editableRows.find((row) => row.label === rowLabel);
    if (!currentRow) return;
    const trimmed = nextValue.trim();
    if (!isSourceNumberText(trimmed)) return;
    const nextText = replaceThresholdCellInSourceText(sourceDraftTextRef.current, currentRow, cellIndex, trimmed);
    if (nextText === null) return;
    sourceDraftTextRef.current = nextText;
    onSourceDraftTextChange?.(nextText);
    setEditableRows((current) => updateThresholdRowsCell(current, rowLabel, cellIndex, trimmed));
  };

  const bvBindingEntries: BindingEntry[] = orderedRows.map((row) => ({
    id: row.label,
    label: row.label,
    path: bvBindingPaths[row.label] ?? row.path,
    values: row.values,
  }));
  const midBindingEntries: BindingEntry[] = [
    { id: "midX1", label: "F(corr) P1 x", path: midBindingPaths.midX1, values: editableMidCurve?.x1 ?? [] },
    { id: "midY1", label: "F(corr) P1 y", path: midBindingPaths.midY1, values: editableMidCurve?.y1 ?? [] },
    { id: "midX2", label: "F(corr) P2 x", path: midBindingPaths.midX2, values: editableMidCurve?.x2 ?? [] },
    { id: "midY2", label: "F(corr) P2 y", path: midBindingPaths.midY2, values: editableMidCurve?.y2 ?? [] },
    { id: "b2dX", label: "F(B2D)_ori x", path: midBindingPaths.b2dX, values: editableB2dCurve?.x ?? [] },
    { id: "b2dY", label: "F(B2D)_ori y", path: midBindingPaths.b2dY, values: editableB2dCurve?.y ?? [] },
    { id: "corrValue", label: "corr value", path: midBindingPaths.corrValue, values: editableB2dCorrCurve?.value ?? [] },
    { id: "corrX1", label: "F(B2D)_corr P1 x", path: midBindingPaths.corrX1, values: editableB2dCorrCurve?.x1 ?? [] },
    { id: "corrY1", label: "F(B2D)_corr P1 y", path: midBindingPaths.corrY1, values: editableB2dCorrCurve?.y1 ?? [] },
    { id: "corrX2", label: "F(B2D)_corr P2 x", path: midBindingPaths.corrX2, values: editableB2dCorrCurve?.x2 ?? [] },
    { id: "corrY2", label: "F(B2D)_corr P2 y", path: midBindingPaths.corrY2, values: editableB2dCorrCurve?.y2 ?? [] },
  ];

  const applyBvBindings = async (entries: BindingEntry[]) => {
    setBindingLoading(true);
    setBindingMessage(null);
    try {
      const nextPaths = {
        BV: entries.find((entry) => entry.id === "BV")?.path.trim() || MAIN_TARGET_THRESHOLD_PATHS[0],
        Base: entries.find((entry) => entry.id === "Base")?.path.trim() || MAIN_TARGET_THRESHOLD_PATHS[1],
        Exp: entries.find((entry) => entry.id === "Exp")?.path.trim() || MAIN_TARGET_THRESHOLD_PATHS[2],
      };
      const nextRows = await loadMainTargetThreshold(filePath, [
        { label: "BV", path: nextPaths.BV },
        { label: "Base", path: nextPaths.Base },
        { label: "Exp", path: nextPaths.Exp },
      ]);
      setBvBindingPaths(nextPaths);
      setEditableRows(nextRows);
      setBindingMessage("已应用 bv 控制绑定");
    } catch (err) {
      setBindingMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBindingLoading(false);
    }
  };

  const applyMidBindings = async (entries: BindingEntry[]) => {
    setBindingLoading(true);
    setBindingMessage(null);
    try {
      const nextPaths = {
        midX1: entries.find((entry) => entry.id === "midX1")?.path.trim() || MID_CURVE_PATHS.x1,
        midY1: entries.find((entry) => entry.id === "midY1")?.path.trim() || MID_CURVE_PATHS.y1,
        midX2: entries.find((entry) => entry.id === "midX2")?.path.trim() || MID_CURVE_PATHS.x2,
        midY2: entries.find((entry) => entry.id === "midY2")?.path.trim() || MID_CURVE_PATHS.y2,
        b2dX: entries.find((entry) => entry.id === "b2dX")?.path.trim() || B2D_CURVE_PATHS.x,
        b2dY: entries.find((entry) => entry.id === "b2dY")?.path.trim() || B2D_CURVE_PATHS.y,
        corrValue: entries.find((entry) => entry.id === "corrValue")?.path.trim() || B2D_CORR_CURVE_PATHS.value,
        corrX1: entries.find((entry) => entry.id === "corrX1")?.path.trim() || B2D_CORR_CURVE_PATHS.x1,
        corrY1: entries.find((entry) => entry.id === "corrY1")?.path.trim() || B2D_CORR_CURVE_PATHS.y1,
        corrX2: entries.find((entry) => entry.id === "corrX2")?.path.trim() || B2D_CORR_CURVE_PATHS.x2,
        corrY2: entries.find((entry) => entry.id === "corrY2")?.path.trim() || B2D_CORR_CURVE_PATHS.y2,
      };
      const [nextMidCurve, nextB2dCurve, nextB2dCorrCurve] = await Promise.all([
        loadMainTargetMidCurve(filePath, {
          x1: nextPaths.midX1,
          y1: nextPaths.midY1,
          x2: nextPaths.midX2,
          y2: nextPaths.midY2,
        }),
        loadMainTargetB2dCurve(filePath, {
          x: nextPaths.b2dX,
          y: nextPaths.b2dY,
        }),
        loadMainTargetB2dCorrCurve(filePath, {
          value: nextPaths.corrValue,
          x1: nextPaths.corrX1,
          y1: nextPaths.corrY1,
          x2: nextPaths.corrX2,
          y2: nextPaths.corrY2,
        }),
      ]);
      setMidBindingPaths(nextPaths);
      setEditableMidCurve(nextMidCurve);
      setEditableB2dCurve(nextB2dCurve);
      setEditableB2dCorrCurve(nextB2dCorrCurve);
      setBindingMessage("已应用 mid 控制绑定");
    } catch (err) {
      setBindingMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBindingLoading(false);
    }
  };

  const resetBvBindings = () => {
    void applyBvBindings([
      { id: "BV", label: "BV", path: MAIN_TARGET_THRESHOLD_PATHS[0], values: [] },
      { id: "Base", label: "Base", path: MAIN_TARGET_THRESHOLD_PATHS[1], values: [] },
      { id: "Exp", label: "Exp", path: MAIN_TARGET_THRESHOLD_PATHS[2], values: [] },
    ]);
  };

  const resetMidBindings = () => {
    void applyMidBindings([
      { id: "midX1", label: "Mid x1", path: MID_CURVE_PATHS.x1, values: [] },
      { id: "midY1", label: "Mid y1", path: MID_CURVE_PATHS.y1, values: [] },
      { id: "midX2", label: "Mid x2", path: MID_CURVE_PATHS.x2, values: [] },
      { id: "midY2", label: "Mid y2", path: MID_CURVE_PATHS.y2, values: [] },
      { id: "b2dX", label: "B2D x", path: B2D_CURVE_PATHS.x, values: [] },
      { id: "b2dY", label: "F(B2D)", path: B2D_CURVE_PATHS.y, values: [] },
      { id: "corrValue", label: "corr value", path: B2D_CORR_CURVE_PATHS.value, values: [] },
      { id: "corrX1", label: "F(B2D)_corr P1 x", path: B2D_CORR_CURVE_PATHS.x1, values: [] },
      { id: "corrY1", label: "F(B2D)_corr P1 y", path: B2D_CORR_CURVE_PATHS.y1, values: [] },
      { id: "corrX2", label: "F(B2D)_corr P2 x", path: B2D_CORR_CURVE_PATHS.x2, values: [] },
      { id: "corrY2", label: "F(B2D)_corr P2 y", path: B2D_CORR_CURVE_PATHS.y2, values: [] },
    ]);
  };

  return (
    <section style={thresholdCardStyle}>
      <div style={thresholdHeaderStyle}>
        <div style={thresholdTitleStyle}>Main Target Threshold</div>
        <button
          type="button"
          title={expanded ? "Collapse Main Target Threshold" : "Expand Main Target Threshold"}
          aria-label={expanded ? "Collapse Main Target Threshold" : "Expand Main Target Threshold"}
          onClick={() => setExpanded((current) => {
            const next = !current;
            onExpandedChange?.(next);
            return next;
          })}
          style={sourceButtonStyle(true)}
        >
          {expanded ? <ChevronUp24Regular className="h-4 w-4" /> : <ChevronDown24Regular className="h-4 w-4" />}
        </button>
      </div>
      <div style={thresholdFormulaStyle}>
        <span>
          {mainThdFormulaPrefix}
          <span style={mainThdLowerActive ? thresholdInlineResultStyle : undefined}>{mainThdLowerText}</span>
          {"~"}
          <span style={mainThdUpperActive ? thresholdInlineResultStyle : undefined}>{mainThdUpperText}</span>
          {"] ="}
        </span>
        <strong style={thresholdResultStyle}>{mainThdValueText}</strong>
      </div>
      {expanded && <div style={thresholdDualControlStyle}>
        <section ref={bvSectionRef} style={thresholdGroupStyle}>
          <div style={thresholdGroupTitleStyle}>
            <span>bv控制</span>
            <div style={thresholdGroupActionsStyle}>
              <button
                type="button"
                title="跳转到 bv 对应源码"
                aria-label="跳转到 bv 对应源码"
                disabled={!onSourceJump}
                onClick={() => onSourceJump?.("Main_Target_Threshold.bv", sourceSpec)}
                style={groupSourceButtonStyle(Boolean(onSourceJump))}
              >
                <Code24Regular className="h-4 w-4" />
              </button>
              <BindingIconButton
                title="参数绑定：bv 控制"
                onClick={() => {
                  setBindingPanel("bv");
                  setBindingMessage(null);
                }}
              />
            </div>
          </div>
          <div style={bvControlRowStyle}>
            <div style={bvInputWrapStyle}>
              <ThresholdValueControl
                label="bv"
                value={bvInput}
                valueTitle="支持滚轮加减数值"
                labelButtonTitle={restoreBvTitle}
                onLabelClick={initialBv ? () => setBvInput(initialBv) : undefined}
                editable
                onChange={setBvInput}
                onWheelStep={(delta) => {
                  setBvInput((current) => formatInputNumber((parseFiniteNumber(current) || 0) + delta));
                }}
                showSteppers
              />
            </div>
            <div style={bvComputedStackStyle}>
              <ThresholdCompactReadout label="base" value={formatThresholdNumber(baseValue)} />
              <ThresholdCompactReadout label="exp" value={formatThresholdNumber(expValue)} />
            </div>
            <div style={bvThdMaxWrapStyle}>
              <ThresholdCompactReadout label="THD_MAX" value={formatThresholdNumber(thdMaxValue)} fillHeight />
            </div>
          </div>
          <div style={thresholdTableWrapStyle}>
            <div style={thresholdTableSurfaceStyle}>
              <table style={thresholdTableStyle}>
                <tbody>
                  {orderedRows.map((row) => (
                    <tr key={row.label}>
                      <th
                        title={row.path}
                        style={thresholdLabelCellStyle(row.label)}
                      >
                        {row.label}
                      </th>
                      {row.values.map((value, idx) => (
                        <ThresholdEditableCell
                          key={`${row.label}:${idx}`}
                          label={row.label}
                          value={value}
                          highlighted={interpolationColumns.has(idx)}
                          editable={Boolean(onSourceDraftTextChange && sourceDraftText !== null && sourceDraftText !== undefined && row.fields[idx])}
                          title={`${row.path} #${idx}`}
                          onCommit={(nextValue) => updateThresholdCell(row.label, idx, nextValue)}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section ref={midSectionRef} style={thresholdGroupStyle}>
          <div style={thresholdGroupTitleStyle}>
            <span>mid控制</span>
            <div style={thresholdGroupActionsStyle}>
              <button
                type="button"
                title="跳转到 mid 对应源码"
                aria-label="跳转到 mid 对应源码"
                disabled={!onSourceJump}
                onClick={() => onSourceJump?.("Main_Target_Threshold.mid", MID_CONTROL_SOURCE_SPEC)}
                style={groupSourceButtonStyle(Boolean(onSourceJump))}
              >
                <Code24Regular className="h-4 w-4" />
              </button>
              <BindingIconButton
                title="参数绑定：mid 控制"
                onClick={() => {
                  setBindingPanel("mid");
                  setBindingMessage(null);
                }}
              />
            </div>
          </div>
          <div style={midControlRowStyle}>
            <div style={midPrimaryWrapStyle}>
              <ThresholdValueControl
                label="Mid"
                value={formatMidReadout(effectiveMidValue, midReadoutMode)}
                labelActive={midChartMode === "thd"}
                valueActive={midChartMode === "corr_mid"}
                labelButtonTitle="显示 Main THD 曲线"
                onLabelClick={() => {
                  setMidChartMode((current) => current === "thd" ? current : "thd");
                  setMidChartSource("mid");
                  setMidChartResetKey((current) => current + 1);
                }}
                onValueClick={() => {
                  setMidChartMode((current) => current === "corr_mid" ? current : "corr_mid");
                  setMidChartSource("mid_value");
                }}
                onValueContextMenu={() => {
                  setMidReadoutMode((current) => current === "value" ? "percent" : "value");
                }}
                valueTitle="百分比基于 1024 计算"
              />
            </div>
            <div style={midComputedStackStyle}>
              <ThresholdMetricButton
                label="corr_dr_midratio"
                value={formatComputedNumber(corrDrMidratio)}
                tooltipPositioning="above-center"
                active={midChartMode === "b2d_corr"}
                title="显示 F(B2D)_corr 曲线"
                onClick={() => {
                  setMidChartMode((current) => current === "b2d_corr" ? current : "b2d_corr");
                  setMidChartSource("corr_dr_midratio");
                }}
              />
              <ThresholdMetricButton
                label="dr_midratio_ori"
                value={formatComputedNumber(midratioOri)}
                active={midChartMode === "b2d_ori" && midChartSource === "dr_midratio_ori"}
                title="显示 F(B2D)_ori 曲线"
                onClick={() => {
                  setMidChartMode((current) => current === "b2d_ori" ? current : "b2d_ori");
                  setMidChartSource("dr_midratio_ori");
                }}
              />
            </div>
            <div style={midComputedStackStyle}>
              <ThresholdMetricButton
                label="B2D"
                value={formatComputedNumber(b2d)}
                disabled={midChartSource === "corr_dr_midratio" || midChartSource === "dr_midratio_ori"}
                title="DR_B2D"
                tooltipPositioning="above-center"
              />
              <ThresholdMetricButton
                label="midratio"
                value={formatComputedNumber(midratio)}
                disabled={midChartSource === "dr_midratio_ori"}
                title="DR_midratio = (DR_M2D/DR_B2D)*1000"
                tooltipPositioning="below-center"
              />
            </div>
          </div>
          {midChartMode === "thd" ? (
            <MidRatioChart
              baseValue={baseValue}
              expValue={expValue}
              thdMaxValue={thdMaxValue}
              midValue={effectiveMidValue}
              corrDrMidratio={corrDrMidratio}
              midCurvePoints={midCurvePoints}
              resetKey={midChartResetKey}
            />
          ) : midChartMode === "corr_mid" ? (
            <B2dRatioChart
              points={midCurvePoints}
              b2dValue={corrDrMidratio}
              titleText="F(corr_dr_midratio)"
              formulaText={(ratio) => `F(corr_dr_midratio) = ${formatRatioTick(ratio)}`}
              maxReferenceValue={effectiveMidValue}
              xAxisLabel="corr_dr_midratio"
              xMaxFloor={1024}
              showFormula={false}
            />
          ) : midChartMode === "b2d_ori" ? (
            <B2dRatioChart
              points={b2dCurvePoints}
              b2dValue={b2d}
              titleText="F(B2D)_ori"
              formulaText={(ratio) => `dr_midratio_ori = midratio x F(B2D)_ori = ${formatThresholdNumber(Number.isFinite(midratio) && Number.isFinite(ratio) ? midratio * ratio / 1024 : NaN)}`}
              maxReferenceValue={computedDrMidratioOri}
            />
          ) : (
            <B2dRatioChart
              points={b2dCorrCurvePoints}
              b2dValue={b2d}
              titleText="F(B2D)_corr"
              formulaText={(ratio) => {
                const result = Number.isFinite(b2dCorrValue) && Number.isFinite(computedDrMidratioOri) && Number.isFinite(ratio)
                  ? (b2dCorrValue * ratio + computedDrMidratioOri * (1024 - ratio)) / 1024
                  : NaN;
                return `corr_dr_midratio = value(${formatComputedNumber(b2dCorrValue)}) x F(B2D)_corr + dr_midratio_ori(${formatThresholdNumber(computedDrMidratioOri)}) x (1024 - F(B2D)_corr) = ${formatThresholdNumber(result)}`;
              }}
              maxReferenceValue={corrDrMidratio}
            />
          )}
        </section>
      </div>}
      {bindingPanel && (
        <BindingEditorPanel
          title={bindingPanel === "bv" ? "bv 控制参数绑定" : "mid 控制参数绑定"}
          entries={bindingPanel === "bv" ? bvBindingEntries : midBindingEntries}
          loading={bindingLoading}
          message={bindingMessage}
          onClose={() => setBindingPanel(null)}
          onApply={bindingPanel === "bv" ? applyBvBindings : applyMidBindings}
          onReset={bindingPanel === "bv" ? resetBvBindings : resetMidBindings}
          onSourceJump={onSourceJump
            ? (entry) => {
                const path = entry.path.trim();
                if (!path) return;
                onSourceJump(bindingPanel === "bv" ? "Main_Target_Threshold.bv" : "Main_Target_Threshold.mid", {
                  paths: [path],
                  jump_to: "first",
                  highlight: "ranges",
                });
              }
            : undefined}
        />
      )}
    </section>
  );
}

function MtwvCard({
  filePath,
  source,
  mtwvValue,
  sourceSpec,
  focusTarget,
  sourceDraftText,
  onSourceDraftTextChange,
  onSourceJump,
  initialExpanded,
  onExpandedChange,
}: {
  filePath: string;
  source: MtwvSource;
  mtwvValue: string | null;
  sourceSpec: CardSourceSpec;
  focusTarget?: ChartFocusTarget | null;
  sourceDraftText?: string | null;
  onSourceDraftTextChange?: (text: string) => void;
  onSourceJump?: (label: string, spec: CardSourceSpec) => void;
  initialExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded ?? true);
  const [editableSource, setEditableSource] = useState(source);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingPath, setBindingPath] = useState(source.path);
  const [bindingLoading, setBindingLoading] = useState(false);
  const [bindingMessage, setBindingMessage] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const sourceDraftTextRef = useRef(sourceDraftText ?? "");
  const maxColumns = Math.max(1, ...editableSource.rows.map((row) => row.values.length));
  const mtwvMatrix = useMemo(
    () => buildMtwvMatrix(editableSource.rows, maxColumns),
    [editableSource.rows, maxColumns],
  );
  const mtwvStats = useMemo(() => summariseMtwvMatrix(mtwvMatrix), [mtwvMatrix]);
  const sourceJumpSpec = {
    ...sourceSpec,
    paths: [editableSource.path],
    jump_to: sourceSpec.jump_to ?? "first",
    highlight: sourceSpec.highlight ?? "ranges",
  };

  useEffect(() => {
    setEditableSource(source);
    setBindingPath(source.path);
  }, [source]);

  useEffect(() => {
    sourceDraftTextRef.current = sourceDraftText ?? "";
  }, [sourceDraftText]);

  useEffect(() => {
    if (!focusTarget?.label.startsWith("MTWV")) return;
    if (!expanded) {
      setExpanded(true);
      onExpandedChange?.(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, focusTarget]);

  const bindingEntries: BindingEntry[] = [{
    id: "weightTable",
    label: "Weight table",
    path: bindingPath,
    values: editableSource.rows.flatMap((row) => row.values),
  }];

  const applyBindings = async (entries: BindingEntry[]) => {
    setBindingLoading(true);
    setBindingMessage(null);
    try {
      const nextPath = entries.find((entry) => entry.id === "weightTable")?.path.trim() || MTWV_WEIGHT_TABLE_PATH;
      const nextSource = await loadMtwvWeightTable(filePath, nextPath);
      setBindingPath(nextPath);
      setEditableSource(nextSource);
      setBindingMessage("Applied Weight table binding");
    } catch (err) {
      setBindingMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBindingLoading(false);
    }
  };

  const resetBindings = () => {
    void applyBindings([{ id: "weightTable", label: "Weight table", path: MTWV_WEIGHT_TABLE_PATH, values: [] }]);
  };

  const updateWeightCell = (rowId: string, cellIndex: number, nextValue: string) => {
    const currentRow = editableSource.rows.find((row) => row.id === rowId);
    if (!currentRow) return;
    const trimmed = nextValue.trim();
    if (!isSourceNumberText(trimmed)) return;
    const nextText = replaceMtwvCellInSourceText(sourceDraftTextRef.current, currentRow, cellIndex, trimmed);
    if (nextText === null) return;
    sourceDraftTextRef.current = nextText;
    onSourceDraftTextChange?.(nextText);
    setEditableSource((current) => ({
      ...current,
      rows: updateMtwvRowsCell(current.rows, rowId, cellIndex, trimmed),
    }));
  };

  return (
    <section ref={cardRef} style={thresholdCardStyle}>
      <div style={thresholdHeaderStyle}>
        <div style={thresholdTitleStyle}>MTWV</div>
        <button
          type="button"
          title={expanded ? "Collapse MTWV" : "Expand MTWV"}
          aria-label={expanded ? "Collapse MTWV" : "Expand MTWV"}
          onClick={() => setExpanded((current) => {
            const next = !current;
            onExpandedChange?.(next);
            return next;
          })}
          style={sourceButtonStyle(true)}
        >
          {expanded ? <ChevronUp24Regular className="h-4 w-4" /> : <ChevronDown24Regular className="h-4 w-4" />}
        </button>
      </div>
      <div style={thresholdFormulaStyle}>
        <span>MTWV = sum(Block[i] * Weight[i]) / sum(Weight[i])</span>
        <strong style={thresholdResultStyle}>{mtwvValue ?? "-"}</strong>
      </div>
      {expanded && (
        <div style={mtwvControlWrapStyle}>
          <section style={thresholdGroupStyle}>
            <div style={thresholdGroupTitleStyle}>
              <span>Weight table</span>
              <div style={thresholdGroupActionsStyle}>
                <button
                  type="button"
                  title="Jump to Weight table source"
                  aria-label="Jump to Weight table source"
                  disabled={!onSourceJump}
                  onClick={() => onSourceJump?.("MTWV.weight_table", sourceJumpSpec)}
                  style={groupSourceButtonStyle(Boolean(onSourceJump))}
                >
                  <Code24Regular className="h-4 w-4" />
                </button>
                <BindingIconButton
                  title="Bind Weight table parameter"
                  onClick={() => {
                    setBindingOpen(true);
                    setBindingMessage(null);
                  }}
                />
              </div>
            </div>
            <div style={mtwvOverviewStyle}>
              <div style={mtwvFormulaPanelStyle}>
                <div style={mtwvFormulaTitleStyle}>Weighted average model</div>
                <div style={mtwvFormulaTextStyle}>
                  <span style={mtwvFormulaAccentStyle}>MTWV</span>
                  <span>=</span>
                  <span>(B1*W1 + B2*W2 + ... + BN*WN)</span>
                  <span>/</span>
                  <span>(W1 + W2 + ... + WN)</span>
                </div>
                <div style={mtwvFlowStyle} aria-hidden="true">
                  <div style={mtwvFlowBoxStyle("block")}>Block</div>
                  <div style={mtwvFlowOperatorStyle}>x</div>
                  <div style={mtwvFlowBoxStyle("weight")}>Weight</div>
                  <div style={mtwvFlowOperatorStyle}>/</div>
                  <div style={mtwvFlowBoxStyle("sum")}>Sum(W)</div>
                </div>
              </div>
              <div style={mtwvStatsGridStyle}>
                <MtwvStat label="Result" value={mtwvValue ?? "-"} strong />
                <MtwvStat label="Shape" value={`${mtwvStats.rowCount}x${mtwvStats.columnCount}`} />
                <MtwvStat label="Sum(W)" value={formatComputedNumber(mtwvStats.sum)} />
                <MtwvStat label="Center" value={formatComputedNumber(mtwvStats.center)} />
                <MtwvStat label="Peak" value={formatComputedNumber(mtwvStats.max)} />
                <MtwvStat label="Avg(W)" value={formatComputedNumber(mtwvStats.average)} />
              </div>
            </div>
            <div style={mtwvTableWrapStyle}>
              <div style={mtwvTableSurfaceStyle}>
                <div style={mtwvHeatmapGridStyle(maxColumns)}>
                  <div title={editableSource.path} style={mtwvHeatmapCornerStyle}>
                    {editableSource.rows.length}x{maxColumns}
                  </div>
                  {Array.from({ length: maxColumns }, (_, index) => (
                    <div key={`c:${index}`} style={mtwvHeatmapHeaderStyle}>C{index + 1}</div>
                  ))}
                  {editableSource.rows.map((row, rowIndex) => (
                    <Fragment key={row.id}>
                      <div title={row.line > 0 ? `${row.path} L${row.line}` : row.path} style={mtwvHeatmapRowHeaderStyle}>
                        R{rowIndex + 1}
                      </div>
                      {Array.from({ length: maxColumns }, (_, cellIndex) => {
                        const rawValue = row.values[cellIndex] ?? "";
                        const numericValue = parseFiniteNumber(rawValue);
                        const editable = Boolean(onSourceDraftTextChange && sourceDraftText !== null && sourceDraftText !== undefined && row.fields[cellIndex]);
                        const intensity = mtwvCellIntensity(numericValue, mtwvStats.min, mtwvStats.max);
                        return (
                          <MtwvHeatmapCell
                            key={`${row.id}:${cellIndex}`}
                            value={rawValue}
                            intensity={intensity}
                            editable={editable}
                            title={row.line > 0 ? `${row.path} L${row.line} #${cellIndex}` : row.path}
                            onCommit={(nextValue) => updateWeightCell(row.id, cellIndex, nextValue)}
                          />
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
      {bindingOpen && (
        <BindingEditorPanel
          title="Weight table parameter binding"
          entries={bindingEntries}
          loading={bindingLoading}
          message={bindingMessage}
          onClose={() => setBindingOpen(false)}
          onApply={applyBindings}
          onReset={resetBindings}
          onSourceJump={onSourceJump
            ? (entry) => {
                const path = entry.path.trim();
                if (!path) return;
                onSourceJump("MTWV.weight_table", {
                  paths: [path],
                  jump_to: "first",
                  highlight: "ranges",
                });
              }
            : undefined}
        />
      )}
    </section>
  );
}

function MtwvStat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div style={mtwvStatStyle(strong)}>
      <span style={mtwvStatLabelStyle}>{label}</span>
      <strong style={mtwvStatValueStyle(strong)}>{value}</strong>
    </div>
  );
}

function MtwvHeatmapCell({
  value,
  intensity,
  editable,
  title,
  onCommit,
}: {
  value: string;
  intensity: number;
  editable: boolean;
  title: string;
  onCommit: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const resetDraft = () => {
    setDraftValue(value);
  };

  const commitDraft = () => {
    if (!editable) return;
    const nextValue = draftValue.trim();
    if (nextValue === value.trim()) return;
    onCommit(nextValue);
  };

  return (
    <div title={title} style={mtwvHeatmapCellStyle(intensity, focused, editable)}>
      <input
        aria-label={title}
        value={draftValue}
        readOnly={!editable}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          resetDraft();
        }}
        onChange={(event) => setDraftValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            resetDraft();
            event.currentTarget.blur();
          }
        }}
        inputMode="decimal"
        style={mtwvHeatmapInputStyle(editable)}
      />
    </div>
  );
}

function MainTargetCard({
  cwvValue,
  mainThdValue,
  mtwvValue,
  initialExpanded,
  onExpandedChange,
}: {
  cwvValue: string | null;
  mainThdValue: number;
  mtwvValue: string | null;
  initialExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded ?? true);
  useEffect(() => {
    setExpanded(initialExpanded ?? true);
  }, [initialExpanded]);
  const cwvNumber = parseFiniteNumber(cwvValue);
  const mtwvNumber = parseFiniteNumber(mtwvValue);
  const mainTargetValue = Number.isFinite(cwvNumber) && Number.isFinite(mainThdValue) && Number.isFinite(mtwvNumber) && mtwvNumber !== 0
    ? cwvNumber * (mainThdValue / mtwvNumber)
    : NaN;
  const mainTargetFormula = `Main Target = CWV * (Main THD / MTWV) = ${formatThresholdNumber(cwvNumber)} * (${formatThresholdNumber(mainThdValue)} / ${formatThresholdNumber(mtwvNumber)}) =`;

  return (
    <section style={thresholdCardStyle}>
      <div style={thresholdHeaderStyle}>
        <div style={thresholdTitleStyle}>Main Target</div>
        <button
          type="button"
          title={expanded ? "Collapse Main Target" : "Expand Main Target"}
          aria-label={expanded ? "Collapse Main Target" : "Expand Main Target"}
          onClick={() => setExpanded((current) => {
            const next = !current;
            onExpandedChange?.(next);
            return next;
          })}
          style={sourceButtonStyle(true)}
        >
          {expanded ? <ChevronUp24Regular className="h-4 w-4" /> : <ChevronDown24Regular className="h-4 w-4" />}
        </button>
      </div>
      <div style={thresholdFormulaStyle}>
        <span>{mainTargetFormula}</span>
        <strong style={thresholdResultStyle}>{formatThresholdNumber(mainTargetValue)}</strong>
      </div>
      {expanded && <div style={mainTargetBlankStyle} aria-hidden="true" />}
    </section>
  );
}

function HsTargetCard({
  cwvValue,
  inputs,
  onAreaJump,
  initialExpanded,
  onExpandedChange,
}: {
  cwvValue: string | null;
  inputs: Array<{
    id: string;
    label: string;
    thdKey: string;
    yKey: string;
    wetKey: string;
    targetKey: string;
    thd: string | null;
    y: string | null;
    wet: string | null;
    targetValue: string | null;
  }>;
  onAreaJump?: (sourceId: string) => void;
  initialExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded ?? true);
  const [termOrder, setTermOrder] = useState<string[]>(HS_TARGET_TERM_ORDER);
  const termSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const cwvNumber = parseFiniteNumber(cwvValue);
  const termsById = new Map(inputs.map((input) => [input.id, input]));
  const orderedInputs = termOrder
    .map((id) => termsById.get(id))
    .filter((input): input is typeof inputs[number] => Boolean(input));
  for (const input of inputs) {
    if (!termOrder.includes(input.id)) orderedInputs.push(input);
  }
  const terms = orderedInputs.map((input) => {
    const thd = parseFiniteNumber(input.thd);
    const y = parseFiniteNumber(input.y);
    const wet = parseFiniteNumber(input.wet);
    const target = Number.isFinite(cwvNumber) && Number.isFinite(thd) && Number.isFinite(y) && y !== 0
      ? cwvNumber * thd / y
      : NaN;
    const missing = [
      Number.isFinite(cwvNumber) ? null : "CWV",
      Number.isFinite(thd) ? null : `${input.label}_THD`,
      Number.isFinite(y) ? null : `${input.label}_Y`,
      Number.isFinite(wet) ? null : `${input.label}_Wet`,
    ].filter((item): item is string => Boolean(item));
    const contribution = Number.isFinite(wet) && wet === 0
      ? 0
      : Number.isFinite(target) && Number.isFinite(wet)
        ? target * wet
        : NaN;
    const targetLabelText = formatHsTargetTitleValue(input.targetValue);
    return { ...input, thd, y, wet, target, contribution, missing, targetLabelText };
  });
  const termIds = terms.map((term) => term.id);
  const wetSum = terms.reduce((sum, term) => sum + (Number.isFinite(term.wet) ? term.wet : 0), 0);
  const weightedSum = terms.reduce((sum, term) =>
    sum + (Number.isFinite(term.contribution) ? term.contribution : 0), 0);
  const targetValue = wetSum > 0 ? weightedSum / wetSum : NaN;
  const formula = "HS Target = ((CWV*BT_THD/BT_Y)*BT_Wet + (CWV*MT_THD/MT_Y)*MT_Wet + (CWV*DT_THD/DT_Y)*DT_Wet) / (BT_Wet + MT_Wet + DT_Wet) =";
  const onTermDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = termOrder.indexOf(String(active.id));
    const newIndex = termOrder.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setTermOrder((current) => arrayMove(current, oldIndex, newIndex));
  };

  return (
    <section style={thresholdCardStyle}>
      <div style={thresholdHeaderStyle}>
        <div style={thresholdTitleStyle}>Histogram Stretch Target</div>
        <button
          type="button"
          title={expanded ? "Collapse Histogram Stretch Target" : "Expand Histogram Stretch Target"}
          aria-label={expanded ? "Collapse Histogram Stretch Target" : "Expand Histogram Stretch Target"}
          onClick={() => setExpanded((current) => {
            const next = !current;
            onExpandedChange?.(next);
            return next;
          })}
          style={sourceButtonStyle(true)}
        >
          {expanded ? <ChevronUp24Regular className="h-4 w-4" /> : <ChevronDown24Regular className="h-4 w-4" />}
        </button>
      </div>
      <div style={thresholdFormulaStyle}>
        <span>{formula}</span>
        <strong style={thresholdResultStyle}>{formatThresholdNumber(targetValue)}</strong>
      </div>
      {expanded && <div style={hsTargetBodyStyle}>
        <DndContext
          sensors={termSensors}
          collisionDetection={closestCenter}
          onDragEnd={onTermDragEnd}
        >
          <SortableContext items={termIds} strategy={rectSortingStrategy}>
            <div style={hsTargetTermGridStyle}>
              {terms.map((term) => {
                const hasMissing = term.missing.length > 0;
                const active = Number.isFinite(term.wet) && term.wet > 0;
                const status = hasMissing ? `缺失 ${term.missing.join("/")}` : active ? "参与加权" : "Wet=0";
                const jumpLabel = HS_TARGET_AREA_LABEL_BY_ID[term.id] ?? "HS area";
                return (
                <SortableHsTargetTermCard key={term.id} id={term.id}>
                  <div
                    title={`右键跳转到 ${jumpLabel}，按住左键拖拽调整位置`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onAreaJump?.(term.id);
                    }}
                    style={hsTargetTermCardStyle(hasMissing, active)}
                  >
                    <div style={hsTargetTermHeaderStyle}>
                      <span style={hsTargetTermTitleStyle}>
                        {term.label}: <span style={hsTargetTermTitleValueStyle}>{term.targetLabelText}</span>
                      </span>
                      <span style={hsTargetStatusBadgeStyle(hasMissing, active)}>{status}</span>
                    </div>
                    <div style={hsTargetTermEquationStyle}>
                      <span style={hsTargetTermFormulaStyle}>
                        {formatThresholdNumber(cwvNumber)} * {formatThresholdNumber(term.thd)} / {formatThresholdNumber(term.y)}
                      </span>
                      <strong style={hsTargetTermValueStyle}>{formatThresholdNumber(term.target)}</strong>
                    </div>
                    <div style={hsTargetMetricRowsStyle}>
                      <div style={hsTargetMetricRowStyle("thd", !Number.isFinite(term.thd), active)}>
                        <span>THD</span>
                        <strong>{formatRoundedNumber(term.thd)}</strong>
                      </div>
                      <div style={hsTargetMetricRowStyle("y", !Number.isFinite(term.y), active)}>
                        <span>Y</span>
                        <strong>{formatRoundedNumber(term.y)}</strong>
                      </div>
                      <div style={hsTargetMetricRowStyle("wet", !Number.isFinite(term.wet), active)}>
                        <span>Wet</span>
                        <strong>{formatRoundedNumber(term.wet)}</strong>
                      </div>
                    </div>
                    <div style={hsTargetContributionStyle(active)}>
                      <span>Contribution</span>
                      <strong>{formatThresholdNumber(term.contribution)}</strong>
                    </div>
                  </div>
                </SortableHsTargetTermCard>
              );})}
            </div>
          </SortableContext>
        </DndContext>
      </div>}
    </section>
  );
}

function SortableHsTargetTermCard({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        ...hsTargetTermDragWrapStyle(isDragging),
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function HsWeightCard({
  domId,
  source,
  bvValue,
  b2dValue,
  midValue,
  wetValues,
  sourceDraftText,
  onSourceDraftTextChange,
  onSourceJump,
  initialExpanded,
  onExpandedChange,
}: {
  domId?: string;
  source: HsWeightSource | null;
  bvValue: string | null;
  b2dValue: string | null;
  midValue: string | null;
  wetValues: Record<HsWeightToneId, string | null>;
  sourceDraftText?: string | null;
  onSourceDraftTextChange?: (text: string) => void;
  onSourceJump?: (label: string, spec: CardSourceSpec) => void;
  initialExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded ?? true);
  const [editableSource, setEditableSource] = useState(source);
  const sourceDraftTextRef = useRef(sourceDraftText ?? "");
  useEffect(() => {
    setExpanded(initialExpanded ?? true);
  }, [initialExpanded]);
  useEffect(() => {
    setEditableSource(source);
  }, [source]);
  useEffect(() => {
    sourceDraftTextRef.current = sourceDraftText ?? "";
  }, [sourceDraftText]);
  const bv = parseFiniteNumber(bvValue);
  const b2d = parseFiniteNumber(b2dValue);
  const mid = parseFiniteNumber(midValue);
  const resultItems = HS_WEIGHT_RESULT_ITEMS.map((item) => {
    const channelIndex = HS_WEIGHT_CHANNELS.findIndex((channel) => channel.id === item.id);
    const interpolated = editableSource && channelIndex >= 0
      ? interpolateHsWeightSource(editableSource, channelIndex, bv, b2d, mid)
      : NaN;
    return {
      ...item,
      wetText: formatHsWeightWetValue(wetValues[item.id]),
      interpolatedText: formatHsWeightInterpolatedValue(interpolated),
    };
  });
  const selected = locateHsWeightSelection(editableSource, bv, b2d, mid);
  const selectedPointText = formatHsSelectedPoint(bv, b2d, mid);
  const canEdit = Boolean(onSourceDraftTextChange && sourceDraftText !== null && sourceDraftText !== undefined);

  const previewWeightCell = (target: HsWeightCellTarget, nextValue: string) => {
    const trimmed = nextValue.trim();
    if (!isSourceNumberText(trimmed)) return;
    setEditableSource((current) => current ? previewHsWeightSourceTarget(current, target, trimmed) : current);
  };

  const updateWeightCell = (target: HsWeightCellTarget, nextValue: string): boolean => {
    if (!editableSource) return false;
    const trimmed = nextValue.trim();
    if (!isSourceNumberText(trimmed)) return false;
    const field = getHsWeightTargetField(editableSource, target);
    if (!field) return false;
    const nextText = replaceHsWeightCellInSourceText(sourceDraftTextRef.current, editableSource, field, trimmed);
    if (nextText === null) return false;
    sourceDraftTextRef.current = nextText;
    onSourceDraftTextChange?.(nextText);
    setEditableSource((current) => current ? updateHsWeightSourceField(current, field, trimmed) : current);
    return true;
  };

  return (
    <section id={domId} style={thresholdCardStyle}>
      <div style={thresholdHeaderStyle}>
        <div style={thresholdTitleStyle}>HS Weight</div>
        <div style={thresholdGroupActionsStyle}>
          <button
            type="button"
            title="Jump to HS Weight source"
            aria-label="Jump to HS Weight source"
            disabled={!onSourceJump}
            onClick={() => onSourceJump?.("HS.Weight", {
              paths: [HS_WEIGHT_BV_PATH, HS_WEIGHT_DR_B2D_PATH, HS_WEIGHT_MID_PATH, HS_WEIGHT_VALUE_PATH],
              jump_to: "first",
              highlight: "ranges",
            })}
            style={groupSourceButtonStyle(Boolean(onSourceJump))}
          >
            <Code24Regular className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={expanded ? "Collapse HS Weight" : "Expand HS Weight"}
            aria-label={expanded ? "Collapse HS Weight" : "Expand HS Weight"}
            onClick={() => setExpanded((current) => {
              const next = !current;
              onExpandedChange?.(next);
              return next;
            })}
            style={sourceButtonStyle(true)}
          >
            {expanded ? <ChevronUp24Regular className="h-4 w-4" /> : <ChevronDown24Regular className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div style={thresholdFormulaStyle}>
        <strong style={hsWeightSelectedPointStyle}>{selectedPointText}</strong>
        <span style={hsWeightFormulaTextStyle}>
          {"("}
          {resultItems.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 && <span>, </span>}
              <span>{item.label}:</span>
              <span style={hsWeightWetValueStyle}>{item.wetText}</span>
              <span>|</span>
              <span style={hsWeightInterpolatedValueStyle}>{item.interpolatedText}</span>
            </Fragment>
          ))}
          {")"}
        </span>
      </div>
      {expanded && <div style={hsWeightBodyStyle}>
        <div style={hsWeightTableWrapStyle}>
          {editableSource ? (
            <HsWeightGrid
              source={editableSource}
              selected={selected}
              editable={canEdit}
              onCellPreview={previewWeightCell}
              onCellCommit={updateWeightCell}
            />
          ) : (
            <div style={hsWeightPendingStyle}>loading...</div>
          )}
        </div>
      </div>}
    </section>
  );
}

function HsWeightGrid({
  source,
  selected,
  editable,
  onCellPreview,
  onCellCommit,
}: {
  source: HsWeightSource | null;
  selected: HsWeightSelection;
  editable: boolean;
  onCellPreview?: (target: HsWeightCellTarget, value: string) => void;
  onCellCommit?: (target: HsWeightCellTarget, value: string) => boolean | void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState({ scale: 1, width: 0, height: 0 });
  const bvAxis = source?.bvAxis ?? [];
  const midAxis = source?.midAxis ?? [];
  const displayMidAxis = midAxis.length > 0 ? midAxis : [NaN];
  const midColumnCount = displayMidAxis.length;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const sheet = sheetRef.current;
    if (!viewport || !sheet) return;

    let frame = 0;
    const measure = () => {
      const naturalWidth = Math.max(1, sheet.offsetWidth, sheet.scrollWidth);
      const naturalHeight = Math.max(1, sheet.offsetHeight, sheet.scrollHeight);
      const availableWidth = Math.max(1, viewport.clientWidth);
      const scale = availableWidth / naturalWidth;
      setFit({
        scale,
        width: naturalWidth * scale,
        height: naturalHeight * scale,
      });
    };
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(sheet);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [source, midColumnCount]);

  return (
    <div ref={viewportRef} style={hsWeightScaleViewportStyle}>
      <div style={hsWeightScaleSlotStyle(fit.width, fit.height)}>
        <div
          ref={sheetRef}
          style={{
            ...hsWeightSheetStyle(midColumnCount),
            ...hsWeightScaledSheetStyle(fit.scale),
          }}
        >
          <div style={hsWeightHeaderGridStyle(midColumnCount)}>
            <div style={hsWeightAxisHeaderStyle("bv")}>BV</div>
            <div style={hsWeightAxisHeaderStyle("dr")}>DR:B2D</div>
            <div style={hsWeightMidGroupHeaderStyle(midColumnCount)}>Mid%</div>
            {displayMidAxis.map((mid, midIndex) => {
              const field = source?.midAxisFields[midIndex] ?? null;
              return (
                <HsWeightEditableCell
                  key={midIndex}
                  value={field?.value ?? formatHsWeightCell(mid)}
                  editable={editable && Boolean(field)}
                  title={field ? `${source?.midPath} #${midIndex}` : "Mid%"}
                  style={hsWeightMidHeaderStyle(selected.midIndexes.has(midIndex))}
                  onPreview={(value) => onCellPreview?.({ kind: "mid", midIndex }, value)}
                  onCommit={(value) => onCellCommit?.({ kind: "mid", midIndex }, value)}
                />
              );
            })}
          </div>
          {bvAxis.map((bv, bvIndex) => {
            const drAxis = source?.drB2dRows[bvIndex] ?? [];
            const bvField = source?.bvAxisFields[bvIndex] ?? null;
            return (
            <div key={`${bvIndex}:${bv}`} style={hsWeightBvGroupGridStyle(midColumnCount, bvIndex > 0)}>
              <HsWeightEditableCell
                value={bvField?.value ?? formatHsWeightCell(bv)}
                editable={editable && Boolean(bvField)}
                title={bvField ? `${source?.bvPath} #${bvIndex}` : "BV"}
                style={hsWeightBvHeaderStyle(selected.bvIndexes.has(bvIndex), drAxis.length)}
                onPreview={(value) => onCellPreview?.({ kind: "bv", bvIndex }, value)}
                onCommit={(value) => onCellCommit?.({ kind: "bv", bvIndex }, value)}
              />
              <div style={hsWeightB2dColumnStyle}>
                {drAxis.map((dr, drIndex) => {
                  const field = source?.drB2dFields[bvIndex]?.[drIndex] ?? null;
                  return (
                    <HsWeightEditableCell
                      key={`${bvIndex}:${drIndex}`}
                      value={field?.value ?? formatHsWeightCell(dr)}
                      editable={editable && Boolean(field)}
                      title={field ? `${source?.drB2dPath} #${bvIndex}:${drIndex}` : "DR:B2D"}
                      style={hsWeightB2dCellStyle(Boolean(selected.drIndexesByBv.get(bvIndex)?.has(drIndex)))}
                      onPreview={(value) => onCellPreview?.({ kind: "dr", bvIndex, drIndex }, value)}
                      onCommit={(value) => onCellCommit?.({ kind: "dr", bvIndex, drIndex }, value)}
                    />
                  );
                })}
              </div>
              {displayMidAxis.map((_, midIndex) => (
                <div key={`${bvIndex}:${midIndex}`} style={hsWeightMiniTableWrapStyle(selected.bvIndexes.has(bvIndex) && selected.midIndexes.has(midIndex))}>
                  <div style={hsWeightMiniTableStyle}>
                    {drAxis.map((_, drIndex) => (
                      <Fragment key={`${bvIndex}:${midIndex}:${drIndex}`}>
                        {HS_WEIGHT_CHANNELS.map((channel, channelIndex) => {
                          const value = source ? getHsWeightCell(source, bvIndex, drIndex, midIndex, channelIndex) : NaN;
                          const field = source?.valueFields[bvIndex]?.[drIndex]?.[midIndex]?.[channelIndex] ?? null;
                          const selectedCell = selected.bvIndexes.has(bvIndex)
                            && Boolean(selected.drIndexesByBv.get(bvIndex)?.has(drIndex))
                            && selected.midIndexes.has(midIndex);
                          return (
                            <HsWeightEditableCell
                              key={channel.id}
                              value={field?.value ?? formatHsWeightCell(value)}
                              editable={editable && Boolean(field)}
                              title={field ? `${source?.matrixPath} #${bvIndex}:${drIndex}:${midIndex}:${channelIndex}` : channel.id}
                              style={hsWeightMiniCellStyle(channel.id, selectedCell, channelIndex)}
                              onPreview={(nextValue) => onCellPreview?.({
                                kind: "value",
                                bvIndex,
                                drIndex,
                                midIndex,
                                channelIndex,
                              }, nextValue)}
                              onCommit={(nextValue) => onCellCommit?.({
                                kind: "value",
                                bvIndex,
                                drIndex,
                                midIndex,
                                channelIndex,
                              }, nextValue)}
                            />
                          );
                        })}
                        {drIndex < drAxis.length - 1 && <div style={hsWeightMiniRowDividerStyle} />}
                      </Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );})}
        </div>
      </div>
    </div>
  );
}

function HsWeightEditableCell({
  value,
  editable,
  title,
  style,
  onPreview,
  onCommit,
}: {
  value: string;
  editable: boolean;
  title: string;
  style: CSSProperties;
  onPreview?: (value: string) => void;
  onCommit?: (value: string) => boolean | void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const cellStyle = isHsWeightZeroCellText(draftValue)
    ? { ...style, color: HS_WEIGHT_ZERO_TEXT_COLOR }
    : style;

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const resetDraft = () => {
    setDraftValue(value);
    onPreview?.(value);
  };

  const commitDraft = (): boolean => {
    if (!editable) return false;
    const nextValue = draftValue.trim();
    if (nextValue === value.trim()) return true;
    if (!isSourceNumberText(nextValue)) {
      resetDraft();
      return false;
    }
    const committed = onCommit?.(nextValue);
    if (committed === false) {
      resetDraft();
      return false;
    }
    return true;
  };

  const updateDraft = (nextValue: string) => {
    setDraftValue(nextValue);
    onPreview?.(isSourceNumberText(nextValue.trim()) ? nextValue : value);
  };

  return (
    <div style={cellStyle}>
      <input
        aria-label={title}
        value={draftValue}
        readOnly={!editable}
        tabIndex={editable ? 0 : -1}
        onBlur={commitDraft}
        onChange={(event) => updateDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            resetDraft();
            event.currentTarget.blur();
          }
        }}
        inputMode="decimal"
        style={hsWeightCellInputStyle(editable)}
      />
    </div>
  );
}

function HsAreaCard({
  domId,
  title,
  source,
  bvValue,
  axisValue,
  axisLabel,
  thdLabel,
  thdValue,
  cornerLabel,
  sourceJumpLabel,
  sourcePaths,
  sourceDraftText,
  onSourceDraftTextChange,
  onSourceJump,
  initialExpanded,
  onExpandedChange,
}: {
  domId?: string;
  title: string;
  source: HsAreaSource | null;
  bvValue: string | null;
  axisValue: string | null;
  axisLabel: string;
  thdLabel: string;
  thdValue: string | null;
  cornerLabel: string;
  sourceJumpLabel: string;
  sourcePaths: string[];
  sourceDraftText?: string | null;
  onSourceDraftTextChange?: (text: string) => void;
  onSourceJump?: (label: string, spec: CardSourceSpec) => void;
  initialExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded ?? true);
  const [editableSource, setEditableSource] = useState(source);
  const sourceDraftTextRef = useRef(sourceDraftText ?? "");
  useEffect(() => {
    setExpanded(initialExpanded ?? true);
  }, [initialExpanded]);
  useEffect(() => {
    setEditableSource(source);
  }, [source]);
  useEffect(() => {
    sourceDraftTextRef.current = sourceDraftText ?? "";
  }, [sourceDraftText]);
  const bv = parseFiniteNumber(bvValue);
  const axis = parseFiniteNumber(axisValue);
  const interpolatedThd = editableSource ? interpolateHsAreaSource(editableSource, bv, axis) : NaN;
  const selected = locateHsAreaSelection(editableSource, bv, axis);
  const canEdit = Boolean(onSourceDraftTextChange && sourceDraftText !== null && sourceDraftText !== undefined);

  const previewAreaCell = (target: HsAreaCellTarget, nextValue: string) => {
    const trimmed = nextValue.trim();
    if (!isSourceNumberText(trimmed)) return;
    setEditableSource((current) => current ? previewHsAreaSourceTarget(current, target, trimmed) : current);
  };

  const updateAreaCell = (target: HsAreaCellTarget, nextValue: string): boolean => {
    if (!editableSource) return false;
    const trimmed = nextValue.trim();
    if (!isSourceNumberText(trimmed)) return false;
    const field = getHsAreaTargetField(editableSource, target);
    if (!field) return false;
    const nextText = replaceHsAreaCellInSourceText(sourceDraftTextRef.current, editableSource, field, trimmed);
    if (nextText === null) return false;
    sourceDraftTextRef.current = nextText;
    onSourceDraftTextChange?.(nextText);
    setEditableSource((current) => current ? updateHsAreaSourceField(current, field, trimmed) : current);
    return true;
  };

  return (
    <section id={domId} style={thresholdCardStyle}>
      <div style={thresholdHeaderStyle}>
        <div style={thresholdTitleStyle}>{title}</div>
        <div style={thresholdGroupActionsStyle}>
          <button
            type="button"
            title={`Jump to ${title} source`}
            aria-label={`Jump to ${title} source`}
            disabled={!onSourceJump}
            onClick={() => onSourceJump?.(sourceJumpLabel, {
              paths: sourcePaths,
              jump_to: "first",
              highlight: "ranges",
            })}
            style={groupSourceButtonStyle(Boolean(onSourceJump))}
          >
            <Code24Regular className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={expanded ? `Collapse ${title}` : `Expand ${title}`}
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            onClick={() => setExpanded((current) => {
              const next = !current;
              onExpandedChange?.(next);
              return next;
            })}
            style={sourceButtonStyle(true)}
          >
            {expanded ? <ChevronUp24Regular className="h-4 w-4" /> : <ChevronDown24Regular className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div style={thresholdFormulaStyle}>
        <strong style={hsWeightSelectedPointStyle}>
          BV {formatComputedNumber(bv)} / {axisLabel} {formatComputedNumber(axis)}
        </strong>
        <span style={hsWeightFormulaTextStyle}>
          <span>{thdLabel}:</span>
          <span style={hsWeightWetValueStyle}>{formatHsAreaReadoutValue(thdValue)}</span>
          <span>|</span>
          <span style={hsWeightInterpolatedValueStyle}>{formatComputedNumber(interpolatedThd)}</span>
        </span>
      </div>
      {expanded && <div style={hsDarkAreaBodyStyle}>
        {editableSource ? (
          <HsAreaGrid
            source={editableSource}
            selected={selected}
            editable={canEdit}
            cornerLabel={cornerLabel}
            columnLabel={axisLabel}
            onCellPreview={previewAreaCell}
            onCellCommit={updateAreaCell}
          />
        ) : (
          <div style={hsWeightPendingStyle}>loading...</div>
        )}
      </div>}
    </section>
  );
}

function HsAreaGrid({
  source,
  selected,
  editable,
  cornerLabel,
  columnLabel,
  onCellPreview,
  onCellCommit,
}: {
  source: HsAreaSource | null;
  selected: HsAreaSelection;
  editable: boolean;
  cornerLabel: string;
  columnLabel: string;
  onCellPreview?: (target: HsAreaCellTarget, value: string) => void;
  onCellCommit?: (target: HsAreaCellTarget, value: string) => boolean | void;
}) {
  const rowCount = Math.max(1, source?.rowCount ?? 1);
  const columnCount = Math.max(1, source?.columnCount ?? 1);

  return (
    <div style={hsDarkAreaTableWrapStyle}>
      <div style={hsDarkAreaGridStyle(columnCount)}>
        <div style={hsDarkAreaCornerStyle}>{cornerLabel}</div>
        {Array.from({ length: columnCount }, (_, columnIndex) => {
          const field = source?.columnHeaderFields[columnIndex] ?? null;
          const value = source?.columnHeaders[columnIndex] ?? NaN;
          return (
            <HsWeightEditableCell
              key={`column:${columnIndex}`}
              value={field?.value ?? formatHsAreaAxisValue(value, columnIndex, "C")}
              editable={editable && Boolean(field)}
              title={field ? `${source?.columnHeaderPath} #${columnIndex}` : columnLabel}
              style={hsDarkAreaColumnHeaderStyle(selected.columnIndexes.has(columnIndex))}
              onPreview={(nextValue) => onCellPreview?.({ kind: "columnHeader", columnIndex }, nextValue)}
              onCommit={(nextValue) => onCellCommit?.({ kind: "columnHeader", columnIndex }, nextValue)}
            />
          );
        })}
        {Array.from({ length: rowCount }, (_, rowIndex) => {
          const rowField = source?.rowHeaderFields[rowIndex] ?? null;
          const rowValue = source?.rowHeaders[rowIndex] ?? NaN;
          return (
            <Fragment key={`row:${rowIndex}`}>
              <HsWeightEditableCell
                value={rowField?.value ?? formatHsAreaAxisValue(rowValue, rowIndex, "R")}
                editable={editable && Boolean(rowField)}
                title={rowField ? `${source?.rowHeaderPath} #${rowIndex}` : "BV"}
                style={hsDarkAreaRowHeaderStyle(selected.rowIndexes.has(rowIndex))}
                onPreview={(nextValue) => onCellPreview?.({ kind: "rowHeader", rowIndex }, nextValue)}
                onCommit={(nextValue) => onCellCommit?.({ kind: "rowHeader", rowIndex }, nextValue)}
              />
              {Array.from({ length: columnCount }, (_, columnIndex) => {
                const field = source?.valueFields[rowIndex]?.[columnIndex] ?? null;
                const value = source?.values[rowIndex]?.[columnIndex] ?? NaN;
                const active = selected.rowIndexes.has(rowIndex) && selected.columnIndexes.has(columnIndex);
                return (
                  <HsWeightEditableCell
                    key={`cell:${rowIndex}:${columnIndex}`}
                    value={field?.value ?? formatHsAreaCellValue(value)}
                    editable={editable && Boolean(field)}
                    title={field ? `${source?.valuePath} #${rowIndex}:${columnIndex}` : "THD"}
                    style={hsDarkAreaDataCellStyle(active)}
                    onPreview={(nextValue) => onCellPreview?.({ kind: "value", rowIndex, columnIndex }, nextValue)}
                    onCommit={(nextValue) => onCellCommit?.({ kind: "value", rowIndex, columnIndex }, nextValue)}
                  />
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function ThresholdCompactReadout({ label, value, fillHeight = false }: { label: string; value: string; fillHeight?: boolean }) {
  return (
    <div style={compactReadoutStyle(fillHeight)}>
      <span style={compactReadoutLabelStyle}>{label}</span>
      <span style={compactReadoutValueStyle}>{value}</span>
    </div>
  );
}

function BindingIconButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={bindingIconButtonStyle}
    >
      <TableLink24Regular className="h-4 w-4" />
    </button>
  );
}

function BindingEditorPanel({
  title,
  entries,
  loading,
  message,
  onClose,
  onApply,
  onReset,
  onSourceJump,
}: {
  title: string;
  entries: BindingEntry[];
  loading: boolean;
  message: string | null;
  onClose: () => void;
  onApply: (entries: BindingEntry[]) => void | Promise<void>;
  onReset: () => void;
  onSourceJump?: (entry: BindingEntry) => void;
}) {
  const [draftEntries, setDraftEntries] = useState(entries);

  useEffect(() => {
    setDraftEntries(entries);
  }, [entries]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const updatePath = (id: string, path: string) => {
    setDraftEntries((current) =>
      current.map((entry) => entry.id === id ? { ...entry, path } : entry),
    );
  };

  return (
    <div style={bindingPanelBackdropStyle}>
      <div style={bindingPanelStyle}>
        <div style={bindingPanelHeaderStyle}>
          <strong>{title}</strong>
          <button type="button" onClick={onClose} style={bindingCloseButtonStyle}>×</button>
        </div>
        <div style={bindingPanelBodyStyle}>
          {draftEntries.map((entry) => {
            const path = entry.path.trim();
            const canJump = Boolean(onSourceJump && path);
            const jumpLabel = path ? `进入源码映射更换 paths：${path}` : "请先填写 paths";
            return (
              <div key={entry.id} style={bindingEntryStyle}>
                <div style={bindingEntryLabelStyle}>{entry.label}</div>
                <input
                  value={entry.path}
                  onChange={(event) => updatePath(entry.id, event.target.value)}
                  spellCheck={false}
                  style={bindingPathInputStyle}
                />
                <button
                  type="button"
                  aria-label={jumpLabel}
                  disabled={!canJump}
                  onClick={() => {
                    if (!canJump) return;
                    onSourceJump?.({ ...entry, path });
                  }}
                  style={bindingSourceJumpButtonStyle(canJump)}
                >
                  <Code24Regular className="h-4 w-4" />
                </button>
                <div style={bindingValuesStyle}>
                  [{entry.values.length > 0 ? entry.values.slice(0, 8).join(", ") : "-"}{entry.values.length > 8 ? ", ..." : ""}]
                </div>
              </div>
            );
          })}
        </div>
        <div style={bindingPanelFooterStyle}>
          <span style={bindingMessageStyle}>{message}</span>
          <button type="button" onClick={onReset} disabled={loading} style={bindingSecondaryButtonStyle}>恢复默认</button>
          <button type="button" onClick={() => void onApply(draftEntries)} disabled={loading} style={bindingPrimaryButtonStyle}>
            {loading ? "应用中..." : "应用"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ThresholdEditableCell({
  label,
  value,
  highlighted,
  editable,
  title,
  onCommit,
}: {
  label: MainTargetThresholdRow["label"];
  value: string;
  highlighted: boolean;
  editable: boolean;
  title: string;
  onCommit: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const resetDraft = () => {
    setDraftValue(value);
  };

  const commitDraft = () => {
    if (!editable) return;
    const nextValue = draftValue.trim();
    if (nextValue === value.trim()) return;
    onCommit(nextValue);
  };

  return (
    <td title={title} style={thresholdValueCellStyle(label, highlighted, focused, editable)}>
      <input
        aria-label={`${label}-${title}`}
        value={draftValue}
        readOnly={!editable}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          resetDraft();
        }}
        onChange={(event) => setDraftValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            resetDraft();
            event.currentTarget.blur();
          }
        }}
        inputMode="decimal"
        style={thresholdCellInputStyle(editable)}
      />
    </td>
  );
}

function ThresholdMetricButton({
  label,
  value,
  title,
  tooltipPositioning,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  value: string;
  title?: string;
  tooltipPositioning?: "below-center" | "above-center";
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const pulse = () => {
    setPressed(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setPressed(false);
      timerRef.current = null;
    }, 150);
  };

  const button = (
    <button
      type="button"
      disabled={disabled}
      aria-label={title ?? label}
      onClick={onClick && !disabled ? () => {
        pulse();
        onClick();
      } : undefined}
      onMouseDown={onClick && !disabled ? pulse : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={metricButtonStyle(active, pressed, hovered, Boolean(onClick), disabled)}
    >
      <span style={metricButtonLabelStyle(disabled)}>{label}</span>
      <span style={metricButtonValueStyle(disabled)}>{value}</span>
    </button>
  );

  if (!title) return button;
  return (
    <HoverTooltip content={title} positioning={tooltipPositioning ?? "below-center"} inline>
      {button}
    </HoverTooltip>
  );
}

function MidRatioChart({
  baseValue,
  expValue,
  thdMaxValue,
  midValue,
  corrDrMidratio,
  midCurvePoints,
  resetKey,
}: {
  baseValue: number;
  expValue: number;
  thdMaxValue: number;
  midValue: number;
  corrDrMidratio: number;
  midCurvePoints: Array<{ x: number; y: number }>;
  resetKey: number;
}) {
  const [draggedStartX, setDraggedStartX] = useState<number | null>(null);
  const [draggedEndX, setDraggedEndX] = useState<number | null>(null);
  const [draggedCurrentPoint, setDraggedCurrentPoint] = useState<{ x: number; y: number } | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<"start" | "end" | "current" | null>(null);

  useEffect(() => {
    setDraggedStartX(null);
    setDraggedEndX(null);
    setDraggedCurrentPoint(null);
  }, [baseValue, expValue, thdMaxValue, corrDrMidratio, resetKey]);

  const valid = Number.isFinite(baseValue) && Number.isFinite(expValue) && Number.isFinite(thdMaxValue);
  const xMin = 0;
  const xMax = 1024;
  const yBase = Number.isFinite(baseValue) ? baseValue : 0;
  const safeThdMax = Number.isFinite(thdMaxValue) ? thdMaxValue : yBase;
  const startX = clamp(draggedStartX ?? 400, xMin, draggedEndX ?? 800);
  const endX = clamp(draggedEndX ?? 800, startX, xMax);
  const segmentMidPoints = useMemo(
    () => buildSegmentedMidPoints(midCurvePoints, startX, endX),
    [midCurvePoints, startX, endX],
  );
  const yAt = (x: number) => {
    return computeSegmentedThd(x, yBase, expValue, safeThdMax, segmentMidPoints, midValue, startX, endX);
  };
  const defaultCurrentX = Number.isFinite(corrDrMidratio) ? clamp(corrDrMidratio, xMin, xMax) : startX;
  const currentPointX = draggedCurrentPoint?.x ?? defaultCurrentX;
  const rawCurrentPointY = yAt(currentPointX);
  const currentPointY = Number.isFinite(rawCurrentPointY) ? rawCurrentPointY : yBase;
  const segmentCollapsed = Math.abs(endX - startX) < 0.5;
  const curvePoints = segmentCollapsed
    ? [
      { x: xMin, y: yBase },
      { x: startX, y: yBase },
      { x: startX, y: safeThdMax },
      { x: xMax, y: safeThdMax },
    ]
    : uniqueSortedNumbers([
      xMin,
      startX,
      ...Array.from({ length: 161 }, (_, idx) => startX + ((endX - startX) * idx) / 160),
      endX,
      currentPointX,
      xMax,
      ...segmentMidPoints.map((point) => point.x),
    ])
      .filter((x) => x >= xMin && x <= xMax)
      .map((x) => ({ x, y: yAt(x) }))
      .filter((point) => Number.isFinite(point.y));
  const yValues = curvePoints.map((point) => point.y).filter(Number.isFinite);
  const yGap = Math.max(Math.abs(safeThdMax - yBase), Math.abs(currentPointY - yBase), 1);
  const yMin = Math.max(0, Math.min(yBase, currentPointY, ...yValues) - yGap * 0.65);
  const yMax = Math.max(safeThdMax, currentPointY, ...yValues, 1) + yGap * 0.42;
  const chart = {
    left: 66,
    top: 20,
    right: 28,
    bottom: 38,
    width: 420,
    height: 190,
  };
  const plotW = chart.width - chart.left - chart.right;
  const plotH = chart.height - chart.top - chart.bottom;
  const xToPx = (x: number) => chart.left + (clamp(x, xMin, xMax) - xMin) / (xMax - xMin) * plotW;
  const yToPx = (y: number) => {
    const span = yMax === yMin ? 1 : yMax - yMin;
    return chart.top + (1 - (y - yMin) / span) * plotH;
  };
  const curvePath = valid ? buildSvgPath(curvePoints, xToPx, yToPx) : "";
  const baseY = yToPx(yBase);
  const maxY = yToPx(safeThdMax);
  const axisY = chart.top + plotH;
  const firstPointX = xToPx(startX);
  const endPointX = xToPx(endX);
  const currentX = xToPx(currentPointX);
  const currentY = yToPx(currentPointY);
  const currentLabelX = clamp(currentX, chart.left + 30, chart.left + plotW - 30);
  const currentLabelY = Math.max(chart.top + 24, currentY - 9);
  const boundaryXs = segmentCollapsed
    ? [{ key: "joint" as const, value: startX, x: firstPointX, y: baseY, label: formatRatioTick(startX) }]
    : [
      { key: "start" as const, value: startX, x: firstPointX, y: baseY, label: formatRatioTick(startX) },
      { key: "end" as const, value: endX, x: endPointX, y: maxY, label: formatRatioTick(endX) },
    ];
  const boundaryLabelX = (x: number) => {
    const leftGuard = chart.left + 6;
    const rightGuard = chart.left + plotW - 6;
    return x <= chart.left + 52
      ? clamp(x + 6, leftGuard, rightGuard)
      : clamp(x - 6, leftGuard, rightGuard);
  };
  const boundaryLabelAnchor = (x: number) => x <= chart.left + 52 ? "start" : "end";
  const axisLabelX = chart.width - 12;
  const clientToChartValue = (clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const svgX = ((clientX - rect.left) / rect.width) * chart.width;
    const svgY = ((clientY - rect.top) / rect.height) * chart.height;
    return {
      x: xMin + ((svgX - chart.left) / plotW) * (xMax - xMin),
      y: yMin + (1 - (svgY - chart.top) / plotH) * (yMax - yMin),
    };
  };
  const updateBoundaryFromClientX = (kind: "start" | "end", clientX: number, svg: SVGSVGElement | null) => {
    const value = clientToChartValue(clientX, 0, svg);
    if (!value) return;
    if (kind === "start") {
      setDraggedStartX(clamp(value.x, xMin, endX));
    } else {
      setDraggedEndX(clamp(value.x, startX, xMax));
    }
  };
  const updateCurrentPointFromClient = (clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    const value = clientToChartValue(clientX, clientY, svg);
    if (!value) return;
    const nextX = clamp(value.x, xMin, xMax);
    setDraggedCurrentPoint({
      x: nextX,
      y: yAt(nextX),
    });
  };
  const releasePointer = (event: PointerEvent<SVGCircleElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingPoint(null);
  };

  return (
    <div style={chartWrapStyle}>
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} style={chartSvgStyle} role="img" aria-label="Main THD chart">
        <text x={12} y={17} textAnchor="start" style={chartTitleTextStyle}>Main THD</text>
        <line x1={chart.left} y1={axisY} x2={chart.left} y2={chart.top + 16} style={chartAxisLineStyle} />
        <line x1={chart.left} y1={axisY} x2={chart.left + plotW + 10} y2={axisY} style={chartAxisLineStyle} />
        <path d={`M ${chart.left} ${chart.top + 10} L ${chart.left - 4} ${chart.top + 17} L ${chart.left + 4} ${chart.top + 17} Z`} style={chartArrowStyle} />
        <path d={`M ${chart.left + plotW + 15} ${axisY} L ${chart.left + plotW + 7} ${axisY - 4} L ${chart.left + plotW + 7} ${axisY + 4} Z`} style={chartArrowStyle} />
        <line x1={chart.left} y1={maxY} x2={endPointX} y2={maxY} style={chartMaxLineStyle} />
        {boundaryXs.map((item) => (
          <g key={item.value}>
            <line x1={item.x} y1={item.y} x2={item.x} y2={axisY} style={chartBoundaryLineStyle} />
            <text x={boundaryLabelX(item.x)} y={axisY + 14} textAnchor={boundaryLabelAnchor(item.x)} style={chartAxisTextStyle}>{item.label}</text>
          </g>
        ))}
        {curvePath && <path d={curvePath} style={chartCurveStyle} />}
        <line x1={chart.left} y1={currentY} x2={currentX} y2={currentY} style={chartCurrentGuideLineStyle} />
        <line x1={currentX} y1={currentY} x2={currentX} y2={axisY} style={chartCurrentGuideLineStyle} />
        <text x={currentX} y={axisY + 28} textAnchor="middle" style={chartCurrentValueTextStyle}>
          {formatRatioTick(currentPointX)}
        </text>
        <text x={currentLabelX} y={currentLabelY} textAnchor="middle" style={chartCurrentValueTextStyle}>
          {formatThresholdNumber(currentPointY)}
        </text>
        <circle cx={firstPointX} cy={baseY} r={3.8} style={chartDragPointStyle(draggingPoint === "start")} />
        <circle cx={endPointX} cy={maxY} r={3.8} style={chartDragPointStyle(draggingPoint === "end")} />
        <circle cx={currentX} cy={currentY} r={3.4} style={chartCurrentPointStyle} />
        <circle
          cx={firstPointX}
          cy={baseY}
          r={12}
          style={chartHorizontalDragHitStyle}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraggingPoint("start");
            updateBoundaryFromClientX("start", event.clientX, event.currentTarget.ownerSVGElement);
          }}
          onPointerMove={(event) => {
            if (draggingPoint !== "start") return;
            updateBoundaryFromClientX("start", event.clientX, event.currentTarget.ownerSVGElement);
          }}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
        />
        <circle
          cx={endPointX}
          cy={maxY}
          r={12}
          style={chartHorizontalDragHitStyle}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraggingPoint("end");
            updateBoundaryFromClientX("end", event.clientX, event.currentTarget.ownerSVGElement);
          }}
          onPointerMove={(event) => {
            if (draggingPoint !== "end") return;
            updateBoundaryFromClientX("end", event.clientX, event.currentTarget.ownerSVGElement);
          }}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
        />
        <circle
          cx={currentX}
          cy={currentY}
          r={13}
          style={chartFreeDragHitStyle}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraggingPoint("current");
            updateCurrentPointFromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement);
          }}
          onPointerMove={(event) => {
            if (draggingPoint !== "current") return;
            updateCurrentPointFromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement);
          }}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
        />
        <text x={chart.left - 10} y={maxY + 4} textAnchor="end" style={chartValueTextStyle}>{formatThresholdNumber(safeThdMax)}</text>
        <text x={chart.left - 10} y={baseY + 4} textAnchor="end" style={chartValueTextStyle}>{formatThresholdNumber(yBase)}</text>
        <text x={axisLabelX} y={axisY - 7} textAnchor="end" style={chartAxisTextStyle}>corr_dr_midratio</text>
      </svg>
    </div>
  );
}

function B2dRatioChart({
  points,
  b2dValue,
  titleText,
  formulaText,
  maxReferenceValue,
  xAxisLabel = "B2D",
  xMaxFloor = 12000,
  showFormula = true,
}: {
  points: Array<{ x: number; y: number }>;
  b2dValue: number;
  titleText: string;
  formulaText: (ratio: number) => string;
  maxReferenceValue?: number;
  xAxisLabel?: string;
  xMaxFloor?: number;
  showFormula?: boolean;
}) {
  const sourcePoints = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x)
    .slice(0, 2);
  const [draggedPoints, setDraggedPoints] = useState<Array<{ x: number; y: number }> | null>(null);
  const [draggedCurrentX, setDraggedCurrentX] = useState<number | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<"current" | null>(null);

  useEffect(() => {
    setDraggedPoints(null);
    setDraggedCurrentX(null);
    setDraggingPoint(null);
  }, [b2dValue, points]);

  const keyPoints = normalizeB2dKeyPoints(draggedPoints ?? sourcePoints);
  const valid = keyPoints.length === 2;
  const [leftPoint, rightPoint] = valid ? keyPoints : [{ x: 0, y: 1024 }, { x: 1024, y: 1024 }];
  const currentXValue = draggedCurrentX ?? (Number.isFinite(b2dValue) ? b2dValue : leftPoint.x);
  const currentYValue = valid ? b2dFunctionValue(currentXValue, leftPoint, rightPoint) : NaN;
  const sourceMaxX = Math.max(1024, currentXValue, ...sourcePoints.map((point) => point.x));
  const sourceMaxY = Math.max(1024, currentYValue, maxReferenceValue ?? 0, ...sourcePoints.map((point) => point.y));
  const xMin = 0;
  const xMax = Math.max(xMaxFloor, sourceMaxX * 1.18, rightPoint.x * 1.12, 1024);
  const yMin = 0;
  const yMax = Math.max(sourceMaxY * 1.12, leftPoint.y, rightPoint.y, 1024);
  const chart = {
    left: 50,
    top: showFormula ? 44 : 30,
    right: 18,
    bottom: 28,
    width: 460,
    height: 210,
  };
  const plotW = chart.width - chart.left - chart.right;
  const plotH = chart.height - chart.top - chart.bottom;
  const axisY = chart.top + plotH;
  const visualP1X = chart.left + plotW * 0.18;
  const visualP2X = chart.left + plotW * 0.64;
  const visualHighY = chart.top + plotH * 0.14;
  const yVisualHighValue = Math.max(leftPoint.y, rightPoint.y);
  const yVisualLowValue = Math.min(leftPoint.y, rightPoint.y);
  const lowValueOnAxis = yVisualLowValue <= yMin + 0.0001;
  const visualLowY = lowValueOnAxis ? axisY : axisY - plotH * 0.22;
  const xToPx = (x: number) => {
    if (!valid) return chart.left + (clamp(x, xMin, xMax) - xMin) / Math.max(1, xMax - xMin) * plotW;
    if (x <= leftPoint.x) {
      return chart.left + (clamp(x, xMin, leftPoint.x) - xMin) / Math.max(1, leftPoint.x - xMin) * (visualP1X - chart.left);
    }
    if (x >= rightPoint.x) {
      return visualP2X + (clamp(x, rightPoint.x, xMax) - rightPoint.x) / Math.max(1, xMax - rightPoint.x) * (chart.left + plotW - visualP2X);
    }
    return visualP1X + (x - leftPoint.x) / Math.max(1, rightPoint.x - leftPoint.x) * (visualP2X - visualP1X);
  };
  const yToPx = (y: number) => {
    if (!valid || yVisualHighValue === yVisualLowValue) {
      return chart.top + (1 - (y - yMin) / Math.max(1, yMax - yMin)) * plotH;
    }
    const ratio = (clamp(y, yVisualLowValue, yVisualHighValue) - yVisualLowValue) / Math.max(1, yVisualHighValue - yVisualLowValue);
    return visualLowY - ratio * (visualLowY - visualHighY);
  };
  const shouldShowPointYTick = (value: number) => Number.isFinite(value) && Math.abs(value - yMin) > 0.0001;
  const curvePoints = valid
    ? [
      { x: xMin, y: leftPoint.y },
      leftPoint,
      rightPoint,
      { x: xMax, y: rightPoint.y },
    ]
    : [];
  const curvePath = valid ? buildSvgPath(curvePoints, xToPx, yToPx) : "";
  const currentX = xToPx(clamp(currentXValue, xMin, xMax));
  const currentY = yToPx(currentYValue);
  const currentLabelToRight = Number.isFinite(currentX) ? currentX < chart.left + plotW * 0.72 : true;
  const currentLabelX = Number.isFinite(currentX)
    ? clamp(currentX + (currentLabelToRight ? 22 : -22), chart.left + 30, chart.left + plotW - 30)
    : chart.left + plotW / 2;
  const currentLabelY = Number.isFinite(currentY)
    ? currentY > chart.top + 28
      ? currentY - 16
      : currentY + 22
    : chart.top + 32;
  const currentLabelAnchor = currentLabelToRight ? "start" : "end";
  const clientToChartValue = (clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const svgX = ((clientX - rect.left) / rect.width) * chart.width;
    const svgY = ((clientY - rect.top) / rect.height) * chart.height;
    const x = !valid
      ? xMin + ((svgX - chart.left) / plotW) * (xMax - xMin)
      : svgX <= visualP1X
        ? xMin + ((svgX - chart.left) / Math.max(1, visualP1X - chart.left)) * (leftPoint.x - xMin)
        : svgX >= visualP2X
          ? rightPoint.x + ((svgX - visualP2X) / Math.max(1, chart.left + plotW - visualP2X)) * (xMax - rightPoint.x)
          : leftPoint.x + ((svgX - visualP1X) / Math.max(1, visualP2X - visualP1X)) * (rightPoint.x - leftPoint.x);
    const y = !valid || yVisualHighValue === yVisualLowValue
      ? yMin + (1 - (svgY - chart.top) / plotH) * (yMax - yMin)
      : yVisualLowValue + ((visualLowY - svgY) / Math.max(1, visualLowY - visualHighY)) * (yVisualHighValue - yVisualLowValue);
    return {
      x,
      y,
    };
  };
  const updateCurrentPointFromClient = (clientX: number, svg: SVGSVGElement | null) => {
    const value = clientToChartValue(clientX, 0, svg);
    if (!value || !valid) return;
    setDraggedCurrentX(clamp(value.x, xMin, xMax));
  };
  const releasePointer = (event: PointerEvent<SVGCircleElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingPoint(null);
  };
  const formula = showFormula ? formulaText(currentYValue) : "";

  return (
    <div style={chartWrapStyle}>
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} style={chartSvgStyle} role="img" aria-label={`${titleText} chart`}>
        <text x={12} y={18} textAnchor="start" style={b2dChartTitleTextStyle}>{titleText}</text>
        {showFormula && (
          <foreignObject x={chart.left + 84} y={5} width={chart.width - chart.left - chart.right - 86} height={38}>
            <div style={b2dFormulaTextStyle}>{formula}</div>
          </foreignObject>
        )}
        <line x1={chart.left} y1={axisY} x2={chart.left} y2={chart.top + 8} style={b2dAxisLineStyle} />
        <line x1={chart.left} y1={axisY} x2={chart.left + plotW + 10} y2={axisY} style={b2dAxisLineStyle} />
        <path d={`M ${chart.left} ${chart.top + 2} L ${chart.left - 4} ${chart.top + 10} L ${chart.left + 4} ${chart.top + 10} Z`} style={b2dArrowStyle} />
        <path d={`M ${chart.left + plotW + 15} ${axisY} L ${chart.left + plotW + 7} ${axisY - 4} L ${chart.left + plotW + 7} ${axisY + 4} Z`} style={b2dArrowStyle} />
        {curvePath ? (
          <>
            <line x1={xToPx(leftPoint.x)} y1={yToPx(leftPoint.y)} x2={xToPx(leftPoint.x)} y2={axisY} style={b2dGuideLineStyle} />
            {shouldShowPointYTick(rightPoint.y) && (
              <line x1={chart.left} y1={yToPx(rightPoint.y)} x2={xToPx(rightPoint.x)} y2={yToPx(rightPoint.y)} style={b2dGuideLineStyle} />
            )}
            <line x1={xToPx(rightPoint.x)} y1={yToPx(rightPoint.y)} x2={xToPx(rightPoint.x)} y2={axisY} style={b2dGuideLineSoftStyle} />
            <path d={curvePath} style={b2dCurveStyle} />
            {keyPoints.map((point, index) => (
              <g key={`${point.x}:${point.y}:${index}`}>
                <circle cx={xToPx(point.x)} cy={yToPx(point.y)} r={3.6} style={chartDragPointStyle(false)} />
              </g>
            ))}
          </>
        ) : (
          <text x={chart.left + plotW / 2} y={chart.top + plotH / 2} textAnchor="middle" style={chartAxisTextStyle}>
            No B2D source data
          </text>
        )}
        {Number.isFinite(currentXValue) && Number.isFinite(currentYValue) && (
          <>
            <line x1={chart.left} y1={currentY} x2={currentX} y2={currentY} style={chartCurrentGuideLineStyle} />
            <line x1={currentX} y1={currentY} x2={currentX} y2={axisY} style={chartCurrentGuideLineStyle} />
            <circle cx={currentX} cy={currentY} r={3.6} style={chartCurrentPointStyle} />
            <text x={currentX} y={axisY + 27} textAnchor="middle" style={chartCurrentValueTextStyle}>
              {formatComputedNumber(currentXValue)}
            </text>
            <text x={currentLabelX} y={currentLabelY} textAnchor={currentLabelAnchor} style={chartCurrentValueTextStyle}>
              {formatRatioTick(currentYValue)}
            </text>
          </>
        )}
        {valid && (
          <>
            {shouldShowPointYTick(leftPoint.y) && (
              <text x={chart.left - 8} y={yToPx(leftPoint.y) + 4} textAnchor="end" style={b2dTickTextStyle}>
                {formatRatioPercent(leftPoint.y)}
              </text>
            )}
            {shouldShowPointYTick(rightPoint.y) && Math.abs(rightPoint.y - leftPoint.y) > 0.0001 && (
              <text x={chart.left - 8} y={yToPx(rightPoint.y) + 4} textAnchor="end" style={b2dTickTextStyle}>
                {formatRatioPercent(rightPoint.y)}
              </text>
            )}
            <text x={xToPx(leftPoint.x)} y={axisY + 16} textAnchor="middle" style={b2dTickTextStyle}>
              {formatComputedNumber(leftPoint.x)}
            </text>
            <text x={xToPx(rightPoint.x)} y={axisY + 16} textAnchor="middle" style={b2dTickTextStyle}>
              {formatComputedNumber(rightPoint.x)}
            </text>
          </>
        )}
        <text x={chart.left - 8} y={axisY + 4} textAnchor="end" style={b2dTickTextStyle}>{formatRatioPercent(yMin)}</text>
        <text x={chart.width - 12} y={axisY - 7} textAnchor="end" style={b2dXAxisLabelStyle}>{xAxisLabel}</text>
        {valid && Number.isFinite(currentX) && Number.isFinite(currentY) && (
          <circle
            cx={currentX}
            cy={currentY}
            r={13}
            style={chartFreeDragHitStyle}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDraggingPoint("current");
              updateCurrentPointFromClient(event.clientX, event.currentTarget.ownerSVGElement);
            }}
            onPointerMove={(event) => {
              if (draggingPoint !== "current") return;
              updateCurrentPointFromClient(event.clientX, event.currentTarget.ownerSVGElement);
            }}
            onPointerUp={releasePointer}
            onPointerCancel={releasePointer}
          />
        )}
      </svg>
    </div>
  );
}

function ThresholdValueControl({
  label,
  value,
  valueTitle,
  labelButtonTitle,
  labelActive = false,
  valueActive = false,
  editable = false,
  onChange,
  onWheelStep,
  onLabelClick,
  onValueClick,
  onValueContextMenu,
  showSteppers = false,
}: {
  label: string;
  value: string;
  valueTitle?: string;
  labelButtonTitle?: string;
  labelActive?: boolean;
  valueActive?: boolean;
  editable?: boolean;
  onChange?: (value: string) => void;
  onWheelStep?: (delta: number) => void;
  onLabelClick?: () => void;
  onValueClick?: () => void;
  onValueContextMenu?: () => void;
  showSteppers?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [pressedStep, setPressedStep] = useState<StepperDirection | null>(null);
  const [labelPressed, setLabelPressed] = useState(false);
  const [valuePressed, setValuePressed] = useState(false);
  const valueAreaRef = useRef<HTMLSpanElement>(null);
  const onWheelStepRef = useRef(onWheelStep);
  const stepPressTimerRef = useRef<number | null>(null);
  const labelPressTimerRef = useRef<number | null>(null);
  const valuePressTimerRef = useRef<number | null>(null);

  const pulseStep = (direction: StepperDirection) => {
    setPressedStep(direction);
    if (stepPressTimerRef.current !== null) {
      window.clearTimeout(stepPressTimerRef.current);
    }
    stepPressTimerRef.current = window.setTimeout(() => {
      setPressedStep(null);
      stepPressTimerRef.current = null;
    }, 130);
  };
  const pulseLabel = () => {
    setLabelPressed(true);
    if (labelPressTimerRef.current !== null) {
      window.clearTimeout(labelPressTimerRef.current);
    }
    labelPressTimerRef.current = window.setTimeout(() => {
      setLabelPressed(false);
      labelPressTimerRef.current = null;
    }, 160);
  };
  const pulseValue = () => {
    setValuePressed(true);
    if (valuePressTimerRef.current !== null) {
      window.clearTimeout(valuePressTimerRef.current);
    }
    valuePressTimerRef.current = window.setTimeout(() => {
      setValuePressed(false);
      valuePressTimerRef.current = null;
    }, 140);
  };

  useEffect(() => {
    onWheelStepRef.current = onWheelStep;
  }, [onWheelStep]);

  useEffect(() => {
    return () => {
      if (stepPressTimerRef.current !== null) {
        window.clearTimeout(stepPressTimerRef.current);
      }
      if (labelPressTimerRef.current !== null) {
        window.clearTimeout(labelPressTimerRef.current);
      }
      if (valuePressTimerRef.current !== null) {
        window.clearTimeout(valuePressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const valueArea = valueAreaRef.current;
    if (!editable || !valueArea) return;

    const handleWheel = (event: globalThis.WheelEvent) => {
      const stepHandler = onWheelStepRef.current;
      if (!stepHandler) return;
      event.preventDefault();
      event.stopPropagation();
      const direction: StepperDirection = event.deltaY < 0 ? "up" : "down";
      pulseStep(direction);
      stepHandler(direction === "up" ? 1 : -1);
    };

    valueArea.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => {
      valueArea.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [editable]);

  const step = (delta: number) => {
    if (!editable || !onWheelStep) return;
    pulseStep(delta > 0 ? "up" : "down");
    onWheelStep(delta);
  };

  const valueArea = (
    <span
      ref={valueAreaRef}
      style={thresholdValueAreaStyle(editable, focused, valuePressed, Boolean(onValueClick || onValueContextMenu), valueActive)}
      onClick={onValueClick ? () => {
        pulseValue();
        onValueClick();
      } : undefined}
      onContextMenu={onValueContextMenu ? (event) => {
        event.preventDefault();
        pulseValue();
        onValueContextMenu();
      } : undefined}
    >
      <input
        aria-label={label}
        value={value}
        readOnly={!editable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange?.(event.target.value)}
        inputMode="decimal"
        style={thresholdInputStyle}
      />
      {showSteppers && (
        <span style={stepperWrapStyle}>
          <button
            type="button"
            aria-label="increase bv"
            onMouseDown={(event) => {
              event.preventDefault();
              pulseStep("up");
            }}
            onClick={() => step(1)}
            style={stepperButtonStyle("up", pressedStep === "up")}
          >
            <span style={stepperTriangleStyle("up")} />
          </button>
          <button
            type="button"
            aria-label="decrease bv"
            onMouseDown={(event) => {
              event.preventDefault();
              pulseStep("down");
            }}
            onClick={() => step(-1)}
            style={stepperButtonStyle("down", pressedStep === "down")}
          >
            <span style={stepperTriangleStyle("down")} />
          </button>
        </span>
      )}
    </span>
  );

  return (
    <div style={thresholdControlStyle}>
      {onLabelClick ? (
        <button
          type="button"
          title={labelButtonTitle}
          aria-label={labelButtonTitle ?? label}
          onClick={() => {
            pulseLabel();
            onLabelClick();
          }}
          style={thresholdControlLabelButtonStyle(labelPressed, labelActive)}
        >
          {label}
        </button>
      ) : (
        <span style={thresholdControlLabelStyle}>{label}</span>
      )}
      {valueTitle ? (
        <HoverTooltip content={valueTitle} positioning="above-center" inline>
          {valueArea}
        </HoverTooltip>
      ) : valueArea}
    </div>
  );
}

function groupRows(fields: FieldEntry[]): ChartRow[] {
  const byLine = new Map<number, FieldEntry[]>();
  for (const field of fields) {
    const current = byLine.get(field.line) ?? [];
    current.push(field);
    byLine.set(field.line, current);
  }

  return Array.from(byLine.entries()).map(([line, rowFields]) => {
    rowFields.sort((a, b) => a.index - b.index || a.path.localeCompare(b.path));
    const first = rowFields[0];
    return {
      id: `${line}:${first.path}`,
      line,
      label: cleanLabel(first.comment) || pathTail(first.path) || `L${line}`,
      path: first.path,
      values: rowFields.map((field) => field.value),
    };
  });
}

function buildMtwvRows(path: string, fields: FieldEntry[]): MtwvTableRow[] {
  const byLine = new Map<number, FieldEntry[]>();
  for (const field of fields) {
    const current = byLine.get(field.line) ?? [];
    current.push(field);
    byLine.set(field.line, current);
  }

  const rows = Array.from(byLine.entries())
    .sort(([leftLine], [rightLine]) => leftLine - rightLine)
    .map(([line, rowFields], rowIndex) => {
      rowFields.sort((a, b) => a.index - b.index || a.path.localeCompare(b.path));
      const first = rowFields[0];
      return {
        id: `${path}:${line}:${rowIndex}`,
        line,
        path: first?.path ?? path,
        values: rowFields.map((field) => field.value),
        fields: rowFields,
      };
    });

  return rows.length > 0
    ? rows
    : [{ id: `${path}:empty`, line: 0, path, values: ["-"], fields: [] }];
}

function buildMtwvMatrix(rows: MtwvTableRow[], maxColumns: number): number[][] {
  return rows.map((row) =>
    Array.from({ length: maxColumns }, (_, cellIndex) => parseFiniteNumber(row.values[cellIndex])),
  );
}

function summariseMtwvMatrix(matrix: number[][]): {
  rowCount: number;
  columnCount: number;
  sum: number;
  min: number;
  max: number;
  average: number;
  center: number;
} {
  const rowCount = matrix.length;
  const columnCount = Math.max(0, ...matrix.map((row) => row.length));
  const values = matrix.flat().filter(Number.isFinite);
  const sum = values.reduce((total, value) => total + value, 0);
  const min = values.length > 0 ? Math.min(...values) : NaN;
  const max = values.length > 0 ? Math.max(...values) : NaN;
  const average = values.length > 0 ? sum / values.length : NaN;
  const center = matrix[Math.floor(rowCount / 2)]?.[Math.floor(columnCount / 2)] ?? NaN;
  return { rowCount, columnCount, sum, min, max, average, center };
}

function mtwvCellIntensity(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max <= min) return 0.72;
  return clamp((value - min) / (max - min), 0, 1);
}

function positiveLength(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.trunc(value)) : null;
}

function positiveIntegerFieldValue(fields: FieldEntry[]): number | null {
  for (const field of numericFieldEntries(fields)) {
    const value = positiveLength(parseFiniteNumber(field.value));
    if (value !== null) return value;
  }
  return null;
}

function inferHsAreaMatrixShape(
  fields: FieldEntry[],
  valuePath: string,
): { rowCount: number | null; columnCount: number | null } {
  let maxRowIndex = -1;
  let maxColumnIndex = -1;
  for (const field of fields) {
    const location = hsAreaMatrixFieldLocation(field.path, valuePath);
    if (!location) continue;
    maxRowIndex = Math.max(maxRowIndex, location.rowIndex);
    maxColumnIndex = Math.max(maxColumnIndex, location.columnIndex);
  }
  return {
    rowCount: maxRowIndex >= 0 ? maxRowIndex + 1 : null,
    columnCount: maxColumnIndex >= 0 ? maxColumnIndex + 1 : null,
  };
}

function buildHsAreaAxis(
  fields: FieldEntry[],
  count: number,
): { values: number[]; fields: Array<FieldEntry | null> } {
  return {
    values: Array.from({ length: count }, (_, index) => parseFiniteNumber(fields[index]?.value)),
    fields: Array.from({ length: count }, (_, index): FieldEntry | null => fields[index] ?? null),
  };
}

function buildHsAreaMatrix(
  fields: FieldEntry[],
  rowCount: number,
  columnCount: number,
  valuePath: string,
): { values: number[][]; fields: Array<Array<FieldEntry | null>> } {
  const values = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => NaN),
  );
  const matrixFields: Array<Array<FieldEntry | null>> = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, (): FieldEntry | null => null),
  );
  let usedStructuredPath = false;

  for (const field of fields) {
    const location = hsAreaMatrixFieldLocation(field.path, valuePath);
    if (!location) continue;
    const { rowIndex, columnIndex } = location;
    if (rowIndex < 0 || rowIndex >= rowCount || columnIndex < 0 || columnIndex >= columnCount) continue;
    values[rowIndex][columnIndex] = parseFiniteNumber(field.value);
    matrixFields[rowIndex][columnIndex] = field;
    usedStructuredPath = true;
  }

  if (!usedStructuredPath) {
    fields.slice(0, rowCount * columnCount).forEach((field, index) => {
      const rowIndex = Math.floor(index / columnCount);
      const columnIndex = index % columnCount;
      values[rowIndex][columnIndex] = parseFiniteNumber(field.value);
      matrixFields[rowIndex][columnIndex] = field;
    });
  }

  return { values, fields: matrixFields };
}

function hsAreaMatrixFieldLocation(path: string, valuePath: string): { rowIndex: number; columnIndex: number } | null {
  const indexes = childIndexesAfterPrefix(path, valuePath);
  const directIndex = directValueIndex(path);
  if (indexes.length >= 2) {
    return { rowIndex: indexes[0], columnIndex: indexes[1] };
  }
  if (indexes.length === 1 && directIndex >= 0) {
    return { rowIndex: indexes[0], columnIndex: directIndex };
  }
  return null;
}

interface HsWeightSelection {
  bvIndexes: Set<number>;
  drIndexesByBv: Map<number, Set<number>>;
  midIndexes: Set<number>;
}

interface HsAreaSelection {
  rowIndexes: Set<number>;
  columnIndexes: Set<number>;
}

function numericFieldEntries(fields: FieldEntry[]): FieldEntry[] {
  return fields
    .slice()
    .sort(compareFieldEntries)
    .filter((field) => Number.isFinite(parseFiniteNumber(field.value)));
}

function buildHsWeightValues(
  valueFields: FieldEntry[],
  bvCount: number,
  midCount: number,
): {
  values: number[][][][];
  fields: Array<Array<Array<Array<FieldEntry | null>>>>;
} {
  const channelCount = HS_WEIGHT_CHANNELS.length;
  const structured: Array<{
    bvIndex: number;
    drIndex: number;
    midIndex: number;
    channelIndex: number;
    value: number;
    field: FieldEntry;
  }> = [];
  let maxBvIndex = -1;
  let maxDrIndex = -1;
  let maxMidIndex = -1;

  for (const field of valueFields) {
    const indexes = childIndexesAfterPrefix(field.path, HS_WEIGHT_VALUE_PATH);
    const channelIndex = directValueIndex(field.path);
    const value = parseFiniteNumber(field.value);
    if (indexes.length < 3 || channelIndex < 0 || channelIndex >= channelCount || !Number.isFinite(value)) continue;
    const [bvIndex, drIndex, midIndex] = indexes;
    structured.push({ bvIndex, drIndex, midIndex, channelIndex, value, field });
    maxBvIndex = Math.max(maxBvIndex, bvIndex);
    maxDrIndex = Math.max(maxDrIndex, drIndex);
    maxMidIndex = Math.max(maxMidIndex, midIndex);
  }

  if (structured.length > 0) {
    const resolvedBvCount = Math.max(bvCount, maxBvIndex + 1);
    const resolvedMidCount = Math.max(midCount, maxMidIndex + 1);
    const drCounts = Array.from({ length: resolvedBvCount }, () => 0);
    for (const item of structured) {
      drCounts[item.bvIndex] = Math.max(drCounts[item.bvIndex] ?? 0, item.drIndex + 1);
    }
    const fallbackDrCount = Math.max(1, maxDrIndex + 1);
    const values = Array.from({ length: resolvedBvCount }, (_, bvIndex) =>
      Array.from({ length: Math.max(1, drCounts[bvIndex] || fallbackDrCount) }, () =>
        Array.from({ length: resolvedMidCount }, () =>
          Array.from({ length: channelCount }, () => NaN),
        ),
      ),
    );
    const fields: Array<Array<Array<Array<FieldEntry | null>>>> = Array.from({ length: resolvedBvCount }, (_, bvIndex) =>
      Array.from({ length: Math.max(1, drCounts[bvIndex] || fallbackDrCount) }, () =>
        Array.from({ length: resolvedMidCount }, () =>
          Array.from({ length: channelCount }, (): FieldEntry | null => null),
        ),
      ),
    );
    for (const item of structured) {
      values[item.bvIndex][item.drIndex][item.midIndex][item.channelIndex] = item.value;
      fields[item.bvIndex][item.drIndex][item.midIndex][item.channelIndex] = item.field;
    }
    return { values, fields };
  }

  const valueEntries = numericFieldEntries(valueFields);
  const valueFlat = valueEntries.map((field) => parseFiniteNumber(field.value));
  const drPerBv = Math.max(1, Math.floor(valueFlat.length / Math.max(1, bvCount * midCount * channelCount)));
  const values = Array.from({ length: bvCount }, (_, bvIndex) =>
    Array.from({ length: drPerBv }, (_, drIndex) =>
      Array.from({ length: midCount }, (_, midIndex) => {
        const base = ((bvIndex * drPerBv + drIndex) * midCount + midIndex) * channelCount;
        return Array.from({ length: channelCount }, (_, channelIndex) => valueFlat[base + channelIndex] ?? NaN);
      }),
    ),
  );
  const fields: Array<Array<Array<Array<FieldEntry | null>>>> = Array.from({ length: bvCount }, (_, bvIndex) =>
    Array.from({ length: drPerBv }, (_, drIndex) =>
      Array.from({ length: midCount }, (_, midIndex) => {
        const base = ((bvIndex * drPerBv + drIndex) * midCount + midIndex) * channelCount;
        return Array.from({ length: channelCount }, (_, channelIndex): FieldEntry | null =>
          valueEntries[base + channelIndex] ?? null,
        );
      }),
    ),
  );
  return { values, fields };
}

function buildHsDrB2dRows(
  drFields: FieldEntry[],
  values: number[][][][],
): {
  rows: number[][];
  fields: Array<Array<FieldEntry | null>>;
} {
  const bvCount = values.length;
  const rowCounts = values.map((bvRows) => Math.max(1, bvRows.length));
  const maxRowCount = Math.max(1, ...rowCounts);
  const flatEntries = numericFieldEntries(drFields);
  const flat = flatEntries.map((field) => parseFiniteNumber(field.value));
  const grouped = new Map<number, FieldEntry[]>();

  for (const field of drFields) {
    const indexes = childIndexesAfterPrefix(field.path, HS_WEIGHT_DR_B2D_PATH);
    if (indexes.length === 0) continue;
    const groupIndex = indexes[0];
    if (!grouped.has(groupIndex)) grouped.set(groupIndex, []);
    grouped.get(groupIndex)?.push(field);
  }

  if (grouped.size >= bvCount) {
    const entriesByRow = Array.from({ length: bvCount }, (_, bvIndex) => numericFieldEntries(grouped.get(bvIndex) ?? []));
    return {
      rows: entriesByRow.map((entries, bvIndex) =>
        padHsNumericRow(entries.map((field) => parseFiniteNumber(field.value)), rowCounts[bvIndex]),
      ),
      fields: entriesByRow.map((entries, bvIndex) => padHsFieldRow(entries, rowCounts[bvIndex])),
    };
  }

  if (grouped.size === 1 && bvCount > 1) {
    const commonEntries = numericFieldEntries(Array.from(grouped.values())[0] ?? []);
    const common = commonEntries.map((field) => parseFiniteNumber(field.value));
    if (common.length >= maxRowCount) {
      return {
        rows: rowCounts.map((rowCount) => common.slice(0, rowCount)),
        fields: rowCounts.map((rowCount) => commonEntries.slice(0, rowCount)),
      };
    }
  }

  const totalRows = rowCounts.reduce((sum, count) => sum + count, 0);
  if (flat.length >= totalRows) {
    let offset = 0;
    const rows = rowCounts.map((rowCount) => {
      const row = flat.slice(offset, offset + rowCount);
      offset += rowCount;
      return row;
    });
    offset = 0;
    const fields = rowCounts.map((rowCount) => {
      const row = flatEntries.slice(offset, offset + rowCount);
      offset += rowCount;
      return row;
    });
    return { rows, fields };
  }

  if (flat.length >= maxRowCount) {
    return {
      rows: rowCounts.map((rowCount) => flat.slice(0, rowCount)),
      fields: rowCounts.map((rowCount) => flatEntries.slice(0, rowCount)),
    };
  }

  return {
    rows: rowCounts.map((rowCount, bvIndex) => padHsNumericRow(flat.slice(bvIndex, bvIndex + 1), rowCount)),
    fields: rowCounts.map((rowCount, bvIndex) => padHsFieldRow(flatEntries.slice(bvIndex, bvIndex + 1), rowCount)),
  };
}

function padHsNumericRow(row: number[], targetLength: number): number[] {
  return Array.from({ length: Math.max(1, targetLength) }, (_, index) => row[index] ?? NaN);
}

function padHsFieldRow(row: FieldEntry[], targetLength: number): Array<FieldEntry | null> {
  return Array.from({ length: Math.max(1, targetLength) }, (_, index) => row[index] ?? null);
}

function childIndexesAfterPrefix(path: string, prefix: string): number[] {
  if (!isPathUnder(path, prefix)) return [];
  const indexes: number[] = [];
  const tail = path.slice(prefix.length);
  for (const match of tail.matchAll(/\[(\d+)\]/g)) {
    indexes.push(Number.parseInt(match[1], 10));
  }
  return indexes.filter(Number.isFinite);
}

function directValueIndex(path: string): number {
  const match = path.match(/\.(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : -1;
}

function compareFieldEntries(a: FieldEntry, b: FieldEntry): number {
  const aIndexes = numericPathOrder(a.path);
  const bIndexes = numericPathOrder(b.path);
  const count = Math.max(aIndexes.length, bIndexes.length);
  for (let i = 0; i < count; i += 1) {
    const diff = (aIndexes[i] ?? -1) - (bIndexes[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return a.line - b.line || a.index - b.index || a.path.localeCompare(b.path);
}

function numericPathOrder(path: string): number[] {
  const order: number[] = [];
  for (const match of path.matchAll(/\[(\d+)\]|\.(\d+)/g)) {
    order.push(Number.parseInt(match[1] ?? match[2], 10));
  }
  return order.filter(Number.isFinite);
}

function getHsWeightCell(source: HsWeightSource, bvIndex: number, drIndex: number, midIndex: number, channelIndex: number): number {
  return source.values[bvIndex]?.[drIndex]?.[midIndex]?.[channelIndex] ?? NaN;
}

function interpolateHsWeightSource(source: HsWeightSource, channelIndex: number, bv: number, drB2d: number, mid: number): number {
  if (!Number.isFinite(bv) || !Number.isFinite(drB2d) || !Number.isFinite(mid)) return NaN;
  const bvBounds = boundsForAxis(bv, source.bvAxis);
  const midBounds = boundsForAxis(mid, source.midAxis);
  let total = 0;
  let weightTotal = 0;

  for (const bvPoint of bvBounds.points) {
    const drAxis = source.drB2dRows[bvPoint.index] ?? [];
    const drBounds = boundsForAxis(drB2d, drAxis);
    for (const drPoint of drBounds.points) {
      for (const midPoint of midBounds.points) {
        const value = getHsWeightCell(source, bvPoint.index, drPoint.index, midPoint.index, channelIndex);
        if (!Number.isFinite(value)) continue;
        const weight = bvPoint.weight * drPoint.weight * midPoint.weight;
        total += value * weight;
        weightTotal += weight;
      }
    }
  }

  return weightTotal > 0 ? total / weightTotal : NaN;
}

function locateHsWeightSelection(source: HsWeightSource | null, bv: number, drB2d: number, mid: number): HsWeightSelection {
  if (!source) return { bvIndexes: new Set(), drIndexesByBv: new Map(), midIndexes: new Set() };
  const bvBounds = boundsForAxis(bv, source.bvAxis);
  const midBounds = boundsForAxis(mid, source.midAxis);
  const drIndexesByBv = new Map<number, Set<number>>();
  for (const bvPoint of bvBounds.points) {
    drIndexesByBv.set(
      bvPoint.index,
      new Set(boundsForAxis(drB2d, source.drB2dRows[bvPoint.index] ?? []).points.map((point) => point.index)),
    );
  }
  return {
    bvIndexes: new Set(bvBounds.points.map((point) => point.index)),
    drIndexesByBv,
    midIndexes: new Set(midBounds.points.map((point) => point.index)),
  };
}

function getHsAreaCell(source: HsAreaSource, rowIndex: number, columnIndex: number): number {
  return source.values[rowIndex]?.[columnIndex] ?? NaN;
}

function interpolateHsAreaSource(source: HsAreaSource, bv: number, axisValue: number): number {
  if (!Number.isFinite(bv) || !Number.isFinite(axisValue)) return NaN;
  const rowBounds = boundsForTableAxis(bv, source.rowHeaders);
  const columnBounds = boundsForTableAxis(axisValue, source.columnHeaders);
  let total = 0;
  let weightTotal = 0;

  for (const rowPoint of rowBounds.points) {
    for (const columnPoint of columnBounds.points) {
      const value = getHsAreaCell(source, rowPoint.index, columnPoint.index);
      if (!Number.isFinite(value)) continue;
      const weight = rowPoint.weight * columnPoint.weight;
      total += value * weight;
      weightTotal += weight;
    }
  }

  return weightTotal > 0 ? total / weightTotal : NaN;
}

function locateHsAreaSelection(source: HsAreaSource | null, bv: number, axisValue: number): HsAreaSelection {
  if (!source) return { rowIndexes: new Set(), columnIndexes: new Set() };
  const rowBounds = boundsForTableAxis(bv, source.rowHeaders);
  const columnBounds = boundsForTableAxis(axisValue, source.columnHeaders);
  return {
    rowIndexes: new Set(rowBounds.points.map((point) => point.index)),
    columnIndexes: new Set(columnBounds.points.map((point) => point.index)),
  };
}

function boundsForTableAxis(value: number, axis: readonly number[]): { points: Array<{ index: number; value: number; weight: number }> } {
  const points = axis
    .map((axisValue, index) => ({ index, value: axisValue }))
    .filter((point) => Number.isFinite(point.value))
    .sort((a, b) => a.value - b.value);
  if (points.length === 0) return { points: [] };
  const exact = Number.isFinite(value) ? points.find((point) => point.value === value) : undefined;
  if (exact) return { points: [{ ...exact, weight: 1 }] };
  if (!Number.isFinite(value) || points.length === 1 || value <= points[0].value) {
    return { points: [{ ...points[0], weight: 1 }] };
  }
  const last = points[points.length - 1];
  if (value >= last.value) return { points: [{ ...last, weight: 1 }] };
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (value <= right.value) {
      if (right.value === left.value) return { points: [{ ...left, weight: 1 }] };
      const rightWeight = (value - left.value) / (right.value - left.value);
      const leftWeight = 1 - rightWeight;
      return {
        points: [
          { ...left, weight: leftWeight },
          { ...right, weight: rightWeight },
        ],
      };
    }
  }
  return { points: [{ ...last, weight: 1 }] };
}

function boundsForAxis(value: number, axis: readonly number[]): { points: Array<{ index: number; value: number; weight: number }> } {
  if (axis.length === 0) return { points: [] };
  if (!Number.isFinite(value) || axis.length === 1 || value <= axis[0]) {
    return { points: [{ index: 0, value: axis[0], weight: 1 }] };
  }
  const last = axis[axis.length - 1];
  if (value >= last) return { points: [{ index: axis.length - 1, value: last, weight: 1 }] };
  for (let i = 1; i < axis.length; i += 1) {
    const left = axis[i - 1];
    const right = axis[i];
    if (value <= right) {
      if (right === left) return { points: [{ index: i - 1, value: left, weight: 1 }] };
      const rightWeight = (value - left) / (right - left);
      const leftWeight = 1 - rightWeight;
      return {
        points: [
          { index: i - 1, value: left, weight: leftWeight },
          { index: i, value: right, weight: rightWeight },
        ],
      };
    }
  }
  return { points: [{ index: axis.length - 1, value: last, weight: 1 }] };
}

function formatHsSelectedPoint(bv: number, b2d: number, mid: number): string {
  return `BV ${formatComputedNumber(bv)} / B2D ${formatComputedNumber(b2d)} / Mid ${formatComputedNumber(mid)}`;
}

function formatHsWeightCell(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatHsAreaReadoutValue(value: string | null): string {
  const parsed = parseFiniteNumber(value);
  return Number.isFinite(parsed) ? formatComputedNumber(parsed) : "-";
}

function formatHsAreaAxisValue(value: number, index: number, prefix: "R" | "C"): string {
  return Number.isFinite(value) ? formatComputedNumber(value) : `${prefix}${index + 1}`;
}

function formatHsAreaCellValue(value: number): string {
  return Number.isFinite(value) ? formatComputedNumber(value) : "-";
}

function isHsWeightZeroCellText(value: string): boolean {
  const text = value.trim();
  if (!isSourceNumberText(text)) return false;

  const unsignedText = text.replace(/^[-+]/, "");
  if (/^0x/i.test(unsignedText)) {
    return /^0x0+$/i.test(unsignedText);
  }

  const mantissa = unsignedText.split(/[eE]/, 1)[0] ?? "";
  return mantissa.includes("0") && /^[0.]+$/.test(mantissa);
}

function formatHsWeightInterpolatedValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "-";
}

function formatHsWeightWetValue(value: string | null): string {
  const parsed = parseFiniteNumber(value);
  return Number.isFinite(parsed) ? formatComputedNumber(parsed) : "-";
}

function formatHsTargetTitleValue(value: string | null): string {
  const parsed = parseFiniteNumber(value);
  return Number.isFinite(parsed) ? formatComputedNumber(parsed) : "-";
}

function cleanLabel(comment: string): string {
  return comment
    .replace(/^[/\s*]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pathTail(path: string): string {
  const match = path.match(/(?:\[|\.)\d+\]?$/);
  return match?.[0] ?? path;
}

function isPathUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

function readTomlValue(tomlData: Record<string, string>, key: string | undefined): string | null {
  if (!key) return null;
  const value = tomlData[key] ?? tomlData[key.toLowerCase()] ?? findCaseInsensitiveTomlValue(tomlData, key);
  if (value === undefined || value === null || value === "") return null;
  return Number.isFinite(parseFiniteNumber(value)) ? String(value).trim() : null;
}

function findCaseInsensitiveTomlValue(tomlData: Record<string, string>, key: string): string | undefined {
  const lowerKey = key.toLowerCase();
  for (const [candidate, value] of Object.entries(tomlData)) {
    if (candidate.toLowerCase() === lowerKey) return value;
  }
  return undefined;
}

function firstNumericString(values: string[] | undefined): string | null {
  const found = values?.find((value) => Number.isFinite(parseFiniteNumber(value)));
  return found === undefined ? null : found.trim();
}

function parseFiniteNumber(value: string | undefined | null): number {
  if (value === undefined || value === null) return NaN;
  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isSourceNumberText(value: string): boolean {
  if (!value) return false;
  SOURCE_NUMBER_RE.lastIndex = 0;
  const match = SOURCE_NUMBER_RE.exec(value);
  return Boolean(match && match[0] === value);
}

function interpolateTableValue(
  x: number,
  xValues: string[] | undefined,
  yValues: string[] | undefined,
): number {
  if (!Number.isFinite(x) || !xValues || !yValues) return NaN;
  const count = Math.min(xValues.length, yValues.length);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const px = parseFiniteNumber(xValues[i]);
    const py = parseFiniteNumber(yValues[i]);
    if (Number.isFinite(px) && Number.isFinite(py)) {
      points.push({ x: px, y: py });
    }
  }
  if (points.length === 0) return NaN;
  points.sort((a, b) => a.x - b.x);
  if (points.length === 1 || x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (x <= right.x) {
      if (right.x === left.x) return left.y;
      const ratio = (x - left.x) / (right.x - left.x);
      return left.y + (right.y - left.y) * ratio;
    }
  }
  return last.y;
}

function buildMidCurvePoints(source: MidCurveSource | null): Array<{ x: number; y: number }> {
  if (!source) return [];
  const points: Array<{ x: number; y: number }> = [];
  appendCurvePairs(points, source.x1, source.y1);
  appendCurvePairs(points, source.x2, source.y2);
  const byX = new Map<number, number>();
  for (const point of points) {
    byX.set(point.x, point.y);
  }
  return Array.from(byX.entries())
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => a.x - b.x);
}

function buildB2dCurvePoints(source: B2dCurveSource | null): Array<{ x: number; y: number }> {
  if (!source) return [];
  const points: Array<{ x: number; y: number }> = [];
  appendCurvePairs(points, source.x, source.y);
  return points.sort((a, b) => a.x - b.x);
}

function buildB2dCorrCurvePoints(source: B2dCorrCurveSource | null): Array<{ x: number; y: number }> {
  if (!source) return [];
  const points: Array<{ x: number; y: number }> = [];
  const p1x = parseFiniteNumber(firstNumericString(source.x1));
  const p1y = parseFiniteNumber(firstNumericString(source.y1));
  const p2x = parseFiniteNumber(firstNumericString(source.x2));
  const p2y = parseFiniteNumber(firstNumericString(source.y2));
  if (Number.isFinite(p1x) && Number.isFinite(p1y)) points.push({ x: p1x, y: p1y });
  if (Number.isFinite(p2x) && Number.isFinite(p2y)) points.push({ x: p2x, y: p2y });
  return points.sort((a, b) => a.x - b.x);
}

function buildSegmentedMidPoints(
  sourcePoints: Array<{ x: number; y: number }>,
  startX = 400,
  endX = 800,
): Array<{ x: number; y: number }> {
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const span = right - left;
  const byX = new Map<number, number>();
  for (const point of sourcePoints) {
    if (point.x < 400 || point.x > 800) continue;
    const ratio = (point.x - 400) / 400;
    const mappedX = span === 0 ? left : left + ratio * span;
    byX.set(mappedX, clamp(point.y, 0, 1024));
  }
  // The final THD curve must connect Base at the left boundary and THD_MAX at the right boundary.
  byX.set(left, 0);
  byX.set(right, 1024);
  return Array.from(byX.entries())
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => a.x - b.x);
}

function appendCurvePairs(target: Array<{ x: number; y: number }>, xValues: string[], yValues: string[]) {
  const count = Math.min(xValues.length, yValues.length);
  for (let i = 0; i < count; i += 1) {
    const x = parseFiniteNumber(xValues[i]);
    const y = parseFiniteNumber(yValues[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      target.push({ x, y });
    }
  }
}

function midValueAtCorr(x: number, points: Array<{ x: number; y: number }>, fallback: number): number {
  const fromSource = interpolatePointValue(x, points);
  if (Number.isFinite(fromSource)) return clamp(fromSource, 0, 1024);
  return Number.isFinite(fallback) ? clamp(fallback, 0, 1024) : NaN;
}

function computeSegmentedThd(
  corrDrMidratio: number,
  baseValue: number,
  expValue: number,
  thdMaxValue: number,
  midPoints: Array<{ x: number; y: number }>,
  fallbackMid: number,
  startX = 400,
  endX = 800,
): number {
  if (!Number.isFinite(corrDrMidratio) || !Number.isFinite(baseValue) || !Number.isFinite(expValue)) return NaN;
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  if (corrDrMidratio < left) return baseValue;
  if (corrDrMidratio > right) return Number.isFinite(thdMaxValue) ? thdMaxValue : NaN;
  const mid = midValueAtCorr(corrDrMidratio, midPoints, fallbackMid);
  return Number.isFinite(mid)
    ? baseValue * 2 ** ((expValue / 1000) * (mid / 1024))
    : NaN;
}

function interpolatePointValue(x: number, points: Array<{ x: number; y: number }>): number {
  if (!Number.isFinite(x) || points.length === 0) return NaN;
  if (points.length === 1 || x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (x <= right.x) {
      if (right.x === left.x) return left.y;
      const ratio = (x - left.x) / (right.x - left.x);
      return left.y + (right.y - left.y) * ratio;
    }
  }
  return last.y;
}

function normalizeB2dKeyPoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, 2)
    .sort((a, b) => a.x - b.x);
}

function b2dFunctionValue(x: number, left: { x: number; y: number }, right: { x: number; y: number }): number {
  if (!Number.isFinite(x)) return NaN;
  if (x < left.x) return left.y;
  if (x > right.x) return right.y;
  if (right.x === left.x) return (left.y + right.y) / 2;
  const ratio = (x - left.x) / (right.x - left.x);
  return left.y + (right.y - left.y) * ratio;
}

function computeRatioFromKeyPoints(x: number, points: Array<{ x: number; y: number }>): number {
  const keyPoints = normalizeB2dKeyPoints(points);
  if (keyPoints.length !== 2) return NaN;
  return b2dFunctionValue(x, keyPoints[0], keyPoints[1]);
}

function updateThresholdRowsCell(
  rows: MainTargetThresholdRow[],
  label: MainTargetThresholdRow["label"],
  cellIndex: number,
  value: string,
): MainTargetThresholdRow[] {
  return rows.map((row) => {
    if (row.label !== label) return row;
    const values = [...row.values];
    values[cellIndex] = value;
    const fields = row.fields.map((field, index) => index === cellIndex ? { ...field, value } : field);
    return { ...row, values, fields };
  });
}

function updateMtwvRowsCell(
  rows: MtwvTableRow[],
  rowId: string,
  cellIndex: number,
  value: string,
): MtwvTableRow[] {
  return rows.map((row) => {
    if (row.id !== rowId) return row;
    const values = [...row.values];
    values[cellIndex] = value;
    const fields = row.fields.map((field, index) => index === cellIndex ? { ...field, value } : field);
    return { ...row, values, fields };
  });
}

function getHsWeightTargetField(source: HsWeightSource, target: HsWeightCellTarget): FieldEntry | null {
  if (target.kind === "bv") return source.bvAxisFields[target.bvIndex] ?? null;
  if (target.kind === "dr") return source.drB2dFields[target.bvIndex]?.[target.drIndex] ?? null;
  if (target.kind === "mid") return source.midAxisFields[target.midIndex] ?? null;
  return source.valueFields[target.bvIndex]?.[target.drIndex]?.[target.midIndex]?.[target.channelIndex] ?? null;
}

function previewHsWeightSourceTarget(source: HsWeightSource, target: HsWeightCellTarget, value: string): HsWeightSource {
  const numericValue = parseFiniteNumber(value);
  if (!Number.isFinite(numericValue)) return source;
  if (target.kind === "bv") {
    return {
      ...source,
      bvAxis: source.bvAxis.map((item, index) => index === target.bvIndex ? numericValue : item),
    };
  }
  if (target.kind === "dr") {
    return {
      ...source,
      drB2dRows: source.drB2dRows.map((row, bvIndex) =>
        bvIndex === target.bvIndex
          ? row.map((item, drIndex) => drIndex === target.drIndex ? numericValue : item)
          : row,
      ),
    };
  }
  if (target.kind === "mid") {
    return {
      ...source,
      midAxis: source.midAxis.map((item, index) => index === target.midIndex ? numericValue : item),
    };
  }
  return {
    ...source,
    values: source.values.map((bvRows, bvIndex) =>
      bvIndex === target.bvIndex
        ? bvRows.map((drRows, drIndex) =>
            drIndex === target.drIndex
              ? drRows.map((midRows, midIndex) =>
                  midIndex === target.midIndex
                    ? midRows.map((item, channelIndex) => channelIndex === target.channelIndex ? numericValue : item)
                    : midRows,
                )
              : drRows,
          )
        : bvRows,
    ),
  };
}

function updateHsWeightSourceField(source: HsWeightSource, field: FieldEntry, value: string): HsWeightSource {
  const numericValue = parseFiniteNumber(value);
  const updateField = (candidate: FieldEntry | null): FieldEntry | null =>
    candidate && sameFieldEntry(candidate, field) ? { ...candidate, value } : candidate;
  const updateValue = (candidate: number, candidateField: FieldEntry | null): number =>
    candidateField && sameFieldEntry(candidateField, field) && Number.isFinite(numericValue) ? numericValue : candidate;

  return {
    ...source,
    bvAxis: source.bvAxis.map((item, index) => updateValue(item, source.bvAxisFields[index] ?? null)),
    bvAxisFields: source.bvAxisFields.map(updateField),
    drB2dRows: source.drB2dRows.map((row, bvIndex) =>
      row.map((item, drIndex) => updateValue(item, source.drB2dFields[bvIndex]?.[drIndex] ?? null)),
    ),
    drB2dFields: source.drB2dFields.map((row) => row.map(updateField)),
    midAxis: source.midAxis.map((item, index) => updateValue(item, source.midAxisFields[index] ?? null)),
    midAxisFields: source.midAxisFields.map(updateField),
    values: source.values.map((bvRows, bvIndex) =>
      bvRows.map((drRows, drIndex) =>
        drRows.map((midRows, midIndex) =>
          midRows.map((item, channelIndex) =>
            updateValue(item, source.valueFields[bvIndex]?.[drIndex]?.[midIndex]?.[channelIndex] ?? null),
          ),
        ),
      ),
    ),
    valueFields: source.valueFields.map((bvRows) =>
      bvRows.map((drRows) =>
        drRows.map((midRows) => midRows.map(updateField)),
      ),
    ),
    fields: source.fields.map((item) => sameFieldEntry(item, field) ? { ...item, value } : item),
  };
}

function getHsAreaTargetField(source: HsAreaSource, target: HsAreaCellTarget): FieldEntry | null {
  if (target.kind === "rowHeader") return source.rowHeaderFields[target.rowIndex] ?? null;
  if (target.kind === "columnHeader") return source.columnHeaderFields[target.columnIndex] ?? null;
  return source.valueFields[target.rowIndex]?.[target.columnIndex] ?? null;
}

function previewHsAreaSourceTarget(source: HsAreaSource, target: HsAreaCellTarget, value: string): HsAreaSource {
  const numericValue = parseFiniteNumber(value);
  if (!Number.isFinite(numericValue)) return source;
  if (target.kind === "rowHeader") {
    return {
      ...source,
      rowHeaders: source.rowHeaders.map((item, index) => index === target.rowIndex ? numericValue : item),
    };
  }
  if (target.kind === "columnHeader") {
    return {
      ...source,
      columnHeaders: source.columnHeaders.map((item, index) => index === target.columnIndex ? numericValue : item),
    };
  }
  return {
    ...source,
    values: source.values.map((row, rowIndex) =>
      rowIndex === target.rowIndex
        ? row.map((item, columnIndex) => columnIndex === target.columnIndex ? numericValue : item)
        : row,
    ),
  };
}

function updateHsAreaSourceField(source: HsAreaSource, field: FieldEntry, value: string): HsAreaSource {
  const numericValue = parseFiniteNumber(value);
  const updateField = (candidate: FieldEntry | null): FieldEntry | null =>
    candidate && sameFieldEntry(candidate, field) ? { ...candidate, value } : candidate;
  const updateValue = (candidate: number, candidateField: FieldEntry | null): number =>
    candidateField && sameFieldEntry(candidateField, field) && Number.isFinite(numericValue) ? numericValue : candidate;

  return {
    ...source,
    rowHeaders: source.rowHeaders.map((item, index) => updateValue(item, source.rowHeaderFields[index] ?? null)),
    rowHeaderFields: source.rowHeaderFields.map(updateField),
    columnHeaders: source.columnHeaders.map((item, index) => updateValue(item, source.columnHeaderFields[index] ?? null)),
    columnHeaderFields: source.columnHeaderFields.map(updateField),
    values: source.values.map((row, rowIndex) =>
      row.map((item, columnIndex) => updateValue(item, source.valueFields[rowIndex]?.[columnIndex] ?? null)),
    ),
    valueFields: source.valueFields.map((row) => row.map(updateField)),
    fields: source.fields.map((item) => sameFieldEntry(item, field) ? { ...item, value } : item),
  };
}

function replaceHsWeightCellInSourceText(
  sourceText: string,
  source: HsWeightSource,
  field: FieldEntry,
  nextValue: string,
): string | null {
  return replaceSourceFieldInSourceText(sourceText, source.fields, field, nextValue);
}

function replaceHsAreaCellInSourceText(
  sourceText: string,
  source: HsAreaSource,
  field: FieldEntry,
  nextValue: string,
): string | null {
  return replaceSourceFieldInSourceText(sourceText, source.fields, field, nextValue);
}

function replaceSourceFieldInSourceText(
  sourceText: string,
  fields: FieldEntry[],
  field: FieldEntry,
  nextValue: string,
): string | null {
  if (!sourceText) return null;
  const lines = sourceText.split("\n");
  const lineIndex = field.line - 1;
  const line = lines[lineIndex];
  if (line === undefined) return null;

  const fieldsOnLine = fields
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.line === field.line)
    .sort((a, b) => a.item.index - b.item.index || a.item.path.localeCompare(b.item.path) || a.index - b.index);
  const ordinalOnLine = fieldsOnLine.findIndex(({ item }) => sameFieldEntry(item, field));
  const replaced = replaceNumericTokenInLine(line, ordinalOnLine, field.value, nextValue);
  if (replaced === null || replaced === line) return null;
  lines[lineIndex] = replaced;
  return lines.join("\n");
}

function sameFieldEntry(left: FieldEntry | null | undefined, right: FieldEntry | null | undefined): boolean {
  return Boolean(left && right && left.path === right.path && left.line === right.line && left.index === right.index);
}

function replaceThresholdCellInSourceText(
  sourceText: string,
  row: MainTargetThresholdRow,
  cellIndex: number,
  nextValue: string,
): string | null {
  const field = row.fields[cellIndex];
  if (!field || !sourceText) return null;
  const lines = sourceText.split("\n");
  const lineIndex = field.line - 1;
  const line = lines[lineIndex];
  if (line === undefined) return null;

  const fieldsOnLine = row.fields
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.line === field.line)
    .sort((a, b) => a.item.index - b.item.index || a.item.path.localeCompare(b.item.path));
  const ordinalOnLine = fieldsOnLine.findIndex(({ index }) => index === cellIndex);
  const replaced = replaceNumericTokenInLine(line, ordinalOnLine, field.value, nextValue);
  if (replaced === null || replaced === line) return null;
  lines[lineIndex] = replaced;
  return lines.join("\n");
}

function replaceMtwvCellInSourceText(
  sourceText: string,
  row: MtwvTableRow,
  cellIndex: number,
  nextValue: string,
): string | null {
  const field = row.fields[cellIndex];
  if (!field || !sourceText) return null;
  const lines = sourceText.split("\n");
  const lineIndex = field.line - 1;
  const line = lines[lineIndex];
  if (line === undefined) return null;

  const fieldsOnLine = row.fields
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.line === field.line)
    .sort((a, b) => a.item.index - b.item.index || a.item.path.localeCompare(b.item.path));
  const ordinalOnLine = fieldsOnLine.findIndex(({ index }) => index === cellIndex);
  const replaced = replaceNumericTokenInLine(line, ordinalOnLine, field.value, nextValue);
  if (replaced === null || replaced === line) return null;
  lines[lineIndex] = replaced;
  return lines.join("\n");
}

function replaceNumericTokenInLine(line: string, ordinalOnLine: number, oldValue: string, nextValue: string): string | null {
  const commentStart = findLineCommentStart(line);
  const codePart = commentStart < 0 ? line : line.slice(0, commentStart);
  const commentPart = commentStart < 0 ? "" : line.slice(commentStart);
  SOURCE_NUMBER_RE.lastIndex = 0;
  const tokenMatches = Array.from(codePart.matchAll(SOURCE_NUMBER_RE));
  if (tokenMatches.length === 0) return null;

  const ordinalMatch = ordinalOnLine >= 0 ? tokenMatches[ordinalOnLine] : undefined;
  if (ordinalMatch?.index !== undefined) {
    return replaceRange(codePart, ordinalMatch.index, ordinalMatch.index + ordinalMatch[0].length, nextValue) + commentPart;
  }

  const oldNormalized = oldValue.trim();
  const fallbackMatch = tokenMatches.find((match) => match[0] === oldNormalized);
  if (fallbackMatch?.index === undefined) return null;
  return replaceRange(codePart, fallbackMatch.index, fallbackMatch.index + fallbackMatch[0].length, nextValue) + commentPart;
}

function findLineCommentStart(line: string): number {
  const slash = line.indexOf("//");
  const block = line.indexOf("/*");
  if (slash < 0) return block;
  if (block < 0) return slash;
  return Math.min(slash, block);
}

function replaceRange(text: string, start: number, end: number, value: string): string {
  return `${text.slice(0, start)}${value}${text.slice(end)}`;
}

function interpolationColumnIndexes(x: number, xValues: string[] | undefined): Set<number> {
  const result = new Set<number>();
  if (!Number.isFinite(x) || !xValues) return result;
  const points = xValues
    .map((raw, index) => ({ x: parseFiniteNumber(raw), index }))
    .filter((point) => Number.isFinite(point.x))
    .sort((a, b) => a.x - b.x);
  if (points.length === 0) return result;
  const exact = points.find((point) => point.x === x);
  if (exact) {
    result.add(exact.index);
    return result;
  }
  if (points.length === 1 || x <= points[0].x) {
    result.add(points[0].index);
    return result;
  }
  const last = points[points.length - 1];
  if (x >= last.x) {
    result.add(last.index);
    return result;
  }
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (x < right.x) {
      result.add(left.index);
      result.add(right.index);
      return result;
    }
  }
  result.add(last.index);
  return result;
}

function formatComputedNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function formatThresholdNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "-";
}

function formatRoundedNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : "-";
}

function formatExponentCoefficient(value: number): string {
  return Number.isFinite(value) ? (value / 1000).toFixed(3).replace(/\.?0+$/, "") : "-";
}

function formatMidRatioFactor(value: number): string {
  return Number.isFinite(value) ? (value / 1024).toFixed(2) : "-";
}

function formatInputNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueSortedNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter(Number.isFinite))).sort((a, b) => a - b);
}

function buildSvgPath(
  points: Array<{ x: number; y: number }>,
  xToPx: (x: number) => number,
  yToPx: (y: number) => number,
): string {
  const commands: string[] = [];
  for (const point of points) {
    const px = xToPx(point.x);
    const py = yToPx(point.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    commands.push(`${commands.length === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`);
  }
  return commands.join(" ");
}

function formatRatioTick(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const pct = Math.round((value / 1024) * 100);
  return `${formatComputedNumber(value)}(${pct}%)`;
}

function formatRatioPercent(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round((value / 1024) * 100)}%`;
}

function formatMidReadout(value: number, mode: "value" | "percent"): string {
  if (!Number.isFinite(value)) return "-";
  if (mode === "percent") return `${Math.round((value / 1024) * 100)}%`;
  return formatComputedNumber(value);
}

const canvasStyle: CSSProperties = {
  background: "var(--colorNeutralBackground1)",
  color: "var(--colorNeutralForeground1)",
};

const tabStripWrapStyle: CSSProperties = {
  borderBottom: "1px solid var(--colorNeutralStroke2)",
};

const innerCanvasStyle: CSSProperties = {
  minWidth: 0,
  background: "transparent",
  border: "none",
  borderRadius: 0,
  padding: 0,
};

const hiddenScrollbarStyle: CSSProperties = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
};

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    minWidth: 88,
    height: 30,
    padding: "0 14px",
    border: active ? "1px solid var(--colorBrandStroke1)" : "1px solid var(--colorNeutralStroke2)",
    borderBottomColor: active ? "var(--colorBrandStroke1)" : "var(--colorNeutralStroke2)",
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    background: active ? "var(--colorBrandBackground)" : "var(--colorNeutralBackground3)",
    color: active ? "var(--colorNeutralForegroundOnBrand)" : "var(--colorNeutralForeground2)",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    transform: active ? "translateY(1px)" : "none",
    boxShadow: active ? "0 2px 6px color-mix(in srgb, var(--colorBrandBackground) 28%, transparent)" : "none",
  };
}

const thresholdCardStyle: CSSProperties = {
  position: "relative",
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 12,
  margin: "0 0 12px",
  padding: 0,
  background: "var(--colorNeutralBackground1)",
  overflow: "hidden",
  boxShadow: "0 10px 26px rgba(0, 0, 0, 0.10)",
};

function metricCardDragWrapStyle(draggable: boolean, dragging: boolean): CSSProperties {
  return {
    opacity: dragging ? 0.58 : 1,
    cursor: draggable ? "grab" : "default",
    touchAction: draggable ? "none" : "auto",
    userSelect: draggable ? "none" : "auto",
    transition: "opacity 120ms ease, transform 120ms ease",
  };
}

const thresholdHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  minHeight: 42,
  padding: "0 12px",
  background: "var(--colorNeutralBackground2)",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
};

const thresholdTitleStyle: CSSProperties = {
  flex: "0 0 auto",
  color: "var(--colorNeutralForeground1)",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: "18px",
};

const thresholdFormulaStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 12,
  padding: "9px 12px",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground1)",
  color: "var(--colorNeutralForeground2)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
};

const thresholdDualControlStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 12,
  minWidth: 0,
  padding: 12,
};

const mtwvControlWrapStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: 12,
  minWidth: 0,
  padding: 12,
};

const mtwvOverviewStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(300px, 1.15fr) minmax(260px, 0.85fr)",
  gap: 10,
  minWidth: 0,
  padding: 10,
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground1)",
};

const mtwvFormulaPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
  padding: 12,
  border: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent)",
  borderRadius: 8,
  background: "var(--colorNeutralBackground2)",
};

const mtwvFormulaTitleStyle: CSSProperties = {
  color: "var(--colorNeutralForeground1)",
  fontSize: 12,
  fontWeight: 800,
};

const mtwvFormulaTextStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
  color: "var(--colorNeutralForeground2)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
  lineHeight: "18px",
};

const mtwvFormulaAccentStyle: CSSProperties = {
  color: "var(--colorBrandForeground1)",
  fontWeight: 900,
};

const mtwvFlowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  minWidth: 0,
};

function mtwvFlowBoxStyle(kind: "block" | "weight" | "sum"): CSSProperties {
  const tone = kind === "block"
    ? "var(--colorPaletteBlueBackground2)"
    : kind === "weight"
      ? "color-mix(in srgb, #f59e0b 24%, var(--colorNeutralBackground1))"
      : "var(--colorNeutralBackground1)";
  return {
    minWidth: 82,
    padding: "8px 10px",
    border: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 76%, transparent)",
    borderRadius: 8,
    background: tone,
    color: "var(--colorNeutralForeground1)",
    textAlign: "center",
    fontSize: 12,
    fontWeight: 800,
  };
}

const mtwvFlowOperatorStyle: CSSProperties = {
  color: "var(--colorNeutralForeground3)",
  fontSize: 18,
  fontWeight: 900,
  lineHeight: 1,
};

const mtwvStatsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
  minWidth: 0,
};

function mtwvStatStyle(strong: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minWidth: 0,
    minHeight: 58,
    padding: "8px 10px",
    border: strong
      ? "1px solid color-mix(in srgb, var(--colorBrandForeground1) 45%, var(--colorNeutralStroke2))"
      : "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent)",
    borderRadius: 8,
    background: strong
      ? "color-mix(in srgb, var(--colorBrandBackground2) 34%, var(--colorNeutralBackground1))"
      : "var(--colorNeutralBackground2)",
  };
}

const mtwvStatLabelStyle: CSSProperties = {
  color: "var(--colorNeutralForeground3)",
  fontSize: 11,
  fontWeight: 700,
};

function mtwvStatValueStyle(strong: boolean): CSSProperties {
  return {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: strong ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground1)",
    fontFamily: "ui-monospace, Consolas, monospace",
    fontSize: strong ? 17 : 13,
    fontWeight: 900,
  };
}

const mainTargetBlankStyle: CSSProperties = {
  minHeight: 96,
  borderTop: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground1)",
};

const hsTargetBodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: 12,
  padding: 12,
  background: "var(--colorNeutralBackground1)",
};

const hsTargetTermGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(190px, 1fr))",
  gap: 10,
  minWidth: 0,
};

function hsTargetTermDragWrapStyle(dragging: boolean): CSSProperties {
  return {
    minWidth: 0,
    opacity: dragging ? 0.62 : 1,
    cursor: dragging ? "grabbing" : "grab",
    touchAction: "none",
    userSelect: "none",
    transition: "opacity 120ms ease, transform 120ms ease",
  };
}

function hsTargetTermCardStyle(hasMissing: boolean, active: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    padding: 12,
    border: `1px solid ${hasMissing ? "var(--colorPaletteRedBorder2)" : active ? "var(--colorBrandStroke1)" : "var(--colorNeutralStroke2)"}`,
    borderRadius: 8,
    background: hasMissing
      ? "color-mix(in srgb, var(--colorPaletteRedBackground2) 42%, var(--colorNeutralBackground1))"
      : active
        ? "color-mix(in srgb, var(--colorBrandBackground2) 22%, var(--colorNeutralBackground1))"
        : "color-mix(in srgb, var(--colorNeutralForeground1) 9%, var(--colorNeutralBackground2))",
    boxShadow: active
      ? "0 1px 2px color-mix(in srgb, var(--colorBrandForeground1) 14%, transparent)"
      : "inset 0 0 0 1px color-mix(in srgb, var(--colorNeutralForeground1) 5%, transparent)",
    transition: "border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease",
  };
}

const hsTargetTermHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  minWidth: 0,
};

const hsTargetTermTitleStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--colorNeutralForeground1)",
  fontSize: 13,
  fontWeight: 800,
};

const hsTargetTermTitleValueStyle: CSSProperties = {
  color: "var(--colorNeutralForeground1)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontWeight: 900,
};

function hsTargetStatusBadgeStyle(hasMissing: boolean, active: boolean): CSSProperties {
  return {
    flex: "0 0 auto",
    maxWidth: "62%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: "2px 7px",
    border: `1px solid ${hasMissing ? "var(--colorPaletteRedBorder2)" : active ? "var(--colorBrandStroke1)" : "var(--colorNeutralStroke2)"}`,
    borderRadius: 999,
    background: hasMissing
      ? "var(--colorPaletteRedBackground2)"
      : active
        ? "var(--colorBrandBackground2)"
        : "var(--colorNeutralBackground1)",
    color: hasMissing
      ? "var(--colorPaletteRedForeground1)"
      : active
        ? "var(--colorBrandForeground1)"
        : "var(--colorNeutralForeground2)",
    fontSize: 10,
    fontWeight: 900,
  };
}

const hsTargetTermEquationStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) max-content",
  alignItems: "baseline",
  gap: 10,
  minWidth: 0,
};

const hsTargetTermFormulaStyle: CSSProperties = {
  color: "var(--colorNeutralForeground3)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 11,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const hsTargetTermValueStyle: CSSProperties = {
  color: "var(--colorBrandForeground1)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 18,
  fontWeight: 900,
};

const hsTargetMetricRowsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 6,
  minWidth: 0,
};

function hsTargetMetricRowStyle(kind: "thd" | "y" | "wet", missing: boolean, active: boolean): CSSProperties {
  const background = missing
    ? "color-mix(in srgb, var(--colorPaletteRedBackground2) 70%, var(--colorNeutralBackground1))"
    : kind === "thd"
      ? `color-mix(in srgb, var(--colorPaletteBlueBackground2) ${active ? 72 : 54}%, var(--colorNeutralBackground1))`
      : kind === "y"
        ? `color-mix(in srgb, var(--normal-sheet-palegreen-bg) ${active ? 72 : 54}%, var(--colorNeutralBackground1))`
        : `color-mix(in srgb, var(--normal-sheet-yellow-bg) ${active ? 72 : 54}%, var(--colorNeutralBackground1))`;
  const border = missing
    ? "var(--colorPaletteRedBorder2)"
    : kind === "thd"
      ? "color-mix(in srgb, var(--colorPaletteBlueForeground2) 42%, var(--colorNeutralStroke2))"
      : kind === "y"
        ? "color-mix(in srgb, var(--normal-sheet-palegreen-fg) 42%, var(--colorNeutralStroke2))"
        : "color-mix(in srgb, var(--normal-sheet-yellow-fg) 48%, var(--colorNeutralStroke2))";
  const valueColor = missing
    ? "var(--colorPaletteRedForeground1)"
    : kind === "thd"
      ? "var(--colorPaletteBlueForeground2)"
      : kind === "y"
        ? "var(--normal-sheet-palegreen-fg)"
        : "var(--normal-sheet-yellow-fg)";
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    minWidth: 0,
    padding: "6px 8px",
    border: `1px solid ${border}`,
    borderRadius: 6,
    background,
    boxShadow: "0 1px 0 color-mix(in srgb, var(--colorNeutralForeground1) 6%, transparent), inset 0 1px 0 color-mix(in srgb, var(--colorNeutralForeground1) 10%, transparent)",
    color: valueColor,
    fontFamily: "ui-monospace, Consolas, monospace",
    fontSize: 11,
    fontWeight: 800,
  };
}

function hsTargetContributionStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minWidth: 0,
    paddingTop: 2,
    color: active ? "var(--colorNeutralForeground1)" : "var(--colorNeutralForeground3)",
    fontFamily: "ui-monospace, Consolas, monospace",
    fontSize: 12,
    fontWeight: 900,
  };
}

const hsWeightBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
  padding: 12,
  background: "var(--colorNeutralBackground1)",
};

const HS_WEIGHT_LINE_COLOR = "color-mix(in srgb, var(--normal-sheet-line) 56%, var(--colorNeutralStroke2))";
const HS_WEIGHT_SUBTLE_LINE_COLOR = "color-mix(in srgb, var(--normal-sheet-line) 42%, var(--colorNeutralStroke2))";
const HS_WEIGHT_FRAME_BORDER = `1.5px solid ${HS_WEIGHT_LINE_COLOR}`;
const HS_WEIGHT_MAJOR_BORDER = `1px solid ${HS_WEIGHT_LINE_COLOR}`;
const HS_WEIGHT_GRID_BORDER = `1px solid ${HS_WEIGHT_SUBTLE_LINE_COLOR}`;
const HS_WEIGHT_MID_BORDER = "1px solid #000";
const HS_WEIGHT_MID_TEXT_COLOR = "var(--hs-weight-cell-fg, var(--normal-sheet-text))";
const HS_WEIGHT_DR_TEXT_COLOR = "var(--hs-weight-dr-fg, rgb(192, 0, 74))";
const HS_WEIGHT_ZERO_TEXT_COLOR = "var(--hs-weight-zero-fg, rgb(183, 166, 183))";
const HS_WEIGHT_BV_BACKGROUND = "var(--hs-weight-bv-bg)";
const HS_WEIGHT_DR_BACKGROUND = "var(--hs-weight-dr-bg)";

const hsWeightTableWrapStyle: CSSProperties = {
  overflow: "hidden",
  padding: 0,
  border: "none",
  borderRadius: 0,
  background: "transparent",
};

const hsWeightPendingStyle: CSSProperties = {
  minHeight: 112,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--colorNeutralForeground3)",
  fontSize: 12,
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 8,
  background: "var(--colorNeutralBackground2)",
};

const hsWeightScaleViewportStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  overflow: "hidden",
};

function hsWeightScaleSlotStyle(width: number, height: number): CSSProperties {
  return {
    position: "relative",
    width: width > 0 ? width + 3 : "max-content",
    height: height > 0 ? height + 3 : 1,
    minWidth: 0,
  };
}

function hsWeightScaledSheetStyle(scale: number): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  };
}

function hsWeightCellInputStyle(editable: boolean): CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    height: "100%",
    border: "none",
    outline: "none",
    padding: "0 2px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontWeight: "inherit",
    textAlign: "center",
    cursor: editable ? "text" : "default",
  };
}

function hsWeightSheetStyle(midCount: number): CSSProperties {
  const count = Math.max(1, midCount);
  return {
    width: "max-content",
    minWidth: HS_WEIGHT_BV_COLUMN_WIDTH + HS_WEIGHT_DR_COLUMN_WIDTH + count * HS_WEIGHT_MID_COLUMN_WIDTH,
    overflow: "hidden",
    border: HS_WEIGHT_FRAME_BORDER,
    borderRadius: 8,
    boxSizing: "border-box",
    background: "var(--colorNeutralBackground1)",
    boxShadow: "0 1px 2px color-mix(in srgb, var(--colorNeutralForeground1) 6%, transparent)",
    fontFamily: "ui-monospace, Consolas, monospace",
    fontSize: 10,
    lineHeight: 1.15,
  };
}

function hsWeightHeaderGridStyle(midCount: number): CSSProperties {
  const count = Math.max(1, midCount);
  return {
    display: "grid",
    gridTemplateColumns: `${HS_WEIGHT_BV_COLUMN_WIDTH}px ${HS_WEIGHT_DR_COLUMN_WIDTH}px repeat(${count}, ${HS_WEIGHT_MID_COLUMN_WIDTH}px)`,
    alignItems: "stretch",
  };
}

function hsWeightAxisHeaderStyle(kind: "bv" | "dr"): CSSProperties {
  return {
    display: "flex",
    gridRow: "span 2",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    borderRight: HS_WEIGHT_MAJOR_BORDER,
    borderBottom: HS_WEIGHT_MAJOR_BORDER,
    background: kind === "bv" ? HS_WEIGHT_BV_BACKGROUND : HS_WEIGHT_DR_BACKGROUND,
    color: kind === "bv" ? "var(--normal-sheet-palegreen-fg)" : "var(--colorPaletteRedForeground1)",
    fontWeight: 900,
  };
}

function hsWeightMidGroupHeaderStyle(midCount: number): CSSProperties {
  return {
    display: "flex",
    gridColumn: `span ${Math.max(1, midCount)}`,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 20,
    borderRight: HS_WEIGHT_MAJOR_BORDER,
    borderBottom: HS_WEIGHT_MID_BORDER,
    background: "color-mix(in srgb, var(--colorPaletteBlueBackground2) 46%, var(--colorNeutralBackground1))",
    color: HS_WEIGHT_MID_TEXT_COLOR,
    fontWeight: 900,
  };
}

function hsWeightMidHeaderStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 20,
    margin: `0 ${HS_WEIGHT_MID_COLUMN_GAP}px`,
    border: HS_WEIGHT_MID_BORDER,
    borderBottomWidth: 1,
    background: active
      ? "color-mix(in srgb, var(--colorBrandBackground2) 42%, var(--colorNeutralBackground1))"
      : "color-mix(in srgb, var(--colorPaletteBlueBackground2) 32%, var(--colorNeutralBackground1))",
    color: HS_WEIGHT_MID_TEXT_COLOR,
    fontWeight: 900,
  };
}

function hsWeightBvGroupGridStyle(midCount: number, separated: boolean): CSSProperties {
  const count = Math.max(1, midCount);
  return {
    display: "grid",
    gridTemplateColumns: `${HS_WEIGHT_BV_COLUMN_WIDTH}px ${HS_WEIGHT_DR_COLUMN_WIDTH}px repeat(${count}, ${HS_WEIGHT_MID_COLUMN_WIDTH}px)`,
    alignItems: "stretch",
    marginTop: separated ? 16 : 0,
  };
}

function hsWeightBvHeaderStyle(active: boolean, rowCount: number): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: Math.max(1, rowCount) * 20,
    padding: "0 4px",
    borderRight: HS_WEIGHT_MAJOR_BORDER,
    borderBottom: HS_WEIGHT_MAJOR_BORDER,
    background: HS_WEIGHT_BV_BACKGROUND,
    color: active ? "var(--colorBrandForeground1)" : "var(--normal-sheet-palegreen-fg)",
    fontWeight: 900,
  };
}

const hsWeightB2dColumnStyle: CSSProperties = {
  display: "grid",
  gridAutoRows: "20px",
  borderRight: HS_WEIGHT_MAJOR_BORDER,
  borderBottom: HS_WEIGHT_MAJOR_BORDER,
};

function hsWeightB2dCellStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 20,
    borderBottom: HS_WEIGHT_GRID_BORDER,
    background: HS_WEIGHT_DR_BACKGROUND,
    color: active ? "var(--colorBrandForeground1)" : HS_WEIGHT_DR_TEXT_COLOR,
    fontWeight: 900,
  };
}

function hsWeightMiniTableWrapStyle(_active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: `0 ${HS_WEIGHT_MID_COLUMN_GAP}px`,
    borderRight: "none",
    borderBottom: HS_WEIGHT_MAJOR_BORDER,
    outline: "none",
    background: "var(--colorNeutralBackground1)",
  };
}

const hsWeightMiniTableStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  width: "100%",
  maxWidth: HS_WEIGHT_MINI_TABLE_WIDTH,
  boxSizing: "border-box",
  border: HS_WEIGHT_GRID_BORDER,
  background: "var(--colorNeutralBackground1)",
};

function hsWeightMiniCellStyle(_tone: HsWeightToneId, active: boolean, columnIndex: number): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 19,
    boxSizing: "border-box",
    borderRight: columnIndex < HS_WEIGHT_CHANNELS.length - 1 ? HS_WEIGHT_GRID_BORDER : "none",
    color: active ? "var(--colorBrandForeground1)" : HS_WEIGHT_MID_TEXT_COLOR,
    background: active ? "color-mix(in srgb, var(--colorBrandBackground2) 24%, transparent)" : "transparent",
    fontWeight: active ? 900 : 700,
  };
}

const hsWeightMiniRowDividerStyle: CSSProperties = {
  gridColumn: "1 / -1",
  height: 0,
  borderBottom: HS_WEIGHT_GRID_BORDER,
};

const hsDarkAreaBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  padding: 12,
  background: "var(--colorNeutralBackground1)",
};

const hsDarkAreaTableWrapStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  overflow: "hidden",
};

function hsDarkAreaGridStyle(columnCount: number): CSSProperties {
  const count = Math.max(1, columnCount);
  const compact = count > 7;
  return {
    display: "grid",
    gridTemplateColumns: `${compact ? "minmax(50px, 0.85fr)" : "minmax(64px, 0.9fr)"} repeat(${count}, minmax(0, 1fr))`,
    gridAutoRows: compact ? "22px" : "24px",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    overflow: "hidden",
    border: HS_WEIGHT_FRAME_BORDER,
    borderRadius: 8,
    background: "var(--colorNeutralBackground1)",
    fontFamily: "ui-monospace, Consolas, monospace",
    fontSize: compact ? 10 : 11,
    lineHeight: 1.1,
  };
}

const hsDarkAreaCornerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
  padding: "0 5px",
  borderRight: HS_WEIGHT_MAJOR_BORDER,
  borderBottom: HS_WEIGHT_MAJOR_BORDER,
  background: "color-mix(in srgb, var(--normal-sheet-palegreen-bg) 72%, var(--colorNeutralBackground1))",
  color: "var(--normal-sheet-palegreen-fg)",
  fontWeight: 900,
};

function hsDarkAreaColumnHeaderStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
    padding: "0 4px",
    borderRight: HS_WEIGHT_GRID_BORDER,
    borderBottom: HS_WEIGHT_MAJOR_BORDER,
    background: active
      ? "color-mix(in srgb, var(--colorBrandBackground2) 42%, var(--colorNeutralBackground1))"
      : HS_WEIGHT_DR_BACKGROUND,
    color: active ? "var(--colorBrandForeground1)" : HS_WEIGHT_DR_TEXT_COLOR,
    fontWeight: 900,
  };
}

function hsDarkAreaRowHeaderStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
    padding: "0 5px",
    borderRight: HS_WEIGHT_MAJOR_BORDER,
    borderBottom: HS_WEIGHT_GRID_BORDER,
    background: active
      ? "color-mix(in srgb, var(--colorBrandBackground2) 42%, var(--colorNeutralBackground1))"
      : HS_WEIGHT_BV_BACKGROUND,
    color: active ? "var(--colorBrandForeground1)" : "var(--normal-sheet-palegreen-fg)",
    fontWeight: 900,
  };
}

function hsDarkAreaDataCellStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
    padding: "0 4px",
    borderRight: HS_WEIGHT_GRID_BORDER,
    borderBottom: HS_WEIGHT_GRID_BORDER,
    background: active ? "color-mix(in srgb, var(--colorBrandBackground2) 24%, transparent)" : "transparent",
    color: active ? "var(--colorBrandForeground1)" : HS_WEIGHT_MID_TEXT_COLOR,
    fontWeight: active ? 900 : 700,
  };
}

const thresholdGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 10,
  background: "var(--colorNeutralBackground2)",
  overflow: "hidden",
};

const thresholdGroupTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  minHeight: 42,
  padding: "8px 10px",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  color: "var(--colorNeutralForeground2)",
  fontSize: 12,
  fontWeight: 700,
};

const thresholdGroupActionsStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flex: "0 0 auto",
};

const bvControlRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(112px, 0.72fr) minmax(0, 0.82fr) minmax(0, 0.98fr)",
  alignItems: "stretch",
  gap: 8,
  minWidth: 0,
  overflow: "hidden",
  padding: 10,
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground1)",
};

const bvInputWrapStyle: CSSProperties = {
  justifySelf: "start",
  width: "min(100%, 148px)",
  minWidth: 0,
  height: 44,
};

const bvComputedStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  height: 44,
  minWidth: 0,
};

const bvThdMaxWrapStyle: CSSProperties = {
  height: 44,
  minWidth: 0,
};

function compactReadoutStyle(fillHeight: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flex: 1,
    height: fillHeight ? "100%" : undefined,
    minHeight: 0,
    minWidth: 0,
    padding: "0 8px",
    border: "1px solid var(--colorNeutralStroke2)",
    borderRadius: 6,
    background: "var(--colorNeutralBackground1)",
    fontFamily: "ui-monospace, Consolas, monospace",
    overflow: "hidden",
  };
}

const compactReadoutLabelStyle: CSSProperties = {
  minWidth: 0,
  color: "var(--colorNeutralForeground3)",
  fontSize: 10,
  fontWeight: 700,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const compactReadoutValueStyle: CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  color: "var(--colorNeutralForeground1)",
  fontSize: 11,
  fontWeight: 800,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function metricButtonStyle(active: boolean, pressed: boolean, hovered: boolean, clickable: boolean, disabled = false): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) max-content",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    padding: "0 8px",
    border: active && !disabled ? "1px solid var(--colorBrandStroke1)" : "1px solid var(--colorNeutralStroke2)",
    borderRadius: 6,
    background: disabled
      ? "color-mix(in srgb, var(--colorNeutralBackground2) 86%, var(--colorNeutralForeground1))"
      : pressed
      ? "color-mix(in srgb, var(--colorBrandBackground2) 66%, var(--colorNeutralBackground1))"
      : active
        ? "color-mix(in srgb, var(--colorBrandBackground2) 42%, var(--colorNeutralBackground1))"
        : hovered
          ? "color-mix(in srgb, var(--colorNeutralForeground1) 6%, var(--colorNeutralBackground1))"
          : "var(--colorNeutralBackground1)",
    color: disabled
      ? "var(--colorNeutralForeground3)"
      : active
        ? "var(--colorBrandForeground1)"
        : "var(--colorNeutralForeground1)",
    fontFamily: "ui-monospace, Consolas, monospace",
    cursor: disabled ? "not-allowed" : clickable ? "pointer" : "default",
    overflow: "hidden",
    transform: pressed ? "scale(0.985)" : "scale(1)",
    opacity: 1,
    transition: "transform 100ms ease-out, background-color 120ms ease-out, border-color 120ms ease-out",
    willChange: pressed ? "transform" : "auto",
  };
}

function metricButtonLabelStyle(disabled = false): CSSProperties {
  return {
    minWidth: 0,
    color: disabled ? "var(--colorNeutralForegroundDisabled)" : "var(--colorNeutralForeground3)",
    fontSize: 10,
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "left",
  };
}

function metricButtonValueStyle(disabled = false): CSSProperties {
  return {
    minWidth: 0,
    color: disabled
      ? "color-mix(in srgb, var(--colorBrandForeground1) 72%, var(--colorNeutralForeground1))"
      : "inherit",
    fontSize: 11,
    fontWeight: disabled ? 900 : 800,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "right",
  };
}

const midControlRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1.35fr) minmax(0, 0.9fr)",
  alignItems: "stretch",
  gap: 8,
  minWidth: 0,
  overflow: "hidden",
  padding: 10,
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground1)",
};

const midPrimaryWrapStyle: CSSProperties = {
  minWidth: 0,
  height: 44,
};

const midComputedStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  height: 44,
  minWidth: 0,
};

const thresholdControlStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "max-content minmax(0, 1fr)",
  alignItems: "center",
  minWidth: 0,
  height: "100%",
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 9,
  background: "var(--colorNeutralBackground2)",
  overflow: "hidden",
};

const thresholdControlLabelStyle: CSSProperties = {
  minWidth: 0,
  padding: "0 7px",
  color: "var(--colorNeutralForeground3)",
  fontSize: 11,
  fontWeight: 700,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function thresholdControlLabelButtonStyle(pressed: boolean, active = false): CSSProperties {
  return {
    ...thresholdControlLabelStyle,
    height: "100%",
    border: "none",
    borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 70%, transparent)",
    background: pressed
      ? "color-mix(in srgb, var(--colorBrandBackground2) 78%, var(--colorNeutralBackground2))"
      : active
        ? "color-mix(in srgb, var(--colorBrandBackground2) 56%, var(--colorNeutralBackground2))"
        : "var(--colorNeutralBackground2)",
    color: pressed || active ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground3)",
    cursor: "pointer",
    fontFamily: "inherit",
    transform: pressed ? "scale(0.94)" : "scale(1)",
    transition: "transform 100ms ease-out, background-color 120ms ease-out, color 120ms ease-out",
    willChange: pressed ? "transform" : "auto",
  };
}

function thresholdValueAreaStyle(editable: boolean, focused: boolean, pressed = false, clickable = false, active = false): CSSProperties {
  return {
    display: "flex",
    alignItems: "stretch",
    height: 44,
    minWidth: 0,
    background: pressed
      ? "color-mix(in srgb, var(--colorBrandBackground2) 68%, var(--colorNeutralBackground1))"
      : active
        ? "color-mix(in srgb, var(--colorBrandBackground2) 36%, var(--colorNeutralBackground1))"
        : "var(--colorNeutralBackground1)",
    color: editable || active ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground1)",
    borderLeft: "1px solid var(--colorNeutralStroke2)",
    boxShadow: editable && focused ? "inset 0 -2px 0 var(--colorBrandForeground1)" : "none",
    cursor: clickable ? "pointer" : undefined,
    transform: pressed ? "scale(0.985)" : "scale(1)",
    transition: "box-shadow 120ms ease, background-color 120ms ease, transform 100ms ease-out",
    willChange: pressed ? "transform" : "auto",
  };
}

const thresholdInputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: "100%",
  border: "none",
  outline: "none",
  padding: "0 6px 0 8px",
  background: "transparent",
  color: "inherit",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 13,
  fontWeight: 800,
};

const stepperWrapStyle: CSSProperties = {
  flex: "0 0 16px",
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground2)",
};

function stepperButtonStyle(direction: StepperDirection, pressed: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 22,
    minWidth: 16,
    padding: 0,
    border: "none",
    borderBottom: direction === "up" ? "1px solid var(--colorNeutralStroke2)" : "none",
    background: pressed
      ? "color-mix(in srgb, var(--colorBrandBackground2) 74%, var(--colorNeutralBackground2))"
      : "transparent",
    color: pressed ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground3)",
    cursor: "pointer",
    transform: pressed
      ? `translateY(${direction === "up" ? "-1px" : "1px"}) scale(0.94)`
      : "translateY(0) scale(1)",
    transition: "transform 90ms ease-out, background-color 90ms ease-out, color 90ms ease-out",
    willChange: pressed ? "transform" : "auto",
  };
}

function stepperTriangleStyle(direction: "up" | "down"): CSSProperties {
  return {
    width: 0,
    height: 0,
    borderLeft: "3.5px solid transparent",
    borderRight: "3.5px solid transparent",
    borderTop: direction === "down" ? "4.5px solid currentColor" : undefined,
    borderBottom: direction === "up" ? "4.5px solid currentColor" : undefined,
  };
}

const thresholdResultStyle: CSSProperties = {
  flex: "0 0 auto",
  marginLeft: "auto",
  color: "var(--colorBrandForeground1)",
  fontSize: 13,
  fontWeight: 800,
  textAlign: "right",
};

const thresholdInlineResultStyle: CSSProperties = {
  color: "var(--colorBrandForeground1)",
  fontWeight: 800,
};

const hsWeightSelectedPointStyle: CSSProperties = {
  flex: "0 0 auto",
  color: "var(--colorBrandForeground1)",
  fontSize: 13,
  fontWeight: 800,
};

const hsWeightFormulaTextStyle: CSSProperties = {
  flex: "0 1 auto",
  marginLeft: "auto",
  color: "var(--colorNeutralForeground2)",
  fontSize: 13,
  textAlign: "right",
};

const hsWeightWetValueStyle: CSSProperties = {
  color: "var(--colorNeutralForeground1)",
  fontWeight: 800,
};

const hsWeightInterpolatedValueStyle: CSSProperties = {
  color: "var(--colorBrandForeground1)",
  fontWeight: 800,
};

function sourceButtonStyle(enabled: boolean): CSSProperties {
  return {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    border: "1px solid var(--colorNeutralStroke2)",
    borderRadius: 8,
    background: enabled ? "var(--colorNeutralBackground3)" : "var(--colorNeutralBackground2)",
    color: enabled ? "var(--colorBrandForeground1)" : "var(--colorNeutralForegroundDisabled)",
    cursor: enabled ? "pointer" : "default",
  };
}

function groupSourceButtonStyle(enabled: boolean): CSSProperties {
  return {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    border: "1px solid var(--colorNeutralStroke2)",
    borderRadius: 8,
    background: enabled ? "var(--colorNeutralBackground1)" : "var(--colorNeutralBackground2)",
    color: enabled ? "var(--colorBrandForeground1)" : "var(--colorNeutralForegroundDisabled)",
    cursor: enabled ? "pointer" : "default",
  };
}

const bindingIconButtonStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  minWidth: 28,
  padding: 0,
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 8,
  background: "color-mix(in srgb, var(--colorNeutralBackground1) 88%, var(--colorBrandBackground2))",
  color: "var(--colorBrandForeground1)",
  cursor: "pointer",
  boxShadow: "0 1px 4px color-mix(in srgb, var(--colorNeutralForeground1) 10%, transparent)",
};

const bindingPanelBackdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
  background: "color-mix(in srgb, var(--colorNeutralBackground1) 54%, transparent)",
  backdropFilter: "blur(1.5px)",
};

const bindingPanelStyle: CSSProperties = {
  width: "min(760px, 92%)",
  maxHeight: "82%",
  display: "flex",
  flexDirection: "column",
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 12,
  background: "var(--colorNeutralBackground1)",
  boxShadow: "0 18px 42px rgba(0, 0, 0, 0.18)",
  overflow: "hidden",
};

const bindingPanelHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  minHeight: 42,
  padding: "0 12px",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground2)",
  color: "var(--colorNeutralForeground1)",
  fontSize: 13,
};

const bindingCloseButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 8,
  background: "var(--colorNeutralBackground1)",
  color: "var(--colorNeutralForeground2)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: "24px",
};

const bindingPanelBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minHeight: 0,
  overflow: "auto",
  padding: 12,
};

const bindingEntryStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "92px minmax(0, 1fr) 30px minmax(120px, 0.65fr)",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const bindingEntryLabelStyle: CSSProperties = {
  color: "var(--colorNeutralForeground2)",
  fontSize: 11,
  fontWeight: 800,
};

const bindingPathInputStyle: CSSProperties = {
  minWidth: 0,
  height: 30,
  padding: "0 8px",
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 7,
  outline: "none",
  background: "var(--colorNeutralBackground2)",
  color: "var(--colorNeutralForeground1)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 11,
};

function bindingSourceJumpButtonStyle(enabled: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    minWidth: 30,
    padding: 0,
    border: "1px solid var(--colorNeutralStroke2)",
    borderRadius: 8,
    background: enabled
      ? "color-mix(in srgb, var(--colorNeutralBackground1) 88%, var(--colorBrandBackground2))"
      : "var(--colorNeutralBackground2)",
    color: enabled ? "var(--colorBrandForeground1)" : "var(--colorNeutralForegroundDisabled)",
    cursor: enabled ? "pointer" : "default",
    transition: "background-color 120ms ease, color 120ms ease, transform 100ms ease-out",
  };
}

const bindingValuesStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--colorNeutralForeground3)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 10,
};

const bindingPanelFooterStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: 12,
  borderTop: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground2)",
};

const bindingMessageStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--colorNeutralForeground3)",
  fontSize: 11,
};

const bindingSecondaryButtonStyle: CSSProperties = {
  height: 30,
  padding: "0 10px",
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 8,
  background: "var(--colorNeutralBackground1)",
  color: "var(--colorNeutralForeground2)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const bindingPrimaryButtonStyle: CSSProperties = {
  ...bindingSecondaryButtonStyle,
  borderColor: "var(--colorBrandStroke1)",
  background: "var(--colorBrandBackground)",
  color: "var(--colorNeutralForegroundOnBrand)",
};

const thresholdTableWrapStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "auto",
  padding: "6px 10px",
  background: "var(--colorNeutralBackground2)",
};

const thresholdTableSurfaceStyle: CSSProperties = {
  position: "relative",
  width: "min(100%, 560px)",
  minHeight: 190,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 8px",
  border: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent)",
  borderRadius: 8,
  background: "var(--colorNeutralBackground1)",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
  boxSizing: "border-box",
};

const thresholdTableStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  margin: 0,
  borderCollapse: "separate",
  borderSpacing: 0,
  tableLayout: "fixed",
  overflow: "hidden",
  border: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 78%, transparent)",
  borderRadius: 10,
  background: "var(--colorNeutralBackground1)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 11,
  textAlign: "center",
};

const mtwvTableWrapStyle: CSSProperties = {
  overflow: "auto",
  padding: "10px",
  background: "var(--colorNeutralBackground2)",
};

const mtwvTableSurfaceStyle: CSSProperties = {
  minWidth: 0,
  padding: "10px",
  border: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent)",
  borderRadius: 8,
  background: "var(--colorNeutralBackground1)",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
};

function mtwvHeatmapGridStyle(columnCount: number): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `42px repeat(${Math.max(1, columnCount)}, minmax(34px, 1fr))`,
    gridAutoRows: "minmax(30px, auto)",
    minWidth: Math.max(620, 42 + Math.max(1, columnCount) * 38),
    overflow: "hidden",
    border: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 78%, transparent)",
    borderRadius: 10,
    background: "var(--colorNeutralBackground1)",
    fontFamily: "ui-monospace, Consolas, monospace",
    fontSize: 11,
  };
}

const mtwvHeatmapCornerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
  padding: "5px 6px",
  borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 70%, transparent)",
  borderBottom: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 76%, transparent)",
  background: "color-mix(in srgb, var(--normal-sheet-palegreen-bg) 62%, var(--colorNeutralBackground1))",
  color: "var(--normal-sheet-palegreen-fg)",
  fontWeight: 900,
};

const mtwvHeatmapHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
  padding: "5px 4px",
  borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 58%, transparent)",
  borderBottom: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 76%, transparent)",
  background: "color-mix(in srgb, var(--normal-sheet-palegreen-bg) 52%, var(--colorNeutralBackground1))",
  color: "var(--normal-sheet-palegreen-fg)",
  fontWeight: 800,
};

const mtwvHeatmapRowHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
  padding: "5px 6px",
  borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 70%, transparent)",
  borderBottom: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 58%, transparent)",
  background: "color-mix(in srgb, var(--colorNeutralForeground1) 8%, var(--colorNeutralBackground2))",
  color: "var(--colorNeutralForeground2)",
  fontWeight: 900,
};

function mtwvHeatmapCellStyle(intensity: number, focused = false, editable = false): CSSProperties {
  const pct = Math.round(12 + clamp(intensity, 0, 1) * 70);
  return {
    display: "flex",
    alignItems: "stretch",
    minWidth: 0,
    minHeight: 30,
    padding: 0,
    borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 50%, transparent)",
    borderBottom: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 50%, transparent)",
    outline: focused ? "1.5px solid var(--colorBrandForeground1)" : "none",
    outlineOffset: -3,
    background: `color-mix(in srgb, #f59e0b ${pct}%, var(--colorNeutralBackground1))`,
    color: "var(--colorNeutralForeground1)",
    fontWeight: intensity > 0.68 ? 900 : 700,
    cursor: editable ? "text" : "default",
    transition: "background-color 120ms ease, outline-color 120ms ease",
  };
}

function mtwvHeatmapInputStyle(editable: boolean): CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    border: "none",
    outline: "none",
    padding: "0 3px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontWeight: "inherit",
    textAlign: "center",
    cursor: editable ? "text" : "default",
  };
}

const chartWrapStyle: CSSProperties = {
  position: "relative",
  padding: "6px 10px",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
};

const chartSvgStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: 620,
  minHeight: 220,
  margin: "0 auto",
  border: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent)",
  background: "var(--colorNeutralBackground1)",
  borderRadius: 8,
  boxSizing: "border-box",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
};

const chartTitleTextStyle: CSSProperties = {
  fill: "var(--colorNeutralForeground1)",
  fontSize: 12,
  fontWeight: 700,
};

const chartAxisTextStyle: CSSProperties = {
  fill: "var(--colorNeutralForeground2)",
  fontSize: 11,
};

const chartValueTextStyle: CSSProperties = {
  fill: "var(--colorNeutralForeground1)",
  fontSize: 12,
  fontWeight: 600,
};

const chartCurrentValueTextStyle: CSSProperties = {
  fill: "var(--colorBrandForeground1)",
  stroke: "var(--colorNeutralBackground1)",
  strokeWidth: 4,
  paintOrder: "stroke",
  fontSize: 12,
  fontWeight: 800,
};

const chartAxisLineStyle: CSSProperties = {
  stroke: "var(--colorPaletteMarigoldForeground2)",
  strokeWidth: 2,
};

const chartArrowStyle: CSSProperties = {
  fill: "var(--colorPaletteMarigoldForeground2)",
};

const chartMaxLineStyle: CSSProperties = {
  stroke: "var(--colorPaletteMarigoldForeground2)",
  strokeWidth: 1,
  strokeDasharray: "2 2",
  strokeOpacity: 0.76,
};

const chartBoundaryLineStyle: CSSProperties = {
  stroke: "var(--colorPaletteMarigoldForeground2)",
  strokeWidth: 1,
  strokeDasharray: "2 2",
  strokeOpacity: 0.72,
};

const chartCurrentGuideLineStyle: CSSProperties = {
  stroke: "var(--colorBrandForeground1)",
  strokeWidth: 1,
  strokeDasharray: "3 3",
  strokeOpacity: 0.68,
};

const chartCurveStyle: CSSProperties = {
  fill: "none",
  stroke: "var(--colorPaletteMarigoldForeground2)",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const chartCurrentPointStyle: CSSProperties = {
  fill: "var(--colorBrandForeground1)",
  stroke: "var(--colorNeutralBackground1)",
  strokeWidth: 1.4,
};

const b2dChartTitleTextStyle: CSSProperties = {
  fill: "var(--colorNeutralForeground1)",
  fontSize: 15,
  fontWeight: 800,
};

const b2dFormulaTextStyle: CSSProperties = {
  height: 38,
  overflow: "hidden",
  color: "var(--colorNeutralForeground2)",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: "13px",
  whiteSpace: "normal",
  wordBreak: "break-word",
};

const b2dAxisLineStyle: CSSProperties = {
  stroke: "color-mix(in srgb, var(--colorPaletteMarigoldForeground2) 78%, #5f3b00)",
  strokeWidth: 3,
  strokeLinecap: "round",
};

const b2dArrowStyle: CSSProperties = {
  fill: "color-mix(in srgb, var(--colorPaletteMarigoldForeground2) 78%, #5f3b00)",
};

const b2dCurveStyle: CSSProperties = {
  fill: "none",
  stroke: "#0ea5e9",
  strokeWidth: 3.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const b2dGuideLineStyle: CSSProperties = {
  stroke: "color-mix(in srgb, var(--colorPaletteRedForeground1) 76%, #ff5a5f)",
  strokeWidth: 1.2,
  strokeDasharray: "4 3",
  strokeOpacity: 0.82,
};

const b2dGuideLineSoftStyle: CSSProperties = {
  ...b2dGuideLineStyle,
  strokeOpacity: 0.42,
};

const b2dTickTextStyle: CSSProperties = {
  fill: "#006ce5",
  fontSize: 10,
  fontWeight: 800,
};

const b2dXAxisLabelStyle: CSSProperties = {
  fill: "var(--colorPaletteDarkOrangeForeground2)",
  fontSize: 10,
  fontWeight: 700,
};

function chartDragPointStyle(active: boolean): CSSProperties {
  return {
    fill: active ? "var(--colorBrandForeground1)" : "var(--colorPaletteMarigoldForeground2)",
    stroke: "var(--colorNeutralBackground1)",
    strokeWidth: 1.5,
    transition: "fill 100ms ease-out, r 100ms ease-out",
  };
}

const chartHorizontalDragHitStyle: CSSProperties = {
  fill: "transparent",
  cursor: "ew-resize",
  touchAction: "none",
};

const chartFreeDragHitStyle: CSSProperties = {
  fill: "transparent",
  cursor: "grab",
  touchAction: "none",
};

function thresholdLabelCellStyle(label: MainTargetThresholdRow["label"]): CSSProperties {
  const header = label === "BV";
  return {
    width: 54,
    padding: "6px 7px",
    borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent)",
    borderBottom: label === "Exp"
      ? "none"
      : "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent)",
    background: header
      ? "color-mix(in srgb, var(--normal-sheet-palegreen-bg) 68%, var(--colorNeutralBackground1))"
      : "color-mix(in srgb, var(--colorNeutralForeground1) 9%, var(--colorNeutralBackground2))",
    color: header ? "var(--normal-sheet-palegreen-fg)" : "var(--colorNeutralForeground2)",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
  };
}

function thresholdValueCellStyle(
  label: MainTargetThresholdRow["label"],
  highlighted = false,
  focused = false,
  editable = false,
): CSSProperties {
  const header = label === "BV";
  const baseBackground = header
    ? "color-mix(in srgb, var(--normal-sheet-palegreen-bg) 58%, var(--colorNeutralBackground1))"
    : "color-mix(in srgb, var(--colorNeutralForeground1) 8%, var(--colorNeutralBackground1))";
  return {
    position: "relative",
    minWidth: 0,
    padding: "6px 7px",
    borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 58%, transparent)",
    borderBottom: label === "Exp"
      ? "none"
      : "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 58%, transparent)",
    outline: focused
      ? "1.5px solid var(--colorBrandForeground1)"
      : highlighted
        ? "1.5px solid var(--colorBrandStroke1)"
        : "none",
    outlineOffset: -3,
    background: highlighted
      ? `linear-gradient(0deg, color-mix(in srgb, var(--colorBrandBackground2) 54%, transparent), color-mix(in srgb, var(--colorBrandBackground2) 54%, transparent)), ${baseBackground}`
      : baseBackground,
    color: header ? "var(--normal-sheet-palegreen-fg)" : "var(--colorNeutralForeground1)",
    fontSize: 11,
    fontWeight: highlighted ? 800 : header ? 700 : 500,
    cursor: editable ? "text" : "default",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    transition: "background-color 120ms ease, outline-color 120ms ease",
  };
}

function thresholdCellInputStyle(editable: boolean): CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    border: "none",
    outline: "none",
    padding: "0 2px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontWeight: "inherit",
    textAlign: "center",
    cursor: editable ? "text" : "default",
  };
}

const sourceSectionStyle: CSSProperties = {
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 8,
  margin: "0 0 12px",
  padding: 0,
  background: "var(--colorNeutralBackground1)",
  overflow: "hidden",
};

const sourceSectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  minHeight: 34,
  padding: "0 12px",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground2)",
};

const sourceSectionTitleStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--colorNeutralForeground1)",
  fontSize: 12,
  fontWeight: 700,
};

const sourceSectionSubtitleStyle: CSSProperties = {
  flex: "0 0 auto",
  color: "var(--colorNeutralForeground2)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 11,
  fontWeight: 600,
};

function sourceRowButtonStyle(enabled: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 42%) minmax(0, 1fr)",
    alignItems: "center",
    gap: 12,
    width: "100%",
    minHeight: 42,
    padding: "7px 12px",
    border: "none",
    borderBottom: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 55%, transparent)",
    background: "transparent",
    color: "inherit",
    textAlign: "left",
    cursor: enabled ? "pointer" : "default",
  };
}

const labelStyle: CSSProperties = {
  minWidth: 0,
  overflow: "visible",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  color: "var(--colorNeutralForeground1)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
  lineHeight: "18px",
};

const valueBoxStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minWidth: 50,
  height: 28,
  padding: "0 8px",
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 2,
  background: "var(--colorNeutralBackground3)",
  color: "var(--colorNeutralForeground1)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
  lineHeight: "28px",
};
