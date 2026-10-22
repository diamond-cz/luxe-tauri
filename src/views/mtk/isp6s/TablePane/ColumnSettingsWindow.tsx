import { useEffect, useMemo, useState } from "react";
import { Button, Input, Switch, Tab, TabList } from "@fluentui/react-components";
import { Add24Regular, Delete24Regular, ReOrderDotsVertical24Regular } from "@fluentui/react-icons";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getIsp6sSchema, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import "./columnSettings.css";

type Scope = "all" | "face" | "normal";
type UserColumn = { id: string; label: string; source: string; scope: Scope };
type ColumnRow = { id: string; label: string; source: string; custom?: UserColumn };

const SETTINGS_KEYS = {
  isp6s: { visibility: "luxe:isp6s:image-table-column-visibility", order: "luxe:isp6s:image-table-column-order", custom: "luxe:isp6s:image-table-custom-columns" },
  tone: { visibility: "luxe:isp6s:tone-image-table-column-visibility", order: "luxe:isp6s:tone-image-table-column-order", custom: "luxe:isp6s:tone-image-table-custom-columns" },
} as const;

const COMPUTED_COLUMNS: Record<Scope, ColumnRow[]> = {
  all: [
    { id: "aeGain", label: "AEGain(new)", source: "计算：人像 AE 增益" },
    { id: "normalCwr", label: "CWR(Normal)", source: "计算：空景 CWR" },
    { id: "backCwr", label: "CWR(BackTar)", source: "计算：BackTar CWR" },
    { id: "cwr", label: "CWR(FLinkTar)", source: "计算：FLinkTar CWR" },
    { id: "delta", label: "∆CWR", source: "CWR(new) - CWR(old)" },
    { id: "ev", label: "ΔEV", source: "log₂(CWR_new / CWR_old)" },
  ],
  face: [
    { id: "aeGain", label: "AEGain(new)", source: "计算：人像 AE 增益" },
    { id: "normalCwr", label: "CWR(Normal)", source: "计算：Normal CWR" },
    { id: "backCwr", label: "CWR(BackTar)", source: "计算：BackTar CWR" },
    { id: "cwr", label: "CWR(FLinkTar)", source: "计算：FLinkTar CWR" },
    { id: "delta", label: "∆CWR", source: "CWR(new) - CWR(old)" },
    { id: "ev", label: "ΔEV", source: "log₂(CWR_new / CWR_old)" },
  ],
  normal: [
    { id: "normalCwr", label: "CWR(Normal)", source: "计算：空景 CWR" },
    { id: "delta", label: "∆CWR", source: "CWR(new) - CWR(old)" },
    { id: "ev", label: "ΔEV", source: "log₂(CWR_new / CWR_old)" },
  ],
};

