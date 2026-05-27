import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "@fluentui/react-components";
import {
  Folder24Regular,
  Image24Regular,
  Add24Regular,
  Subtract24Regular,
  Apps24Regular,
  TextBulletList24Regular,
  PanelLeft24Regular,
  PanelRight24Regular,
} from "@fluentui/react-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

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
import { getIsp6sSchema, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import { scanImageDir, loadImageToml } from "@/ipc/imageScan";
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
  isp:      IspId;
  tabIdx:   number;
  filePath: string;
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

function sanitiseOrder(order: string[], canonical: readonly string[]): string[] {
  const known = new Set<string>(canonical);
  const cleaned = order.filter((id) => known.has(id));
  for (const id of canonical) {
    if (!cleaned.includes(id)) cleaned.push(id);
  }
  return cleaned;
}

export function Isp6sAeVisual({ isp, tabIdx, filePath }: Props) {
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

  /* Image folder helpers. */
  const onPickDir = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    setImageDir(isp, tabIdx, { dir: picked, status: "scanning", message: null });
    try {
      const entries = await scanImageDir(picked);
      if (entries.length === 0) {
        setImageDir(isp, tabIdx, {
          entries: [], current: 0, tomlData: {},
          status: "error",
          message: "目录下没有找到带同名 .toml 的图片",
        });
        return;
      }
      setImageDir(isp, tabIdx, { entries, current: 0, status: "loading", message: null });
      const tomlData = await loadImageToml(entries[0].toml_path);
      setImageDir(isp, tabIdx, {
        tomlData, status: "done",
        message: `已加载 ${entries.length} 张图片 · 当前 ${entries[0].name}`,
      });
    } catch (e) {
      setImageDir(isp, tabIdx, {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

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
  const toggleSplitMode = () =>
    patchVis({ split_mode: !visual.split_mode });

  /** When user clicks a sub-card, snap the right pane to param_map mode and
   *  remember the card so the source view can scroll there. */
  const onCardClick = (card: string) => {
    setActiveCard(card);
    if (visual.split_mode) {
      patchVis({ preview_mode: "param_map" });
    } else {
      // Auto-enter split mode so the user actually sees the source.
      patchVis({ split_mode: true, preview_mode: "param_map" });
    }
  };

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

  /* ── Card area (left side OR full width depending on split_mode) ── */
  const renderCardArea = () => (
    <div className="flex flex-col gap-4 p-4">
      {/* Image folder picker */}
      <div className="flex items-center gap-3 rounded-lg border p-3"
           style={{
             background:  "var(--colorNeutralBackground2)",
             borderColor: "var(--colorNeutralStroke2)",
           }}>
        <div className="flex h-10 w-10 items-center justify-center rounded-md"
             style={{ background: "var(--colorNeutralBackground3)", color: "var(--colorNeutralForeground2)" }}>
          <Image24Regular />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold"
               style={{ color: "var(--colorNeutralForeground1)" }}>
            {imageDir.dir ?? "未选择图片文件夹"}
          </div>
          <div className="mt-0.5 truncate text-xs"
               style={{ color: "var(--colorNeutralForeground3)" }}>
            {imageDir.message ?? "选择含 .jpg + 同名 .toml 的目录，徽章按当前图片实时刷新"}
          </div>
        </div>
        {imageDir.entries.length > 0 && (
          <Select
            value={String(imageDir.current)}
            onChange={(_, d) => onPickImage(parseInt(d.value, 10))}
            style={{ minWidth: 220 }}
          >
            {imageDir.entries.map((e, i) => (
              <option key={e.jpg_path} value={String(i)}>{e.name}</option>
            ))}
          </Select>
        )}
        <Button appearance="secondary" icon={<Folder24Regular />} onClick={onPickDir}>
          {imageDir.dir ? "更换" : "选择文件夹"}
        </Button>
      </div>

      {/* Global controls */}
      <div className="flex items-center justify-between">
        <div className="text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
          可视化卡片
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="small" appearance="subtle"
            icon={visual.split_mode ? <PanelRight24Regular /> : <PanelLeft24Regular />}
            onClick={toggleSplitMode}
          >
            {visual.split_mode ? "退出分栅" : "进入分栅"}
          </Button>
          <Button
            size="small" appearance="subtle"
            icon={bothCollapsed ? <Add24Regular /> : <Subtract24Regular />}
            onClick={toggleAll}
          >
            {bothCollapsed ? "全部展开" : "全部收起"}
          </Button>
        </div>
      </div>

      {/* Top-level sortable */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={dragEndHandler(topOrder, (next) => patchVis({ top_card_order: next }))}
      >
        <SortableContext items={topOrder} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-4">
            {topOrder.map((name) => (
              <SortableCard key={name} id={name}>
                {renderTopCard(name)}
              </SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="text-[11px]" style={{ color: "var(--colorNeutralForeground4)" }}>
        点子卡片自动跳到右侧"源码映射"模式 · 状态全部持久化到 state.toml [isp6s_ae_visual]
        {currentEntry && <> · 当前图：{currentEntry.name}</>}
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
                { label: "tar_abl_mt_hs", value: normalBadges?.tar_abl_mt_hs ?? "—" },
                { label: "Cal",           value: normalBadges?.cal ?? "—" },
              ]}
            />
          }
        >
          <div className="flex items-center justify-end gap-2 pb-2">
            <Button size="small" appearance="subtle"
                    icon={visual.normal_wf_row_mode ? <Apps24Regular /> : <TextBulletList24Regular />}
                    onClick={toggleNormalLayout}>
              {visual.normal_wf_row_mode ? "切换网格" : "切换单行"}
            </Button>
          </div>
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
                  <SortableCard key={sub} id={sub}>
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
        >
          <div className="flex items-center justify-end gap-2 pb-2">
            <Button size="small" appearance="subtle"
                    icon={visual.face_wf_row_mode ? <Apps24Regular /> : <TextBulletList24Regular />}
                    onClick={toggleFaceLayout}>
              {visual.face_wf_row_mode ? "切换网格" : "切换单行"}
            </Button>
          </div>
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
                  <SortableCard key={sub} id={sub}>
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

  const setPreviewMode = (m: PreviewMode) => patchVis({ preview_mode: m });

  /* ── Right side: ImagePane (top) + TablePane (bottom) ── */
  const rightSide = (
    <PanelGroup direction="vertical" autoSaveId="isp6s-right-vertical">
      <Panel
        defaultSize={Math.round(visual.image_splitter_ratio * 100) || 55}
        minSize={20}
        onResize={(size) => patchVis({ image_splitter_ratio: size / 100 })}
      >
        <div className="h-full w-full p-2">
          <ImagePane
            mode={(visual.preview_mode as PreviewMode) ?? "image"}
            onMode={setPreviewMode}
            filePath={filePath}
            schema={schema}
            entry={currentEntry}
            tomlData={imageDir.tomlData}
            activeCard={activeCard}
          />
        </div>
      </Panel>
      <PanelResizeHandle className="h-2 transition-colors"
        style={{ background: "transparent" }} />
      <Panel minSize={20}>
        <div className="h-full w-full p-2">
          <TablePane
            schema={schema}
            entries={imageDir.entries}
            current={imageDir.current}
            tomlData={imageDir.tomlData}
            onPickImage={onPickImage}
          />
        </div>
      </Panel>
    </PanelGroup>
  );

  /* ── Final layout ── */
  if (!visual.split_mode) {
    return renderCardArea();
  }
  return (
    <div className="h-[calc(100vh-300px)] min-h-[600px] w-full">
      <PanelGroup
        direction="horizontal"
        autoSaveId="isp6s-main-horizontal"
      >
        <Panel
          defaultSize={Math.round(visual.split_ratio * 100) || 60}
          minSize={28}
          onResize={(size) => patchVis({ split_ratio: size / 100 })}
        >
          <div className="h-full w-full overflow-auto">{renderCardArea()}</div>
        </Panel>
        <PanelResizeHandle className="w-2 transition-colors"
          style={{ background: "transparent" }} />
        <Panel minSize={28}>{rightSide}</Panel>
      </PanelGroup>
    </div>
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
