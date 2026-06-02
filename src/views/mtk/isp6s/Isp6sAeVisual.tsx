import { useEffect, useMemo, useState } from "react";
import { Button } from "@fluentui/react-components";
import {
  Add24Regular,
  Subtract24Regular,
  Apps24Regular,
  TextBulletList24Regular,
  DataHistogram24Regular,
} from "@fluentui/react-icons";
import { Panel, PanelGroup } from "react-resizable-panels";

import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove,
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
import {
  computeFaceTouchBadges, computeNormalBadges,
  type NormalBadges, type FaceTouchBadges,
} from "./badges";
import { ImagePane, type PreviewMode } from "./ImagePane/ImagePane";
import { TablePane } from "./TablePane/TablePane";

interface Props {
  isp:       IspId;
  tabIdx:    number;
  /** cpp file path — must be present when `parsed` is true so source jumps work. */
  filePath:  string | null;
  /** true once the parameter file has been successfully parsed. */
  parsed:    boolean;
  onImageDirChange: (dir: string) => void;
}

const NORMAL_SUB_ACCENTS: Record<string, string> = {
  MainT: "#9558C1", HS: "#2D7BF4", ABL: "#3FB56C", NS: "#E0A23F",
};
const FACE_TOUCH_ACCENTS: Record<string, string> = {
  Face:  "#E94B7A", Touch: "#23B0B0",
};
const NORMAL_SUB_NAMES = ["MainT", "HS", "ABL", "NS"] as const;
const FACE_SUB_NAMES   = ["Face", "Touch"] as const;
const TOP_NAMES        = ["Normal", "Face/Touch"] as const;
const CARD_GAP_PX      = 12;

function sanitiseOrder(order: string[], canonical: readonly string[]): string[] {
  const known = new Set<string>(canonical);
  const cleaned = order.filter((id) => known.has(id));
  for (const id of canonical) {
    if (!cleaned.includes(id)) cleaned.push(id);
  }
  return cleaned;
}

