import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Save24Regular } from "@fluentui/react-icons";

import { parseCppFile, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import type { FieldEntry } from "@/types/cpp_parser";
import type { SourceEditorBinding } from "./ImagePane";
import { isParaCheckNumber, locateParaCheckField, replaceParaCheckField } from "./paraCheckSource";

interface Props {
  filePath: string;
  schema: Isp6sSchemaRoot;
  tomlData: Record<string, string>;
  sourceEditor: SourceEditorBinding | null;
}

interface SourceSnapshot {
  filePath: string;
  importRevision: number;
  text: string;
  fields: FieldEntry[];
}

/** Comparison table: 关键字 | 图片3A (read only) | 参数文件 (shared source draft). */
export function ParaCheckMode({ filePath, schema, tomlData, sourceEditor }: Props) {
  const items = useMemo(() => schema.para_check?.items ?? [], [schema]);
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingEdit, setPendingEdit] = useState(false);
  const pendingCommitRef = useRef<(() => boolean) | null>(null);
  const trackPendingEdit = useCallback((commit: (() => boolean) | null) => {
    pendingCommitRef.current = commit;
    setPendingEdit(Boolean(commit));
  }, []);
  const editorRef = useRef(sourceEditor);
  editorRef.current = sourceEditor;
  const resolveFilePath = sourceEditor?.resolveFilePath;
  const sourceText = sourceEditor?.text;
  const importRevision = sourceEditor?.importRevision;

  useEffect(() => { trackPendingEdit(null); }, [filePath, importRevision, trackPendingEdit]);

  useEffect(() => {
    if (!filePath || !resolveFilePath || sourceText === undefined || importRevision === undefined) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    parseCppFile(resolveFilePath).then((parsed) => {
      if (!cancelled) {
        setSnapshot({ filePath, importRevision, text: sourceText, fields: parsed.fields });
        setError(null);
      }
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filePath, resolveFilePath, sourceText, importRevision]);

  const currentSnapshot = snapshot?.filePath === filePath && snapshot.importRevision === importRevision ? snapshot : null;
  const rows = useMemo(() => items.map((item) => {
    const field = currentSnapshot?.fields.find((candidate) => candidate.path === item.cpp_path
      || candidate.path.startsWith(`${item.cpp_path}[`) || candidate.path.startsWith(`${item.cpp_path}.`)) ?? null;
    const target = field && sourceText !== undefined && currentSnapshot
      ? locateParaCheckField(currentSnapshot.text, sourceText, field) : null;
    const cppValue = target?.value ?? field?.value ?? "—";
    const tomlValue = tomlData[item.toml_key] ?? "—";
    return {
      ...item, field, cppValue, tomlValue,
      editable: Boolean(target && sourceEditor),
      match: cppValue !== "—" && tomlValue !== "—" && cppValue === tomlValue,
      dirty: Boolean(field && target && sourceEditor && currentSnapshot
        && locateParaCheckField(currentSnapshot.text, sourceEditor.savedText, field)?.value !== target.value),
    };
  }), [items, currentSnapshot, sourceText, sourceEditor, tomlData]);
  const dirty = pendingEdit || rows.some((row) => row.dirty);
  const tableRowCount = 1 + rows.length + (items.length === 0 || !currentSnapshot ? 1 : 0);
  const columnTextWidth = Math.max(1, ...rows.flatMap((row) => [
    row.label.length / 0.3, row.tomlValue.length / 0.35, row.cppValue.length / 0.35,
  ]), 4 / 0.35);
  const tableFontSize = `min(11px, ${50 / tableRowCount}cqh, ${90 / (columnTextWidth * 0.62)}cqw)`;

  const commitCell = (field: FieldEntry, value: string): boolean => {
    const editor = editorRef.current;
    if (!editor || !currentSnapshot || editor.filePath !== currentSnapshot.filePath
      || editor.importRevision !== currentSnapshot.importRevision) return false;
    const next = replaceParaCheckField(currentSnapshot.text, editor.getText(), field, value);
    if (next === null) {
      setError("无法定位对应源码数值，请等待源码同步后重试");
      return false;
    }
    editor.onTextChange(next);
    setError(null);
    return true;
  };

  const jumpToCell = (label: string, field: FieldEntry) => {
    const editor = editorRef.current;
    if (!editor || !currentSnapshot) return;
    const target = locateParaCheckField(currentSnapshot.text, editor.getText(), field);
    if (!target) { setError("无法定位对应源码数值，请等待源码同步后重试"); return; }
    editor.onSourceJump(`AE.CPP.${label}`, {
      paths: [field.path], line_ranges: [[field.line, field.line]], jump_to: "first", highlight: "ranges",
    }, { selection: target.selection });
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
      <section style={cardStyle} aria-label="AE.CPP 参数对比表">
        <div style={headerStyle}>
          <strong style={{ fontSize: 12, fontWeight: 900 }}>AE.CPP</strong>
          <button
            type="button"
            aria-label={saving ? "正在保存 AE.CPP" : "保存 AE.CPP 修改"}
            disabled={!dirty || !sourceEditor || saving}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const editor = editorRef.current;
              if (!editor) return;
              if (pendingCommitRef.current && !pendingCommitRef.current()) return;
              setSaving(true);
              setError(null);
              void editor.onSave().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
                .finally(() => setSaving(false));
            }}
            style={{ ...saveButtonStyle, opacity: dirty && !saving ? 1 : 0.45, cursor: dirty && !saving ? "pointer" : "default" }}
          >
            <Save24Regular className="h-4 w-4" />
            {dirty && <span aria-hidden="true" style={{ position: "absolute", top: -4, right: -2, color: "var(--colorPaletteRedForeground1)", fontSize: 12, fontWeight: 700 }}>*</span>}
          </button>
        </div>
        {error && <div role="alert" className="px-3 py-2 text-xs" style={{ color: "var(--colorPaletteRedForeground1)" }}>{error}</div>}
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", containerType: "size" }}>
        <table style={{ ...tableStyle, gridTemplateRows: `repeat(${tableRowCount}, minmax(0, 1fr))`, fontSize: tableFontSize }}>
          <thead style={{ display: "contents" }}>
            <tr style={rowStyle}><Th>关键字</Th><Th>图片3A</Th><Th>参数文件</Th></tr>
          </thead>
          <tbody style={{ display: "contents" }}>
            {rows.map((row, rowIndex) => (
              <tr key={row.cpp_path} style={{ ...rowStyle, background: rowIndex % 2 === 0 ? "var(--colorNeutralBackground1)" : "var(--colorNeutralBackground2)" }}>
                <td style={{ ...cellStyle, background: "var(--hs-weight-bv-bg)", color: "var(--normal-sheet-palegreen-fg)", fontWeight: 700 }}>{row.label}</td>
                <td style={{ ...cellStyle, ...comparisonTextStyle(!row.match) }}>{row.tomlValue}</td>
                <td style={{ ...cellStyle, padding: 0 }}>
                  <ParameterCell
                    key={`${filePath}:${importRevision}:${row.cpp_path}`}
                    value={row.cppValue}
                    label={row.label}
                    imageValue={row.tomlValue}
                    editable={row.editable}
                    onPendingEdit={trackPendingEdit}
                    onCommit={(value) => row.field ? commitCell(row.field, value) : false}
                    onSourceJump={() => { if (row.field) jumpToCell(row.label, row.field); }}
                  />
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr style={rowStyle}><td colSpan={3} style={{ ...cellStyle, gridColumn: "1 / -1" }}>Isp6s.toml 未配置 [[para_check.items]]</td></tr>}
            {items.length > 0 && !currentSnapshot && <tr style={rowStyle}><td colSpan={3} style={{ ...cellStyle, gridColumn: "1 / -1", color: "var(--colorNeutralForeground3)" }}>
              {!filePath ? "请先导入 AE.cpp 参数文件" : loading ? "正在加载参数…" : "等待源码草稿加载…"}
            </td></tr>}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

function ParameterCell({ value, label, imageValue, editable, onCommit, onSourceJump, onPendingEdit }: {
  value: string;
  label: string;
  imageValue: string;
  editable: boolean;
  onCommit: (value: string) => boolean;
  onSourceJump: () => void;
  onPendingEdit: (commit: (() => boolean) | null) => void;
}) {
  const [inputValue, setInputValue] = useState(value);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(value);
  useEffect(() => { inputRef.current = value; setInputValue(value); }, [value]);
  const reset = () => { inputRef.current = value; setInputValue(value); onPendingEdit(null); };
  const commit = () => {
    const next = inputRef.current.trim();
    onPendingEdit(null);
    if (!editable || next === value) return true;
    if (!isParaCheckNumber(next) || !onCommit(next)) { reset(); return false; }
    return true;
  };
  return (
    <input
      aria-label={`AE.CPP ${label} 参数文件`}
      value={inputValue}
      readOnly={!editable}
      tabIndex={editable ? 0 : -1}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onChange={(event) => {
        inputRef.current = event.target.value;
        setInputValue(event.target.value);
        onPendingEdit(event.target.value.trim() !== value ? commit : null);
      }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); commit(); onSourceJump(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "Escape") { event.preventDefault(); reset(); event.currentTarget.blur(); }
      }}
      inputMode="decimal"
      style={{
        width: "100%", height: "100%", minWidth: 0, minHeight: 0, boxSizing: "border-box", padding: "0 2px",
        border: "none", outline: "none", background: "transparent", font: "inherit", textAlign: "center",
        ...comparisonTextStyle(inputValue === "—" || imageValue === "—" || inputValue !== imageValue),
        boxShadow: focused && editable ? "inset 0 0 0 1.5px var(--colorBrandForeground1)" : undefined,
        cursor: editable ? "text" : "default",
      }}
    />
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th style={{ ...cellStyle, background: "var(--hs-weight-bv-bg)", color: "var(--normal-sheet-palegreen-fg)", fontWeight: 900 }}>{children}</th>;
}

function comparisonTextStyle(highlight: boolean): CSSProperties {
  return { color: highlight ? "var(--colorPaletteRedForeground1)" : "var(--colorNeutralForeground2)", fontWeight: highlight ? 600 : 400 };
}

const cardStyle: CSSProperties = {
  display: "flex", flexDirection: "column", width: "100%", height: "100%", minWidth: 0, minHeight: 0,
  border: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 74%, transparent)",
  borderRadius: "0 0 8px 8px", overflow: "hidden", background: "var(--colorNeutralBackground1)", boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
};
const headerStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 36, flexShrink: 0, padding: "0 7px 0 10px",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "color-mix(in srgb, var(--colorBrandBackground2) 18%, var(--colorNeutralBackground2))",
  color: "var(--colorNeutralForeground1)",
};
const saveButtonStyle: CSSProperties = {
  position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, flexShrink: 0,
  padding: 0, border: "1px solid var(--colorNeutralStroke2)", borderRadius: 8,
  background: "var(--colorNeutralBackground1)", color: "var(--colorBrandForeground1)",
};
const tableStyle: CSSProperties = {
  display: "grid", width: "100%", height: "100%", minWidth: 0, minHeight: 0,
  fontFamily: "ui-monospace, Consolas, monospace", fontVariantNumeric: "tabular-nums",
};
const rowStyle: CSSProperties = {
  display: "grid", gridTemplateColumns: "30% 35% 35%", minHeight: 0, minWidth: 0,
};
const cellStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0, minWidth: 0,
  padding: "0 2px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", lineHeight: 1.2,
  borderRight: "1px solid var(--normal-sheet-line)", borderBottom: "1px solid var(--normal-sheet-line)",
};
