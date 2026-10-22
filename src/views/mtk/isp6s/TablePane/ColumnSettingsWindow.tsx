import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Switch, Tab, TabList } from "@fluentui/react-components";
import { Add24Regular, ArrowReset24Regular, ArrowUp24Regular, Checkmark24Regular, Delete24Regular, Dismiss24Regular, ReOrderDotsVertical24Regular } from "@fluentui/react-icons";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getIsp6sSchema } from "@/ipc/cppParser";
import { flushStateNow, loadState, saveImageTableMode } from "@/ipc/stateIo";
import type { ImageTableModeColumns, ImageTableScopeColumns } from "@/types/ipc";
import type { ColumnSettingsSchema } from "./columnSettingsBootstrap";
import { COLUMN_SETTINGS_SAVED_EVENT, normalizeColumnMode, readLegacyColumnMode, type ColumnMode, type ColumnScope } from "./imageTableColumnSettings";
import "./columnSettings.css";

type EditableField = "label" | "source";
type UserColumn = ImageTableScopeColumns["custom"][number];
type ColumnRow = { id: string; label: string; source: string; custom?: UserColumn };

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const COMPUTED_COLUMNS: Record<ColumnScope, ColumnRow[]> = {
  all: [
    { id: "aeGain", label: "AEGain(new)", source: "=FLinkTar_new / BackTar_new" },
    { id: "normalCwr", label: "CWR(Normal)", source: "Normal_old (Normal_new)" },
    { id: "backCwr", label: "CWR(BackTar)", source: "BackTar_old (BackTar_new)" },
    { id: "cwr", label: "CWR(FLinkTar)", source: "FLinkTar_old (FLinkTar_new)" },
    { id: "delta", label: "∆CWR", source: "=CWR_new - CWR_old" },
    { id: "ev", label: "ΔEV", source: "=log2(CWR_new / CWR_old)" },
  ],
  face: [
    { id: "aeGain", label: "AEGain(new)", source: "=FLinkTar_new / BackTar_new" },
    { id: "normalCwr", label: "CWR(Normal)", source: "Normal_old (Normal_new)" },
    { id: "backCwr", label: "CWR(BackTar)", source: "BackTar_old (BackTar_new)" },
    { id: "cwr", label: "CWR(FLinkTar)", source: "FLinkTar_old (FLinkTar_new)" },
    { id: "delta", label: "∆CWR", source: "=CWR_new - CWR_old" },
    { id: "ev", label: "ΔEV", source: "=log2(CWR_new / CWR_old)" },
  ],
  normal: [
    { id: "normalCwr", label: "CWR(Normal)", source: "Normal_old (Normal_new)" },
    { id: "delta", label: "∆CWR", source: "=CWR_new - CWR_old" },
    { id: "ev", label: "ΔEV", source: "=log2(CWR_new / CWR_old)" },
  ],
};

