import { Fragment, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import {
  Apps24Regular,
  TextBulletList24Regular,
  DataHistogram24Regular,
  FolderAdd24Regular,
  PanelLeftExpand20Filled,
  PanelRightExpand20Filled,
  Search24Regular,
  TableSimple24Regular,
} from "@fluentui/react-icons";
import { Panel, PanelGroup, type ImperativePanelHandle } from "react-resizable-panels";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { CollapsibleCard } from "@/components/common/CollapsibleCard";
import { BadgeStrip } from "@/components/common/BadgeStrip";
import { SortableCard } from "@/components/common/SortableCard";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { getIsp6sSchema, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import { loadImageToml } from "@/ipc/imageScan";
import { saveStateSection } from "@/ipc/stateIo";
import { useMtkStore, DEFAULT_IMAGE_DIR_STATE } from "@/stores/mtkStore";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import type { IspId } from "../ispTabs";
import { AeParamCard } from "./AeParamCard";
import { LceImagePreview, LceTab, TablePane } from "./TablePane/TablePane";
import { NormalTable } from "./TablePane/NormalTable";
import { FaceTable } from "./TablePane/FaceTable";
import { ParaCheckMode } from "./ImagePane/ParaCheckMode";
import {
  computeFaceTouchBadges, computeNormalBadges,
  type NormalBadges, type FaceTouchBadges,
} from "./badges";
import type { PreviewMode } from "./ImagePane/ImagePane";

const ImagePane = lazy(() => import("./ImagePane/ImagePane").then(({ ImagePane }) => ({ default: ImagePane })));

interface Props {
  isp:       IspId;
  tabIdx:    number;
  /** cpp file path — must be present when `parsed` is true so source jumps work. */
  filePath:  string | null;
  /** true once the parameter file has been successfully parsed. */
  parsed:    boolean;
  onImageDirChange: (dir: string) => void;
  onWorkspaceDividerChange: (x: number) => void;
}

const NORMAL_SUB_ACCENTS: Record<string, string> = {
  MainT: "#9558C1", HS: "#2D7BF4", ABL: "#3FB56C", NS: "#E0A23F",
};
const FACE_TOUCH_ACCENTS: Record<string, string> = {
  Face:  "#E94B7A", Touch: "#23B0B0",
};
const NORMAL_SUB_NAMES = ["MainT", "HS", "ABL", "NS"] as const;
const FACE_SUB_NAMES   = ["Face", "Touch"] as const;
const TOP_NAMES        = ["Normal", "Face"] as const;
const CARD_GAP_PX      = 12;
const WORKSPACE_DIVIDER_ID = "isp6s-workspace-source-divider";
const WORKSPACE_CARD_IDS = ["imageList", "imageInfo", "sourceCode"] as const;
const UPPER_WORKSPACE_CARD_IDS = ["imageList", "imageInfo"] as const;
const CHART_TARGET_BY_CARD: Record<string, string> = {
  MainT: "MainT",
  HS: "HS",
  ABL: "ABL",
  NS: "NS",
  Face: "Face_FLT",
  Touch: "Touch",
};

interface CardJumpTarget {
  label: string;
  key:   number;
}

function sanitiseOrder(order: string[], canonical: readonly string[]): string[] {
  const known = new Set<string>(canonical);
  const cleaned = order.filter((id) => known.has(id));
  for (const id of canonical) {
    if (!cleaned.includes(id)) cleaned.push(id);
  }
  return cleaned;
}

function imageTomlValue(data: Record<string, string>, keys: readonly string[]): string | null {
  const entries = Object.entries(data);
  for (const key of keys) {
    const value = entries.find(([candidate]) =>
      candidate.toLowerCase() === key.toLowerCase()
      || candidate.toLowerCase().endsWith(`.${key.toLowerCase()}`),
    )?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

interface CaptureMetadata {
  path: string;
  exposure: string | null;
  iso: string | null;
}

function formatExposureTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    if (value < 1) return `1/${Math.round(1 / value)} s`;
    return `${value} s`;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatImageMetadata(path: string, data: Record<string, string>, capture: CaptureMetadata | null): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const exposure = (capture?.path === path ? capture.exposure : null) ?? imageTomlValue(data, [
    "ExposureTime", "Exposure Time", "AE_TAG_EXP_TIME", "AE_TAG_REAL_EXP_TIME",
  ]);
  const iso = (capture?.path === path ? capture.iso : null) ?? imageTomlValue(data, [
    "ISO", "ISOSpeedRatings", "PhotographicSensitivity", "AE_TAG_REAL_ISO", "AE_TAG_ISO",
  ]);
  return `${name}  曝光时间 ${exposure ?? "-"}  ISO ${iso ?? "-"}`;
}

export function Isp6sAeVisual({ isp, tabIdx, filePath, onImageDirChange, onWorkspaceDividerChange }: Props) {
  const [schema, setSchema] = useState<Isp6sSchemaRoot | null>(null);
  const [err,    setErr]    = useState<string | null>(null);
  /** Card that was last clicked — drives the source jump in `param_map` mode. */
  const [chartCardTarget, setChartCardTarget] = useState<CardJumpTarget | undefined>(undefined);
  const [sourceCardTarget, setSourceCardTarget] = useState<CardJumpTarget | undefined>(undefined);
  const [detailsTab, setDetailsTab] = useState<"normal" | "face" | "lce" | "bcompare">("normal");
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [imageSearchError, setImageSearchError] = useState<string | null>(null);
  const [showImageMetadata, setShowImageMetadata] = useState(false);
  const [captureMetadata, setCaptureMetadata] = useState<CaptureMetadata | null>(null);
  const workspaceRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceLeftRef = useRef<HTMLDivElement | null>(null);
  const reportWorkspaceDivider = useCallback(() => {
    const rect = document.getElementById(WORKSPACE_DIVIDER_ID)?.getBoundingClientRect();
    if (rect) onWorkspaceDividerChange(rect.left + rect.width / 2);
  }, [onWorkspaceDividerChange]);

  useLayoutEffect(() => {
    const root = workspaceRootRef.current;
    const left = workspaceLeftRef.current;
    if (!schema || !root || !left) return;
    const observer = new ResizeObserver(reportWorkspaceDivider);
    observer.observe(root);
    observer.observe(left);
    reportWorkspaceDivider();
    return () => observer.disconnect();
  }, [schema, reportWorkspaceDivider]);
  const cardJumpKeyRef = useRef(0);

  const imageDirEntry = useMtkStore((s) => s.imageDir[`${isp}|${tabIdx}`]);
  const imageDir      = imageDirEntry ?? DEFAULT_IMAGE_DIR_STATE;
  const currentEntry = imageDir.entries[imageDir.current];
  const setImageDir   = useMtkStore((s) => s.setImageDir);

  useEffect(() => {
    if (!showImageMetadata || !currentEntry) return;
    let cancelled = false;
    const path = currentEntry.jpg_path;
    (async () => {
      try {
        const bytes = await readFile(path);
        const { parse } = await import("exifr");
        const exif = await parse(bytes, { pick: ["ExposureTime", "ISO", "ISOSpeedRatings", "PhotographicSensitivity"] });
        if (!cancelled) {
          setCaptureMetadata({
            path,
            exposure: formatExposureTime(exif?.ExposureTime),
            iso: exif?.ISO != null || exif?.ISOSpeedRatings != null || exif?.PhotographicSensitivity != null
              ? String(exif.ISO ?? exif.ISOSpeedRatings ?? exif.PhotographicSensitivity)
              : null,
          });
        }
      } catch {
        if (!cancelled) setCaptureMetadata({ path, exposure: null, iso: null });
      }
    })();
    return () => { cancelled = true; };
  }, [showImageMetadata, currentEntry?.jpg_path]);

  const visual   = useIsp6sVisualStore((s) => s.visual);
  const patchVis = useIsp6sVisualStore((s) => s.patch);

  /* Debounced visual-state persistence. */
  useEffect(() => {
    const t = setTimeout(() => {
      saveStateSection("isp6s_ae_visual", visual)
        .catch((err) => console.warn("save visual", err));
    }, 200);
    return () => clearTimeout(t);
  }, [visual]);

  useEffect(() => {
    let cancelled = false;
    getIsp6sSchema()
      .then((s) => { if (!cancelled) setSchema(s); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  /* Image switching is driven by TablePane row clicks; folder selection also
   * lives in the image-list card. */
  const onPickImage = async (idx: number) => {
    if (idx < 0 || idx >= imageDir.entries.length) return;
    setImageDir(isp, tabIdx, { current: idx, status: "loading", message: null });
    try {
      const tomlData = await loadImageToml(imageDir.entries[idx].toml_path);
      setImageDir(isp, tabIdx, {
        tomlData, status: "done",
        message: `当前 ${imageDir.entries[idx].name}`,
      });
    } catch (e) {
      setImageDir(isp, tabIdx, {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleImageSearch = async () => {
    const query = imageSearchQuery.trim();
    if (!query) {
      setImageSearchError(null);
      return;
    }

    const normalise = (value: string) => value.toLocaleLowerCase().replace(/[\s_.-]+/g, "");
    const fuzzyMatches = (candidate: string, search: string) => {
      const text = normalise(candidate);
      const needle = normalise(search);
      if (!needle) return false;
      if (text.includes(needle)) return true;
      let offset = 0;
      for (const character of needle) {
        offset = text.indexOf(character, offset);
        if (offset < 0) return false;
        offset += 1;
      }
      return true;
    };

    const matchIndex = imageDir.entries.findIndex((entry) => {
      const fileName = entry.jpg_path.split(/[\\/]/).filter(Boolean).pop() ?? entry.name;
      return fuzzyMatches(entry.name, query) || fuzzyMatches(fileName, query);
    });
    if (matchIndex < 0) {
      setImageSearchError("未找到匹配图片");
      return;
    }

    const matched = imageDir.entries[matchIndex];
    const fileName = matched.jpg_path.split(/[\\/]/).filter(Boolean).pop() ?? matched.name;
    setImageSearchQuery(fileName);
    setImageSearchError(null);
    await onPickImage(matchIndex);
  };

  const pickImageDir = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") onImageDirChange(picked);
  };

  const normalBadges = useMemo(
    () => schema ? computeNormalBadges(schema, imageDir.tomlData) : null,
    [schema, imageDir.tomlData],
  );
  const faceBadges = useMemo(
    () => schema ? computeFaceTouchBadges(schema, imageDir.tomlData) : null,
    [schema, imageDir.tomlData],
  );

  const topOrder    = useMemo(() => sanitiseOrder(visual.top_card_order,    TOP_NAMES),        [visual.top_card_order]);
  const normalOrder = useMemo(() => sanitiseOrder(visual.normal_card_order, NORMAL_SUB_NAMES), [visual.normal_card_order]);
  const faceOrder   = useMemo(() => sanitiseOrder(visual.face_card_order,   FACE_SUB_NAMES),   [visual.face_card_order]);
  const workspaceOrder = useMemo(
    () => sanitiseOrder(visual.workspace_card_order ?? [], WORKSPACE_CARD_IDS),
    [visual.workspace_card_order],
  );
  const workspaceRatios = useMemo(() => {
    const values = visual.workspace_column_ratios ?? [];
    return values.length === WORKSPACE_CARD_IDS.length
      && values.every((value) => Number.isFinite(value) && value >= 0)
      && values.some((value) => value > 0)
      ? values
      : [34, 33, 33];
  }, [visual.workspace_column_ratios]);
  const upperWorkspaceOrder = useMemo(
    () => sanitiseOrder(
      workspaceOrder.filter((id) => id !== "sourceCode"),
      UPPER_WORKSPACE_CARD_IDS,
    ),
    [workspaceOrder],
  );
  const workspaceRatioById = useMemo(
    () => Object.fromEntries(workspaceOrder.map((id, index) => [id, workspaceRatios[index] ?? 0])),
    [workspaceOrder, workspaceRatios],
  );
  const upperWorkspaceSizes = useMemo(() => {
    const values = upperWorkspaceOrder.map((id) => workspaceRatioById[id] ?? 50);
    const total = values.reduce((sum, value) => sum + value, 0) || 100;
    return values.map((value) => (value / total) * 100);
  }, [upperWorkspaceOrder, workspaceRatioById]);
  const sourceColumnSize = Math.min(70, Math.max(24, workspaceRatioById.sourceCode || 33));
  const upperPanelRefs = useRef<Record<string, ImperativePanelHandle | null>>({});
  const [collapsedUpperCards, setCollapsedUpperCards] = useState<Set<string>>(new Set());

  const markUpperCardCollapsed = (cardId: string) => {
    setCollapsedUpperCards((current) => {
      const next = new Set(current);
      next.add(cardId);
      return next;
    });
  };

  const markUpperCardExpanded = (cardId: string) => {
    setCollapsedUpperCards((current) => {
      if (!current.has(cardId)) return current;
      const next = new Set(current);
      next.delete(cardId);
      return next;
    });
  };

  const restoreUpperCard = (cardId: string) => {
    upperPanelRefs.current[cardId]?.expand(24);
    markUpperCardExpanded(cardId);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dragEndHandler =
    (current: string[], commit: (next: string[]) => void) =>
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const oldIdx = current.indexOf(String(active.id));
      const newIdx = current.indexOf(String(over.id));
      if (oldIdx < 0 || newIdx < 0) return;
      requestAnimationFrame(() => commit(arrayMove(current, oldIdx, newIdx)));
    };

  /** Left click opens the chart tab; right click opens the matching source range. */
  const nextCardJumpTarget = (label: string): CardJumpTarget => {
    cardJumpKeyRef.current += 1;
    return { label, key: cardJumpKeyRef.current };
  };

  const onCardClick = (card: string) => {
    setChartCardTarget(nextCardJumpTarget(CHART_TARGET_BY_CARD[card] ?? card));
    patchVis({ preview_mode: "chart_map" });
  };

  const onCardContextMenu = (event: MouseEvent<HTMLDivElement>, card: string) => {
    event.preventDefault();
    setSourceCardTarget(nextCardJumpTarget(card));
    patchVis({ preview_mode: "param_map" });
  };

  const setPreviewMode = (m: PreviewMode) => patchVis({ preview_mode: m });

  // Kept for backward-compatible hidden header actions; layout switching is
  // now exposed through the collapse chevron context menu.
  const toggleNormalLayout = () =>
    patchVis({ normal_wf_row_mode: !visual.normal_wf_row_mode });
  const toggleFaceLayout = () =>
    patchVis({ face_wf_row_mode: !visual.face_wf_row_mode });

  if (err) {
    return (
      <div className="m-4 rounded-md border p-4 text-sm"
           style={{
             background: "var(--colorPaletteRedBackground1)",
             borderColor:"var(--colorPaletteRedBorder1)",
             color:      "var(--colorPaletteRedForeground1)",
           }}>
        无法加载 Isp6s.toml：{err}
      </div>
    );
  }
  if (!schema) {
    return (
      <div className="p-4 text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
        加载 Isp6s schema…
      </div>
    );
  }

  /* ── Image information card ── */
  const renderCardArea = () => (
    <div className="flex h-full w-full min-w-0 flex-col"
         style={{
           background:  "var(--colorNeutralBackground1)",
           border:      "1px solid var(--colorNeutralStroke2)",
           borderRadius: 12,
           overflow:    "hidden",
         }}>
      {/* Header bar — kept outside the scroll area so the divider stays put. */}
        <div className="flex h-8 shrink-0 items-center pl-10 pr-4"
            style={{
              background: "var(--colorNeutralBackground2)",
            }}>
        <div className="flex min-w-0 items-center text-xs"
             style={{ color: "var(--colorNeutralForeground2)" }}>
          <span className="truncate">图片信息卡片</span>
         </div>
        </div>
        <div className="hidden"
             style={{
               background: "var(--colorNeutralBackground1)",
               borderBottom: "1px solid var(--colorNeutralStroke2)",
             }}>
          <Search24Regular className="h-4 w-4 shrink-0"
                           style={{ color: "var(--colorNeutralForeground3)" }} />
          <input
            type="search"
            value={imageSearchQuery}
            onChange={(event) => {
              setImageSearchQuery(event.target.value);
              if (imageSearchError) setImageSearchError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void handleImageSearch();
            }}
            placeholder="搜索图片名称"
            aria-label="搜索图片名称"
            aria-invalid={Boolean(imageSearchError)}
            title={imageSearchError ?? "输入图片名称后按 Enter 搜索"}
            className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
            style={{
              color: "var(--colorNeutralForeground2)",
              caretColor: "var(--colorBrandForeground1)",
            }}
          />
          {imageSearchError && (
            <span className="shrink-0 text-[10px]" style={{ color: "var(--colorPaletteRedForeground1)" }}>
              {imageSearchError}
            </span>
          )}
        </div>

        <div className="flex h-8 shrink-0 items-center gap-2 px-4"
             style={{
               background: "var(--colorNeutralBackground1)",
               borderBottom: "1px solid var(--colorNeutralStroke2)",
               display: "none",
             }}>
          <HoverTooltip content="添加图片文件夹" positioning="below-center" inline>
            <Button
              size="small"
              appearance="subtle"
              icon={<FolderAdd24Regular />}
              onClick={pickImageDir}
              aria-label="添加图片文件夹"
            />
          </HoverTooltip>
          <span className="min-w-0 flex-1 truncate text-[11px]"
                style={{ color: "var(--colorNeutralForeground3)" }}>
            {imageDir.dir ?? "点击文件夹图标添加图片文件夹"}
          </span>
        </div>

        <div className="flex h-8 shrink-0 items-center px-4"
             style={{
               background: "var(--colorNeutralBackground1)",
               borderBottom: "1px solid var(--colorNeutralStroke2)",
             }}>
          <span className="min-w-0 flex-1 truncate text-[11px]"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setShowImageMetadata((shown) => !shown);
                }}
                title={showImageMetadata ? "右键显示完整路径" : "右键显示图片名称、曝光时间和 ISO"}
                style={{ color: "var(--colorNeutralForeground3)" }}>
            {showImageMetadata && currentEntry
              ? formatImageMetadata(currentEntry.jpg_path, imageDir.tomlData, captureMetadata)
              : currentEntry?.jpg_path ?? imageDir.dir ?? "未选择图片文件"}
          </span>
        </div>

        {/* Scrollable body */}
       <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3"
            style={{ background: "var(--colorNeutralBackground1)" }}>
         <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={dragEndHandler(topOrder, (next) => patchVis({ top_card_order: next }))}
        >
          <SortableContext items={topOrder} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-3">
              {topOrder.map((name) => (
                <SortableCard
                  key={name}
                  id={name}
                  headerHeight={44}
                  handleLeft={9}
                  borderRadius={12}
                >
                  {renderTopCard(name)}
                </SortableCard>
              ))}
            </div>
          </SortableContext>
         </DndContext>
         <div className="flex min-h-[260px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg border p-3"
              style={{
                borderColor: "var(--colorNeutralStroke2)",
                background: "var(--colorNeutralBackground1)",
              }}>
           <LceImagePreview entry={currentEntry} />
         </div>
       </div>
    </div>
  );

  const renderDetailsPanel = () => {
    const tabs: Array<{ id: typeof detailsTab; label: string }> = [
      { id: "normal", label: "Normal" },
      { id: "face", label: "Face" },
      { id: "lce", label: "LCE" },
      { id: "bcompare", label: "bcompare" },
    ];

    return (
      <div className="flex h-full w-full flex-col overflow-hidden"
           style={{
             background: "var(--colorNeutralBackground1)",
             border: "1px solid var(--colorNeutralStroke2)",
             borderRadius: 8,
           }}>
        <div className="flex h-8 shrink-0 items-stretch px-2"
             style={{
               background: "var(--colorNeutralBackground2)",
               borderBottom: "1px solid var(--colorNeutralStroke2)",
             }}>
          {tabs.map((tab) => {
            const active = detailsTab === tab.id;
            const button = (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setDetailsTab(tab.id)}
                className="px-3 text-xs transition-colors"
                style={{
                  color: active ? "var(--colorNeutralForeground1)" : "var(--colorNeutralForeground3)",
                  background: active ? "var(--colorNeutralBackground1)" : "transparent",
                  border: 0,
                  borderBottom: active ? "2px solid var(--colorBrandStroke1)" : "2px solid transparent",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {tab.label}
              </button>
            );
            return tab.id === "bcompare" ? (
              <HoverTooltip key={tab.id} content="bmcompare" positioning="above-center" inline>
                {button}
              </HoverTooltip>
            ) : button;
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {detailsTab === "normal" && <NormalTable tomlData={imageDir.tomlData} />}
          {detailsTab === "face" && <FaceTable tomlData={imageDir.tomlData} />}
          {detailsTab === "lce" && (
            <LceTab
              schema={schema}
              tomlData={imageDir.tomlData}
            />
          )}
          {detailsTab === "bcompare" && (
            <ParaCheckMode
              filePath={filePath ?? ""}
              schema={schema}
              tomlData={imageDir.tomlData}
            />
          )}
        </div>
      </div>
    );
  };

  const renderTopCard = (name: string) => {
    if (name === "Normal") {
      return (
        <CollapsibleCard
          title="Normal"
          collapsed={visual.normal_collapsed}
          onToggle={(c) => patchVis({ normal_collapsed: c })}
          onToggleContextMenu={() => patchVis({ normal_wf_row_mode: !visual.normal_wf_row_mode })}
          hideHeaderExtra
          surface="panel"
          badges={
            <BadgeStrip
              items={[
                { label: "CWR",           value: normalBadges?.cwr ?? "—", hint: schema.card?.Normal?.CWR },
                { label: "Cal",           value: normalBadges?.cal ?? "—" },
              ]}
            />
          }
          headerExtra={
            <HoverTooltip content={visual.normal_wf_row_mode ? "切换网格" : "切换单行"}
                          positioning="below-center" inline>
              <Button size="small" appearance="subtle"
                      icon={visual.normal_wf_row_mode ? <Apps24Regular /> : <TextBulletList24Regular />}
                      onClick={toggleNormalLayout} />
            </HoverTooltip>
          }
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={dragEndHandler(normalOrder, (next) => patchVis({ normal_card_order: next }))}
          >
            <SortableContext
              items={normalOrder}
              strategy={visual.normal_wf_row_mode ? horizontalListSortingStrategy : rectSortingStrategy}
            >
              <div className={visual.normal_wf_row_mode
                ? "flex flex-row gap-2.5"
                : "grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4"}>
                {normalOrder.map((sub) => (
                  <SortableCard
                    key={sub}
                    id={sub}
                    className={visual.normal_wf_row_mode ? "min-w-0 flex-1" : undefined}
                    headerHeight={40}
                    fullCardHandle
                    showHandle={false}
                    borderRadius={8}
                  >
                    <NormalSub name={sub} badges={normalBadges}
                               onClick={() => onCardClick(sub)}
                               onContextMenu={(event) => onCardContextMenu(event, sub)} />
                  </SortableCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </CollapsibleCard>
      );
    }
    if (name === "Face") {
      return (
        <CollapsibleCard
          title="Face"
          collapsed={visual.face_collapsed}
          onToggle={(c) => patchVis({ face_collapsed: c })}
          onToggleContextMenu={() => patchVis({ face_wf_row_mode: !visual.face_wf_row_mode })}
          hideHeaderExtra
          surface="panel"
          badges={
            <BadgeStrip
              items={[
                { label: "CWR",      value: faceBadges?.cwr      ?? "—" },
                { label: "LCE_Gain", value: faceBadges?.lce_gain ?? "—" },
              ]}
            />
          }
          headerExtra={
            <HoverTooltip content={visual.face_wf_row_mode ? "切换网格" : "切换单行"}
                          positioning="below-center" inline>
              <Button size="small" appearance="subtle"
                      icon={visual.face_wf_row_mode ? <Apps24Regular /> : <TextBulletList24Regular />}
                      onClick={toggleFaceLayout} />
            </HoverTooltip>
          }
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={dragEndHandler(faceOrder, (next) => patchVis({ face_card_order: next }))}
          >
            <SortableContext
              items={faceOrder}
              strategy={visual.face_wf_row_mode ? horizontalListSortingStrategy : rectSortingStrategy}
            >
              <div className={visual.face_wf_row_mode
                ? "flex flex-row gap-2.5"
                : "grid grid-cols-1 gap-2.5 md:grid-cols-2"}>
                {faceOrder.map((sub) => (
                  <SortableCard
                    key={sub}
                    id={sub}
                    className={visual.face_wf_row_mode ? "min-w-0 flex-1" : undefined}
                    headerHeight={40}
                    fullCardHandle
                    showHandle={false}
                    borderRadius={8}
                  >
                    <FaceTouchSub name={sub} badges={faceBadges}
                                  onClick={() => onCardClick(sub)}
                                  onContextMenu={(event) => onCardContextMenu(event, sub)} />
                  </SortableCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </CollapsibleCard>
      );
    }
    return null;
  };

  /* ── Table panel — wraps TablePane in standard padding. ── */
  const renderTablePanel = () => (
    <div className="h-full w-full min-w-0">
      <Suspense fallback={<PaneFallback label="正在加载图片列表..." />}>
        <TablePane
          schema={schema}
          entries={imageDir.entries}
          current={imageDir.current}
          imageDir={imageDir.dir}
          onPickImage={onPickImage}
          onImageDirChange={onImageDirChange}
          imageSearchQuery={imageSearchQuery}
          imageSearchError={imageSearchError}
          onImageSearchQueryChange={(value) => {
            setImageSearchQuery(value);
            if (imageSearchError) setImageSearchError(null);
          }}
          onImageSearch={() => void handleImageSearch()}
        />
      </Suspense>
    </div>
  );

  /* ── Final layout ── */
  const renderSourceCodePanel = () => (
    <div className="h-full w-full min-w-0">
      <Suspense fallback={<PaneFallback label="正在加载源代码卡片..." />}>
        <ImagePane
          mode={visual.preview_mode ?? "param_map"}
          onMode={setPreviewMode}
          filePath={filePath ?? ""}
          schema={schema}
          entry={currentEntry}
          tomlData={imageDir.tomlData}
          chartCardTarget={chartCardTarget}
          sourceCardTarget={sourceCardTarget}
        />
      </Suspense>
    </div>
  );

  const upperWorkspacePanels: Record<(typeof UPPER_WORKSPACE_CARD_IDS)[number], ReactNode> = {
    imageList: renderTablePanel(),
    imageInfo: renderCardArea(),
  };

  const handleWorkspaceDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = upperWorkspaceOrder.indexOf(String(active.id));
    const newIndex = upperWorkspaceOrder.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextOrder = arrayMove(upperWorkspaceOrder, oldIndex, newIndex);
    patchVis({
      workspace_card_order: [...nextOrder, "sourceCode"],
      workspace_column_ratios: [
        ...nextOrder.map((id) => workspaceRatioById[id] ?? 33),
        sourceColumnSize,
      ],
    });
  };

  const updateSourceColumnSize = (size: number) => {
    const nextSourceSize = Math.min(70, Math.max(24, size));
    const upperTotal = Math.max(1, 100 - nextSourceSize);
    const currentUpperTotal = upperWorkspaceOrder
      .reduce((sum, id) => sum + (workspaceRatioById[id] ?? 0), 0) || 100;
    patchVis({
      workspace_card_order: [...upperWorkspaceOrder, "sourceCode"],
      workspace_column_ratios: [
        ...upperWorkspaceOrder.map((id) => ((workspaceRatioById[id] ?? 50) / currentUpperTotal) * upperTotal),
        nextSourceSize,
      ],
    });
  };

  const updateUpperWorkspaceSize = (cardId: string, size: number) => {
    const nextCardSize = Math.max(0, size);
    const upperTotal = Math.max(1, 100 - sourceColumnSize);
    const nextRatios = upperWorkspaceOrder.map((id) =>
      id === cardId
        ? (nextCardSize / 100) * upperTotal
        : workspaceRatioById[id] ?? 0,
    );
    const currentUpperTotal = nextRatios.reduce((sum, value) => sum + value, 0);
    const normalizedRatios = currentUpperTotal > 0
      ? nextRatios.map((value) => (value / currentUpperTotal) * upperTotal)
      : upperWorkspaceOrder.map(() => upperTotal / upperWorkspaceOrder.length);
    patchVis({
      workspace_card_order: [...upperWorkspaceOrder, "sourceCode"],
      workspace_column_ratios: [
        ...upperWorkspaceOrder.map((_, index) => normalizedRatios[index] ?? 0),
        sourceColumnSize,
      ],
    });
  };

  return (
    <div ref={workspaceRootRef} className="h-full w-full min-w-0">
    <PanelGroup direction="horizontal" className="h-full w-full min-w-0">
      <Panel defaultSize={100 - sourceColumnSize} minSize={30} className="min-w-0 overflow-hidden">
        <div ref={workspaceLeftRef} className="h-full w-full min-w-0">
        <PanelGroup direction="vertical" className="h-full w-full min-w-0">
          <Panel defaultSize={58} minSize={30}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleWorkspaceDragEnd}>
              <SortableContext items={upperWorkspaceOrder} strategy={horizontalListSortingStrategy}>
                <div className="relative h-full w-full min-w-0">
                  <PanelGroup
                    key={upperWorkspaceOrder.join("|")}
                    direction="horizontal"
                    className="h-full w-full"
                  >
                    {upperWorkspaceOrder.map((id, index) => {
                      const cardId = id as (typeof UPPER_WORKSPACE_CARD_IDS)[number];
                      return (
                        <Fragment key={cardId}>
                          {index > 0 && <ResizeHandle direction="horizontal" size={CARD_GAP_PX} />}
                          <Panel
                            ref={(panel) => { upperPanelRefs.current[cardId] = panel; }}
                            id={cardId}
                            order={index}
                            defaultSize={upperWorkspaceSizes[index]}
                            minSize={18}
                            collapsible
                            collapsedSize={0}
                            onCollapse={() => markUpperCardCollapsed(cardId)}
                            onExpand={() => markUpperCardExpanded(cardId)}
                            onResize={(size) => updateUpperWorkspaceSize(cardId, size)}
                          >
                            <SortableCard
                              id={cardId}
                              className="h-full min-w-0"
                              headerHeight={32}
                              handleLeft={14}
                              handleIcon={cardId === "imageList"
                                ? <TableSimple24Regular className="h-4 w-4" />
                                : <DataHistogram24Regular className="h-4 w-4" />}
                              handleTitle={cardId === "imageList" ? "拖拽移动图片列表卡片" : "拖拽移动图片信息卡片"}
                              borderRadius={12}
                            >
                              {upperWorkspacePanels[cardId]}
                            </SortableCard>
                          </Panel>
                        </Fragment>
                      );
                    })}
                  </PanelGroup>
                  {upperWorkspaceOrder.map((cardId, index) => {
                    if (!collapsedUpperCards.has(cardId)) return null;
                    const isLeft = index === 0;
                    return (
                      <button
                        key={`restore-${cardId}`}
                        type="button"
                        title={`Restore ${cardId === "imageList" ? "image list" : "image info"}`}
                        aria-label={`Restore ${cardId === "imageList" ? "image list" : "image info"}`}
                        onClick={() => restoreUpperCard(cardId)}
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: isLeft ? 4 : undefined,
                          right: isLeft ? undefined : 4,
                          zIndex: 20,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 28,
                          height: 28,
                          transform: "translateY(-50%)",
                          border: "1px solid var(--colorNeutralStroke2)",
                          borderRadius: 8,
                          background: "var(--colorNeutralBackground1)",
                          color: "var(--colorBrandForeground1)",
                          cursor: "pointer",
                        }}
                      >
                        {isLeft
                          ? <PanelLeftExpand20Filled />
                          : <PanelRightExpand20Filled />}
                      </button>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </Panel>
          <ResizeHandle direction="vertical" size={CARD_GAP_PX} />
          <Panel defaultSize={42} minSize={25}>
            {renderDetailsPanel()}
          </Panel>
        </PanelGroup>
        </div>
      </Panel>
      <ResizeHandle id={WORKSPACE_DIVIDER_ID} direction="horizontal" size={CARD_GAP_PX} />
      <Panel defaultSize={sourceColumnSize} minSize={24} className="min-w-0 overflow-hidden" onResize={updateSourceColumnSize}>
        {renderSourceCodePanel()}
      </Panel>
    </PanelGroup>
    </div>
  );

}

/* ─── Sub-card renderers ─── */

function PaneFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs"
         style={{ color: "var(--colorNeutralForeground3)" }}>
      {label}
    </div>
  );
}

function NormalSub({
  name, badges, onClick, onContextMenu,
}: {
  name: string;
  badges: NormalBadges | null;
  onClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const sub = badges?.perSub[name as "MainT" | "HS" | "ABL" | "NS"];
  return (
    <AeParamCard
      title={name}
      accent={NORMAL_SUB_ACCENTS[name]}
      onClick={onClick}
      onContextMenu={onContextMenu}
      badges={[
        { label: "WT",  value: sub?.wt  ?? "—", hint: sub?.wtKey  || "(未映射)" },
        { label: "Tar", value: sub?.tar ?? "—", hint: sub?.tarKey || "(未映射)" },
      ]}
    />
  );
}

function FaceTouchSub({
  name, badges, onClick, onContextMenu,
}: {
  name: string;
  badges: FaceTouchBadges | null;
  onClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  if (name === "Face") {
    return (
      <AeParamCard
        title="Face"
        accent={FACE_TOUCH_ACCENTS.Face}
        onClick={onClick}
        onContextMenu={onContextMenu}
        badges={[
          { label: "WT",  value: badges?.face.wt  ?? "—", hint: badges?.face.wtKey  ?? "(未映射)" },
          { label: "FBT", value: badges?.face.fbt ?? "—", hint: badges?.face.fbtKey ?? "(未映射)" },
          { label: "FLT", value: badges?.face.flt ?? "—", hint: badges?.face.fltKey ?? "(未映射)" },
        ]}
      />
    );
  }
  return (
    <AeParamCard
      title="Touch"
      accent={FACE_TOUCH_ACCENTS.Touch}
      onClick={onClick}
      onContextMenu={onContextMenu}
      badges={[
        { label: "WT",  value: badges?.touch.wt  ?? "—", hint: badges?.touch.wtKey  ?? "(未映射)" },
        { label: "Tar", value: badges?.touch.tar ?? "—", hint: badges?.touch.tarKey ?? "(未映射)" },
      ]}
    />
  );
}