export function ColumnSettingsWindow() {
  const tone = new URLSearchParams(window.location.search).get("mode") === "tone";
  const keys = tone ? SETTINGS_KEYS.tone : SETTINGS_KEYS.isp6s;
  const [schema, setSchema] = useState<Isp6sSchemaRoot | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const [hidden, setHidden] = useState<string[]>(() => readArray(keys.visibility));
  const [order, setOrder] = useState<string[]>(() => readArray(keys.order));
  const [custom, setCustom] = useState<UserColumn[]>(() => readCustom(keys.custom));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    let active = true;
    void getIsp6sSchema().then((result) => { if (active) setSchema(result); })
      .catch((error) => console.warn("load image table columns", error));
    return () => { active = false; };
  }, []);

  const defaultRows = useMemo(() => {
    if (!schema) return [] as ColumnRow[];
    if (tone) {
      const items = schema.preview_info?.items ?? [];
      const field = (label: string, index: number, fallback: string) => {
        const item = items.find((candidate) => candidate.label === label);
        return item?.toml_key?.trim() || item?.toml_keys?.[index]?.trim() || fallback;
      };
      return [
        ["AEGain", field("AEGain", 0, "SW_LCE_AEGain")],
        ["LV", items.find((item) => item.label === "LV")?.toml_keys?.join("\u001d") || "SW_LCE_LV\u001dSW_LCE_LVIdx_L\u001dSW_LCE_LVIdx_H"],
        ["DR", items.find((item) => item.label === "DR")?.toml_keys?.join("\u001d") || "SW_LCE_CurrDR\u001dSW_LCE_DRIdx_L\u001dSW_LCE_DRIdx_H"],
        ["Target", field("Target", 0, "SW_LCE_FinalTarget")],
        ["D_S_Level", field("Level_D,B_Strenth", 0, "SW_LCE_DStrengthLevel")],
        ["B_S_Level", field("Level_D,B_Strenth", 1, "SW_LCE_BStrengthLevel")],
      ].map(([label, source]) => ({ id: `extra:${source}`, label, source }));
    }
    const mapping = scope === "face" ? [schema.image_table?.portrait ?? schema.Image ?? {}]
      : scope === "normal" ? [schema.image_table?.scene ?? schema.Image ?? {}]
        : [schema.image_table?.portrait ?? schema.Image ?? {}, schema.image_table?.scene ?? schema.Image ?? {}];
    const bySource = new Map<string, ColumnRow>();
    for (const group of mapping) {
      for (const [label, source] of Object.entries(group)) {
        if (!bySource.has(source)) bySource.set(source, { id: `extra:${source}`, label, source });
      }
    }
    return [...COMPUTED_COLUMNS[scope], ...bySource.values()];
  }, [schema, scope, tone]);

  const rows = useMemo(() => {
    const scopedCustom = custom.filter((column) => column.scope === scope)
      .map((column) => ({ id: `custom:${column.id}`, label: column.label, source: column.source, custom: column }));
    const values: ColumnRow[] = [...defaultRows, ...scopedCustom];
    const positions = new Map(order.map((id, index) => [id, index]));
    return values.sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [custom, defaultRows, order, scope]);

  useEffect(() => { writeArray(keys.visibility, hidden); }, [hidden, keys.visibility]);
  useEffect(() => { writeArray(keys.order, order); }, [keys.order, order]);
  useEffect(() => { writeCustom(keys.custom, custom); }, [custom, keys.custom]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((row) => row.id === active.id);
    const to = rows.findIndex((row) => row.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(rows.map((row) => row.id), from, to);
    setOrder((current) => {
      const present = new Set(moved);
      const next = [...current];
      for (const id of moved) if (!next.includes(id)) next.push(id);
      let offset = 0;
      return next.map((id) => present.has(id) ? moved[offset++] : id);
    });
  };

  return (
    <div className="column-settings-window flex h-full min-h-0 flex-col" style={{ color: "var(--colorNeutralForeground1)" }}>
      <header className="column-settings-header flex shrink-0 items-center justify-between gap-4 border-b px-7 py-5">
        <h1 className="text-base font-semibold">表格列设置</h1>
        <Button appearance="primary" onClick={() => void getCurrentWindow().close()}>完成</Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-7 pb-6">
        <TabList className="shrink-0 pt-3" selectedValue={scope} onTabSelect={(_, data) => setScope(data.value as Scope)}>
          <Tab value="all">all</Tab><Tab value="face">face</Tab><Tab value="normal">normal</Tab>
        </TabList>
        <div className="column-settings-grid grid shrink-0 items-center gap-4 border-b px-4 py-3 text-xs font-semibold" style={{ color: "var(--colorNeutralForeground2)" }}>
          <span>列标题名称</span><span>数据来源</span><span className="text-center">排序</span><span className="text-center">显示</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2 pr-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2.5">
                {rows.map((row) => <SortableColumnRow key={row.id} row={row} visible={!hidden.includes(row.id)}
                  onVisibilityChange={(visible) => setHidden((current) => visible ? current.filter((id) => id !== row.id) : [...new Set([...current, row.id])])}
                  onCustomChange={(patch) => setCustom((current) => current.map((column) => column.id === row.custom?.id ? { ...column, ...patch } : column))}
                  onDelete={() => { setCustom((current) => current.filter((column) => column.id !== row.custom?.id)); setHidden((current) => current.filter((id) => id !== row.id)); setOrder((current) => current.filter((id) => id !== row.id)); }} />)}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <div className="shrink-0 border-t pt-4" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
          <Button icon={<Add24Regular />} onClick={() => setCustom((current) => [...current, { id: crypto.randomUUID(), label: "新列", source: "", scope }])}>添加表格列</Button>
        </div>
      </div>
    </div>
  );
}

function SortableColumnRow({ row, visible, onVisibilityChange, onCustomChange, onDelete }: {
  row: ColumnRow;
  visible: boolean;
  onVisibilityChange: (visible: boolean) => void;
  onCustomChange: (patch: Partial<UserColumn>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <div ref={setNodeRef} className={`column-settings-row column-settings-grid grid min-h-[74px] items-center gap-4 rounded-md border px-4 py-2.5${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined, position: "relative", boxShadow: isDragging ? "var(--shadow8)" : undefined }}>
      <div className="min-w-0">
        {row.custom ? <Input size="small" className="w-full" value={row.custom.label} aria-label="列标题名称" onChange={(_, data) => onCustomChange({ label: data.value })} />
          : <span className="block truncate text-sm font-semibold" title={row.label}>{row.label}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {row.custom ? <div className="min-w-0 flex-1"><span className="block text-xs font-semibold">自定义字段</span><Input size="small" className="mt-1 w-full" value={row.custom.source} aria-label="关键字或公式" placeholder="TOML 关键字或 = 公式" onChange={(_, data) => onCustomChange({ source: data.value })} /></div>
          : <div className="min-w-0" title={row.source}><span className="block text-xs font-semibold">{row.id.startsWith("extra:") ? "TOML 字段" : "计算结果"}</span><span className="block min-w-0 break-all text-xs leading-5" style={{ color: "var(--colorNeutralForeground2)" }}>{row.source.replaceAll("\u001d", " / ")}</span></div>}
        {row.custom && <Button appearance="subtle" size="small" icon={<Delete24Regular />} aria-label={`删除 ${row.label}`} title="删除列" onClick={onDelete} />}
      </div>
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} title="按住拖拽调整顺序" aria-label={`拖动 ${row.label} 调整顺序`}
        className="column-settings-handle flex h-9 w-9 cursor-grab items-center justify-center rounded-md active:cursor-grabbing" style={{ color: "var(--colorNeutralForeground2)", touchAction: "none" }}>
        <ReOrderDotsVertical24Regular className="h-5 w-5" />
      </button>
      <Switch className="justify-self-center" checked={visible} aria-label={`显示 ${row.label}`} onChange={(_, data) => onVisibilityChange(data.checked)} />
    </div>
  );
}

function readArray(key: string): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}
function writeArray(key: string, value: string[]) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ } }
function readCustom(key: string): UserColumn[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter((item): item is UserColumn => Boolean(item) && typeof item.id === "string" && typeof item.label === "string" && typeof item.source === "string" && ["all", "face", "normal"].includes(item.scope)) : []; } catch { return []; }
}
function writeCustom(key: string, value: UserColumn[]) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ } }
