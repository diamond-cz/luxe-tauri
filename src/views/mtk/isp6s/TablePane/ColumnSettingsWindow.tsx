import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Switch, Tab, TabList } from "@fluentui/react-components";
import { Add24Regular, ArrowReset24Regular, Checkmark24Regular, Delete24Regular, Dismiss24Regular, Pin24Filled, Pin24Regular, ReOrderDotsVertical24Regular } from "@fluentui/react-icons";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getIsp6sSchema } from "@/ipc/cppParser";
import { flushStateNow, loadState, saveImageTableMode } from "@/ipc/stateIo";
import type { ImageTableModeColumns, ImageTableScopeColumns } from "@/types/ipc";
import type { ColumnSettingsSchema } from "./columnSettingsBootstrap";
import { COLUMN_SETTINGS_CANCEL_EVENT, COLUMN_SETTINGS_PREVIEW_EVENT, COLUMN_SETTINGS_SAVED_EVENT, COLUMN_SETTINGS_SCOPE_EVENT, normalizeColumnMode, orderedSettingsRows, readLegacyColumnMode, type ColumnMode, type ColumnScope } from "./imageTableColumnSettings";
import { ColumnEditHistoryInput } from "./ColumnEditHistoryInput";
import { rememberColumnEdit } from "./columnEditHistory";
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
  const [scope, setScope] = useState<ColumnScope>(() => {
    const value = new URLSearchParams(window.location.search).get("scope");
    return !tone && (value === "face" || value === "normal") ? value : "all";
  });
  const [modeSettings, setModeSettings] = useState<ImageTableModeColumns>(() => readLegacyColumnMode(mode));
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState<UserColumn | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<EditableField>("label");
  const [draft, setDraft] = useState({ label: "", source: "" });
  const listRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { hidden, order, pinned, custom, edits, deleted } = modeSettings[scope];
  const updateScope = (update: (current: ImageTableScopeColumns) => ImageTableScopeColumns) => {
    setModeSettings((current) => ({ ...current, [scope]: update(current[scope]) }));
  };

  useEffect(() => {
    if (tone) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<{ scope: ColumnScope }>(COLUMN_SETTINGS_SCOPE_EVENT, ({ payload }) => {
      if (!active || !["all", "face", "normal"].includes(payload.scope)) return;
      setPending(null);
      setEditingId(null);
      setScope(payload.scope);
    }).then((stop) => { if (active) unlisten = stop; else stop(); });
    return () => { active = false; unlisten?.(); };
  }, [tone]);

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
    if (!ready) return;
    void emit(COLUMN_SETTINGS_PREVIEW_EVENT, { mode, settings: modeSettings })
      .catch((error) => console.warn("preview image table columns", error));
  }, [mode, modeSettings, ready]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (!active) return;
      if (!committedRef.current) {
        try {
          await emit(COLUMN_SETTINGS_CANCEL_EVENT, { mode });
        } catch (error) {
          console.warn("cancel image table columns preview", error);
        }
      }
      await getCurrentWindow().destroy();
    }).then((stop) => { if (active) unlisten = stop; else stop(); })
      .catch((error) => console.warn("listen column settings close", error));
    return () => { active = false; unlisten?.(); };
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
    return orderedSettingsRows(values, modeSettings[scope]);
  }, [custom, defaultRows, deleted, edits, order, pending, pinned, scope]);

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
    if (pending?.id === row.custom?.id || label !== row.label) rememberColumnEdit("label", label);
    if (pending?.id === row.custom?.id || source !== originalSource) rememberColumnEdit("source", source);
    setEditingId(null);
  };

  const deleteRow = (row: ColumnRow) => {
    if (pending?.id === row.custom?.id) setPending(null);
    updateScope((current) => ({
      ...current,
      custom: row.custom ? current.custom.filter((column) => column.id !== row.custom?.id) : current.custom,
      deleted: row.custom ? current.deleted : [...new Set([...current.deleted, row.id])],
      pinned: current.pinned.filter((id) => id !== row.id),
      hidden: current.hidden.filter((id) => id !== row.id),
      order: current.order.filter((id) => id !== row.id),
    }));
    if (editingId === row.id) setEditingId(null);
  };

  const togglePinned = (id: string) => {
    updateScope((current) => {
      const nextPinned = current.pinned.includes(id)
        ? current.pinned.filter((item) => item !== id)
        : [...current.pinned, id];
      const pinnedSet = new Set(nextPinned);
      return { ...current, pinned: nextPinned, order: rows.map((row) => row.id).filter((item) => !pinnedSet.has(item)) };
    });
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
      const pinnedSet = new Set(scopeSettings.pinned);
      if (pinnedSet.has(String(active.id)) !== pinnedSet.has(String(over.id))) {
        if (pinnedSet.has(String(active.id))) pinnedSet.delete(String(active.id));
        else pinnedSet.add(String(active.id));
      }
      return {
        ...scopeSettings,
        pinned: moved.filter((id) => pinnedSet.has(id)),
        order: moved.filter((id) => !pinnedSet.has(id)),
      };
    });
  };

  const complete = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveImageTableMode(mode, modeSettings, readLegacyColumnMode(mode === "isp6s" ? "tone" : "isp6s"));
      await flushStateNow();
      await emit(COLUMN_SETTINGS_SAVED_EVENT, { mode, settings: modeSettings });
      committedRef.current = true;
      await getCurrentWindow().close();
    } catch (error) {
      const message = String(error);
      setSaveError(message.includes("not found")
        ? "当前窗口连接的是旧版 Tauri 宿主，请完全退出并重新运行 npm run tauri:dev 后再保存。"
        : `保存列设置失败：${message}`);
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
                  onEdit={(field) => startEditing(row, field)} onPinToggle={() => togglePinned(row.id)} pinned={pinned.includes(row.id)}
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

function SortableColumnRow({ row, visible, editing, editingField, draft, pinned, onVisibilityChange, onDraftChange, onEdit, onPinToggle, onSave, onCancel, onDelete }: {
  row: ColumnRow;
  visible: boolean;
  editing: boolean;
  editingField: EditableField;
  draft: { label: string; source: string };
  pinned: boolean;
  onVisibilityChange: (visible: boolean) => void;
  onDraftChange: (draft: { label: string; source: string }) => void;
  onEdit: (field: EditableField) => void;
  onPinToggle: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <div ref={setNodeRef} className={`column-settings-row column-settings-grid grid min-h-[60px] items-center gap-4 rounded-md border px-4 py-2${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined, position: "relative", boxShadow: isDragging ? "var(--shadow8)" : undefined }}>
      <div className="min-w-0">
        {editing && editingField === "label" ? <ColumnEditHistoryInput field="label" value={draft.label} ariaLabel="列标题名称"
          onChange={(value) => onDraftChange({ ...draft, label: value })} onSave={onSave} onCancel={onCancel} />
          : <button type="button" className="column-settings-editable block w-full truncate rounded px-2 py-1 text-left text-sm font-semibold" title={`编辑列标题：${row.label}`} onClick={() => onEdit("label")}>{editing ? draft.label : row.label}</button>}
      </div>
      <div className="min-w-0">
        {editing && editingField === "source" ? <ColumnEditHistoryInput field="source" value={draft.source} ariaLabel="关键字或公式"
          onChange={(value) => onDraftChange({ ...draft, source: value })} onSave={onSave} onCancel={onCancel} />
          : <button type="button" className="column-settings-editable block w-full min-w-0 break-all rounded px-2 py-1 text-left text-xs leading-5" style={{ color: "var(--colorNeutralForeground2)" }} title={`编辑关键字或公式：${row.source}`} onClick={() => onEdit("source")}>{(editing ? draft.source : row.source).replaceAll("\u001d", " / ") || "-"}</button>}
      </div>
      <div className="column-settings-control-cell gap-1">
        {editing ? <>
          <Button appearance="subtle" size="small" icon={<Checkmark24Regular />} aria-label={`保存 ${row.label}`} title="保存" disabled={!draft.label.trim() || !draft.source.trim()} onClick={onSave} />
          <Button appearance="subtle" size="small" icon={<Dismiss24Regular />} aria-label={`取消编辑 ${row.label}`} title="取消" onClick={onCancel} />
        </> : <>
          <Button appearance="subtle" size="small" className={`column-settings-pin${pinned ? " is-pinned" : ""}`} icon={pinned ? <Pin24Filled /> : <Pin24Regular />} aria-label={pinned ? `取消置顶 ${row.label}` : `置顶 ${row.label}`} title={pinned ? "取消置顶" : "置顶"} onClick={onPinToggle} />
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