export function ColumnSettingsWindow({ initialSchema }: { initialSchema?: ColumnSettingsSchema }) {
  const tone = new URLSearchParams(window.location.search).get("mode") === "tone";
  const mode: ColumnMode = tone ? "tone" : "isp6s";
  const [schema, setSchema] = useState<ColumnSettingsSchema | null>(initialSchema ?? null);
  const [scope, setScope] = useState<ColumnScope>("all");
  const [modeSettings, setModeSettings] = useState<ImageTableModeColumns>(() => readLegacyColumnMode(mode));
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState<UserColumn | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<EditableField>("label");
  const [draft, setDraft] = useState({ label: "", source: "" });
  const listRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { hidden, order, custom, edits, deleted } = modeSettings[scope];
  const updateScope = (update: (current: ImageTableScopeColumns) => ImageTableScopeColumns) => {
    setModeSettings((current) => ({ ...current, [scope]: update(current[scope]) }));
  };

  useEffect(() => {
    let active = true;
    void loadState().then((state) => {
      if (active) setModeSettings(state.image_table_columns
        ? normalizeColumnMode(state.image_table_columns[mode]) : readLegacyColumnMode(mode));
    }).catch((error) => {
      if (active) setSaveError(`读取列设置失败：${String(error)}`);
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [mode]);

  useEffect(() => {
    if (initialSchema) return;
    let active = true;
    void getIsp6sSchema().then((result) => { if (active) setSchema(result); })
      .catch((error) => console.warn("load image table columns", error));
    return () => { active = false; };
  }, [initialSchema]);

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
    const values: ColumnRow[] = [...defaultRows.filter((row) => !deleted.includes(row.id))
      .map((row) => ({ ...row, label: edits[row.id]?.label ?? row.label, source: edits[row.id]?.source ?? row.source })),
      ...scopedCustom, ...(pending?.scope === scope ? [{ id: `custom:${pending.id}`, label: pending.label, source: pending.source, custom: pending }] : [])];
    const positions = new Map(order.map((id, index) => [id, index]));
    return values.sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [custom, defaultRows, deleted, edits, order, pending, scope]);

  useLayoutEffect(() => {
    if (pending?.scope === scope && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [pending?.id, scope]);

  const saveEdit = (row: ColumnRow) => {
    const label = draft.label.trim();
    const source = draft.source.trim();
    if (!label || !source) return;
    const originalSource = row.source.replaceAll("\u001d", " / ");
    const savedSource = source === originalSource ? row.source : source;
    if (pending && pending.id === row.custom?.id) {
      updateScope((current) => ({ ...current, custom: [...current.custom, { ...pending, label, source: savedSource }] }));
      setPending(null);
    } else if (row.custom) {
      updateScope((current) => ({ ...current, custom: current.custom.map((column) => column.id === row.custom?.id
        ? { ...column, label, source: savedSource } : column) }));
    } else {
      const original = defaultRows.find((column) => column.id === row.id);
      if (!original) return;
      updateScope((current) => {
        const next = { ...current.edits };
        const edit = {
          ...(label !== original.label ? { label } : {}),
          ...(savedSource !== original.source ? { source: savedSource } : {}),
        };
        if (Object.keys(edit).length > 0) next[row.id] = edit;
        else delete next[row.id];
        return { ...current, edits: next };
      });
    }
    setEditingId(null);
  };

  const deleteRow = (row: ColumnRow) => {
    if (pending?.id === row.custom?.id) setPending(null);
    updateScope((current) => ({
      ...current,
      custom: row.custom ? current.custom.filter((column) => column.id !== row.custom?.id) : current.custom,
      deleted: row.custom ? current.deleted : [...new Set([...current.deleted, row.id])],
      hidden: current.hidden.filter((id) => id !== row.id),
      order: current.order.filter((id) => id !== row.id),
    }));
    if (editingId === row.id) setEditingId(null);
  };

  const moveToTop = (id: string) => {
    updateScope((current) => ({ ...current, order: [id, ...rows.map((row) => row.id).filter((item) => item !== id)] }));
  };

  const startEditing = (row: ColumnRow, field: EditableField) => {
    if (pending?.id !== row.custom?.id) setPending(null);
    if (editingId !== row.id) {
      setDraft({ label: row.label, source: row.source.replaceAll("\u001d", " / ") });
    }
    setEditingId(row.id);
    setEditingField(field);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((row) => row.id === active.id);
    const to = rows.findIndex((row) => row.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(rows.map((row) => row.id), from, to);
    updateScope((scopeSettings) => {
      const present = new Set(moved);
      const next = [...scopeSettings.order];
      for (const id of moved) if (!next.includes(id)) next.push(id);
      let offset = 0;
      return { ...scopeSettings, order: next.map((id) => present.has(id) ? moved[offset++] : id) };
    });
  };

  const complete = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveImageTableMode(mode, modeSettings, readLegacyColumnMode(mode === "isp6s" ? "tone" : "isp6s"));
      await flushStateNow();
      await emit(COLUMN_SETTINGS_SAVED_EVENT, { mode, settings: modeSettings });
      await getCurrentWindow().close();
    } catch (error) {
      setSaveError(`保存列设置失败：${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="column-settings-window flex h-full min-h-0 flex-col" style={{ color: "var(--colorNeutralForeground1)" }}>
      <header className="column-settings-header flex shrink-0 items-center gap-8 border-b px-7 py-3">
        <h1 className="text-base font-semibold">表格列设置</h1>
        {!tone && <TabList selectedValue={scope} onTabSelect={(_, data) => {
          setPending(null);
          setEditingId(null);
          setScope(data.value as ColumnScope);
        }}>
          <Tab value="all" disabled={!ready}>All</Tab><Tab value="face" disabled={!ready}>Face</Tab><Tab value="normal" disabled={!ready}>Normal</Tab>
        </TabList>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-7 pb-6">
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" aria-busy={!ready} style={{ pointerEvents: ready ? undefined : "none" }}>
          <div className="column-settings-grid column-settings-table-header sticky top-0 z-10 grid items-center gap-4 border-b px-4 py-3 text-xs font-semibold" style={{ color: "var(--colorNeutralForeground2)" }}>
            <span>列标题名称</span><span>关键字或公式</span><span className="column-settings-control-cell">操作</span><span className="column-settings-control-cell">排序</span><span className="column-settings-control-cell">显示</span>
          </div>
          <DndContext sensors={sensors} modifiers={[verticalOnly]} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2.5 py-2">
                {rows.map((row) => <SortableColumnRow key={row.id} row={row} visible={!hidden.includes(row.id)}
                  onVisibilityChange={(visible) => updateScope((current) => ({ ...current, hidden: visible
                    ? current.hidden.filter((id) => id !== row.id) : [...new Set([...current.hidden, row.id])] }))}
                  editing={editingId === row.id} editingField={editingField} draft={draft} onDraftChange={setDraft}
                  onEdit={(field) => startEditing(row, field)} onMoveToTop={() => moveToTop(row.id)} atTop={rows[0]?.id === row.id}
                  onSave={() => saveEdit(row)} onCancel={() => { if (pending?.id === row.custom?.id) setPending(null); setEditingId(null); }} onDelete={() => deleteRow(row)} />)}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        {saveError && <p role="alert" className="shrink-0 py-2 text-xs" style={{ color: "var(--colorPaletteRedForeground1)" }}>{saveError}</p>}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
          <div className="flex min-w-0 items-center gap-2">
            <Button icon={<Add24Regular />} disabled={!ready || saving} onClick={() => {
              const id = crypto.randomUUID();
              setPending({ id, label: "新列", source: "", scope });
              setDraft({ label: "新列", source: "" });
              setEditingId(`custom:${id}`);
              setEditingField("label");
            }}>添加表格列</Button>
            {deleted.length > 0 && <Button appearance="subtle" icon={<ArrowReset24Regular />} disabled={!ready || saving}
              onClick={() => updateScope((current) => ({ ...current, deleted: [] }))}>恢复已删除列</Button>}
          </div>
          <Button appearance="primary" icon={<Checkmark24Regular />} disabled={!ready || saving || editingId !== null} onClick={() => void complete()}>{saving ? "保存中" : "完成"}</Button>
        </div>
      </div>
    </div>
  );
}

function SortableColumnRow({ row, visible, editing, editingField, draft, atTop, onVisibilityChange, onDraftChange, onEdit, onMoveToTop, onSave, onCancel, onDelete }: {
  row: ColumnRow;
  visible: boolean;
  editing: boolean;
  editingField: EditableField;
  draft: { label: string; source: string };
  atTop: boolean;
  onVisibilityChange: (visible: boolean) => void;
  onDraftChange: (draft: { label: string; source: string }) => void;
  onEdit: (field: EditableField) => void;
  onMoveToTop: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <div ref={setNodeRef} className={`column-settings-row column-settings-grid grid min-h-[60px] items-center gap-4 rounded-md border px-4 py-2${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined, position: "relative", boxShadow: isDragging ? "var(--shadow8)" : undefined }}>
      <div className="min-w-0">
        {editing && editingField === "label" ? <Input autoFocus size="small" className="w-full" value={draft.label} aria-label="列标题名称"
          onChange={(_, data) => onDraftChange({ ...draft, label: data.value })}
          onKeyDown={(event) => { if (event.key === "Enter") onSave(); if (event.key === "Escape") onCancel(); }} />
          : <button type="button" className="column-settings-editable block w-full truncate rounded px-2 py-1 text-left text-sm font-semibold" title={`编辑列标题：${row.label}`} onClick={() => onEdit("label")}>{editing ? draft.label : row.label}</button>}
      </div>
      <div className="min-w-0">
        {editing && editingField === "source" ? <Input autoFocus size="small" className="w-full" value={draft.source} aria-label="关键字或公式" placeholder="TOML 关键字或 = 公式"
          onChange={(_, data) => onDraftChange({ ...draft, source: data.value })}
          onKeyDown={(event) => { if (event.key === "Enter") onSave(); if (event.key === "Escape") onCancel(); }} />
          : <button type="button" className="column-settings-editable block w-full min-w-0 break-all rounded px-2 py-1 text-left text-xs leading-5" style={{ color: "var(--colorNeutralForeground2)" }} title={`编辑关键字或公式：${row.source}`} onClick={() => onEdit("source")}>{(editing ? draft.source : row.source).replaceAll("\u001d", " / ") || "-"}</button>}
      </div>
      <div className="column-settings-control-cell gap-1">
        {editing ? <>
          <Button appearance="subtle" size="small" icon={<Checkmark24Regular />} aria-label={`保存 ${row.label}`} title="保存" disabled={!draft.label.trim() || !draft.source.trim()} onClick={onSave} />
          <Button appearance="subtle" size="small" icon={<Dismiss24Regular />} aria-label={`取消编辑 ${row.label}`} title="取消" onClick={onCancel} />
        </> : <>
          <Button appearance="subtle" size="small" icon={<ArrowUp24Regular />} aria-label={`置顶 ${row.label}`} title="移至顶部" disabled={atTop} onClick={onMoveToTop} />
          <Button appearance="subtle" size="small" icon={<Delete24Regular />} aria-label={`删除 ${row.label}`} title="删除列" onClick={onDelete} />
        </>}
      </div>
      <div className="column-settings-control-cell">
        <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} title="按住拖拽调整顺序" aria-label={`拖动 ${row.label} 调整顺序`}
          className="column-settings-handle flex h-9 w-9 cursor-grab items-center justify-center rounded-md active:cursor-grabbing" style={{ color: "var(--colorNeutralForeground2)", touchAction: "none" }}>
          <ReOrderDotsVertical24Regular className="h-5 w-5" />
        </button>
      </div>
      <div className="column-settings-control-cell">
        <Switch className="column-settings-visibility" checked={visible} aria-label={`显示 ${row.label}`} onChange={(_, data) => onVisibilityChange(data.checked)} />
      </div>
    </div>
  );
}