export function Isp6sAeVisual({ isp, tabIdx, filePath, parsed, onImageDirChange }: Props) {
  const [schema, setSchema] = useState<Isp6sSchemaRoot | null>(null);
  const [err,    setErr]    = useState<string | null>(null);
  /** Card that was last clicked — drives the source jump in `param_map` mode. */
  const [activeCard, setActiveCard] = useState<string | undefined>(undefined);

  const imageDirEntry = useMtkStore((s) => s.imageDir[`${isp}|${tabIdx}`]);
  const imageDir      = imageDirEntry ?? DEFAULT_IMAGE_DIR_STATE;
  const setImageDir   = useMtkStore((s) => s.setImageDir);

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

  const bothCollapsed = visual.normal_collapsed && visual.face_collapsed;
  const toggleAll = () =>
    patchVis({ normal_collapsed: !bothCollapsed, face_collapsed: !bothCollapsed });
  const toggleNormalLayout = () =>
    patchVis({ normal_wf_row_mode: !visual.normal_wf_row_mode });
  const toggleFaceLayout = () =>
    patchVis({ face_wf_row_mode:   !visual.face_wf_row_mode });

  /** When user clicks a sub-card, snap the right pane to param_map mode and
   *  remember the card so the source view can scroll there. */
  const onCardClick = (card: string) => {
    setActiveCard(card);
    patchVis({ preview_mode: "param_map" });
  };

  const setPreviewMode = (m: PreviewMode) => patchVis({ preview_mode: m });

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

  const currentEntry = imageDir.entries[imageDir.current];
  const hasEntries   = imageDir.entries.length > 0;

  /* ── Card area: visualization cards (no inline image switcher — TablePane
   *    handles picking now) ── */
  const renderCardArea = () => (
    <div className="flex h-full w-full flex-col"
         style={{
           background:  "var(--colorNeutralBackground2)",
           border:      "1px solid var(--colorNeutralStroke2)",
           borderRadius: 12,
           overflow:    "hidden",
         }}>
      {/* Header bar — kept outside the scroll area so the divider stays put. */}
      <div className="flex h-11 shrink-0 items-center justify-between px-4"
           style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
        <div className="flex items-center gap-2 text-xs"
             style={{ color: "var(--colorNeutralForeground2)" }}>
          <DataHistogram24Regular className="h-4 w-4"
                                  style={{ color: "var(--colorBrandForeground1)" }} />
          <span>可视化卡片</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="small" appearance="subtle"
            icon={bothCollapsed ? <Add24Regular /> : <Subtract24Regular />}
            onClick={toggleAll}
          >
            {bothCollapsed ? "全部展开" : "全部收起"}
          </Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={dragEndHandler(topOrder, (next) => patchVis({ top_card_order: next }))}
        >
          <SortableContext items={topOrder} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-4">
              {topOrder.map((name) => (
                <SortableCard
                  key={name}
                  id={name}
                  headerHeight={48}
                  handleLeft={10}
                  borderRadius={12}
                >
                  {renderTopCard(name)}
                </SortableCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );

  const renderTopCard = (name: string) => {
    if (name === "Normal") {
      return (
        <CollapsibleCard
          title="Normal"
          collapsed={visual.normal_collapsed}
          onToggle={(c) => patchVis({ normal_collapsed: c })}
          badges={
            <BadgeStrip
              items={[
                { label: "CWR",           value: normalBadges?.cwr ?? "—", hint: schema.card?.Normal?.CWR },
                { label: "_",             value: normalBadges?.tar_abl_mt_hs ?? "—", hint: "tar_abl_mt_hs" },
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
              strategy={visual.normal_wf_row_mode ? verticalListSortingStrategy : rectSortingStrategy}
            >
              <div className={visual.normal_wf_row_mode
                ? "flex flex-col gap-3"
                : "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"}>
                {normalOrder.map((sub) => (
                  <SortableCard
                    key={sub}
                    id={sub}
                    headerHeight={44}
                    fullCardHandle
                    showHandle={false}
                    borderRadius={8}
                  >
                    <NormalSub name={sub} badges={normalBadges}
                               onClick={() => onCardClick(sub)} />
                  </SortableCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </CollapsibleCard>
      );
    }
    if (name === "Face/Touch") {
      return (
        <CollapsibleCard
          title="Face / Touch"
          collapsed={visual.face_collapsed}
          onToggle={(c) => patchVis({ face_collapsed: c })}
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
              strategy={visual.face_wf_row_mode ? verticalListSortingStrategy : rectSortingStrategy}
            >
              <div className={visual.face_wf_row_mode
                ? "flex flex-col gap-3"
                : "grid grid-cols-1 gap-3 md:grid-cols-2"}>
                {faceOrder.map((sub) => (
                  <SortableCard
                    key={sub}
                    id={sub}
                    headerHeight={44}
                    fullCardHandle
                    showHandle={false}
                    borderRadius={8}
                  >
                    <FaceTouchSub name={sub} badges={faceBadges}
                                  onClick={() => onCardClick(sub)} />
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

  /* ── Bottom row: Cards (left) | splitter | ImagePane (right). Only shown
   *    after parameter parsing completes. ── */
  const renderBottomRow = () => (
    <PanelGroup direction="horizontal" autoSaveId="isp6s-main-horizontal">
      <Panel
        defaultSize={Math.round(visual.split_ratio * 100) || 55}
        minSize={28}
        onResize={(size) => patchVis({ split_ratio: size / 100 })}
      >
        <div className="h-full w-full overflow-hidden">{renderCardArea()}</div>
      </Panel>
      <ResizeHandle direction="horizontal" size={CARD_GAP_PX} />
      <Panel minSize={28}>
        <div className="h-full w-full">
          <ImagePane
            mode={(visual.preview_mode as PreviewMode) ?? "image"}
            onMode={setPreviewMode}
            filePath={filePath ?? ""}
            schema={schema}
            entry={currentEntry}
            tomlData={imageDir.tomlData}
            activeCard={activeCard}
          />
        </div>
      </Panel>
    </PanelGroup>
  );

  /* ── Table panel — wraps TablePane in standard padding. ── */
  const renderTablePanel = () => (
    <div className="h-full w-full">
      <TablePane
        schema={schema}
        entries={imageDir.entries}
        current={imageDir.current}
        imageDir={imageDir.dir}
        tomlData={imageDir.tomlData}
        onPickImage={onPickImage}
        onImageDirChange={onImageDirChange}
        collapsed={visual.table_collapsed}
        onToggleCollapsed={(next) => patchVis({ table_collapsed: next })}
      />
    </div>
  );

  /* ── Final layout ── */
  if (!hasEntries && !parsed) {
    return (
      <div className={visual.table_collapsed ? "w-full" : "h-full w-full"}>
        {renderTablePanel()}
      </div>
    );
  }

  /* Image folder loaded but parameter not yet parsed → table only. */
  if (hasEntries && !parsed) {
    return <div className="h-full w-full">{renderTablePanel()}</div>;
  }

  /* Parameter parsed but no image folder → cards + ImagePane only. */
  if (!hasEntries && parsed) {
    return (
      <div className="flex h-full w-full flex-col gap-3">
        <div className={visual.table_collapsed ? "shrink-0" : "h-[220px] shrink-0"}>
          {renderTablePanel()}
        </div>
        <div className="min-h-0 flex-1">{renderBottomRow()}</div>
      </div>
    );
  }

  /* Both + table collapsed: stack with TablePane at natural height, bottom row fills the rest. */
  if (visual.table_collapsed) {
    return (
      <div className="flex h-full w-full flex-col gap-3">
        <div className="shrink-0">{renderTablePanel()}</div>
        <div className="min-h-0 flex-1">{renderBottomRow()}</div>
      </div>
    );
  }

  /* Both: vertical stack — TablePane on top, cards+ImagePane LR on bottom. */
  return (
    <PanelGroup direction="vertical" autoSaveId="isp6s-table-body" className="h-full w-full">
      <Panel
        defaultSize={Math.round((visual.image_splitter_ratio || 0.4) * 100) || 40}
        minSize={20}
        onResize={(size) => patchVis({ image_splitter_ratio: size / 100 })}
      >
        {renderTablePanel()}
      </Panel>
      <ResizeHandle direction="vertical" size={CARD_GAP_PX} />
      <Panel minSize={25}>
        {renderBottomRow()}
      </Panel>
    </PanelGroup>
  );
}

/* ─── Sub-card renderers ─── */

function NormalSub({
  name, badges, onClick,
}: { name: string; badges: NormalBadges | null; onClick?: () => void }) {
  const sub = badges?.perSub[name as "MainT" | "HS" | "ABL" | "NS"];
  return (
    <AeParamCard
      title={name}
      accent={NORMAL_SUB_ACCENTS[name]}
      onClick={onClick}
      badges={[
        { label: "WT",  value: sub?.wt  ?? "—", hint: sub?.wtKey  || "(未映射)" },
        { label: "Tar", value: sub?.tar ?? "—", hint: sub?.tarKey || "(未映射)" },
      ]}
    />
  );
}

function FaceTouchSub({
  name, badges, onClick,
}: { name: string; badges: FaceTouchBadges | null; onClick?: () => void }) {
  if (name === "Face") {
    return (
      <AeParamCard
        title="Face"
        accent={FACE_TOUCH_ACCENTS.Face}
        onClick={onClick}
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
      badges={[
        { label: "WT",  value: badges?.touch.wt  ?? "—", hint: badges?.touch.wtKey  ?? "(未映射)" },
        { label: "Tar", value: badges?.touch.tar ?? "—", hint: badges?.touch.tarKey ?? "(未映射)" },
      ]}
    />
  );
}
