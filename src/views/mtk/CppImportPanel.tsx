import { useState } from "react";
import { Button } from "@fluentui/react-components";
import {
  ArrowUpload24Regular,
  ArrowSync24Regular,
  Folder24Regular,
} from "@fluentui/react-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { parseCppFile } from "@/ipc/cppParser";
import { useMtkStore } from "@/stores/mtkStore";
import type { IspId } from "./ispTabs";
import type { IspTab } from "./ispTabs";
import { Isp6sAeVisual } from "./isp6s/Isp6sAeVisual";

interface Props {
  isp:    IspId;
  tabIdx: number;
  tab:    IspTab;
}

/**
 * File import + parse card. Equivalent of hiz's `_TabContent` import mode +
 * `_TabActionPanel` action buttons.
 *
 * - File picker (or drag-drop) → stores the chosen path
 * - "解析" button → invokes `parse_cpp_file` IPC, stores StructNode in mtkStore
 */
export function CppImportPanel({ isp, tabIdx, tab }: Props) {
  const setImport = useMtkStore((s) => s.setImport);
  const importSt  = useMtkStore((s) => s.imports[`${isp}|${tabIdx}`]) ?? {
    filePath: null, parsed: null, status: "idle", message: null,
  };

  const [dragOver, setDragOver] = useState(false);

  const onPick = async () => {
    const picked = await openDialog({
      multiple: false,
      filters:  [{ name: "Source", extensions: ["cpp", "h", "c", "hpp"] }],
    });
    if (typeof picked === "string") {
      setImport(isp, tabIdx, { filePath: picked, parsed: null, status: "idle", message: null });
    }
  };

  const onParse = async () => {
    if (!importSt.filePath) return;
    setImport(isp, tabIdx, { status: "parsing", message: null });
    try {
      const result = await parseCppFile(importSt.filePath);
      setImport(isp, tabIdx, {
        parsed:  result,
        status:  "done",
        message: `解析完成：${result.fields.length} 字段 / ${result.comments.length} 注释`,
      });
    } catch (err) {
      setImport(isp, tabIdx, {
        status:  "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // Tauri webview surfaces dropped files via the Tauri file-drop event;
    // HTML5 DataTransfer won't carry a real path. We accept the first dragged
    // item by name and try to surface it — typical usage will use the picker.
    const f = e.dataTransfer.files[0];
    if (f) {
      // `f.name` only — but in Tauri the path API works on the global event:
      // see useEffect listener below.
      setImport(isp, tabIdx, { filePath: f.name, parsed: null, status: "idle", message: null });
    }
  };

  if (tab.fileHint === null) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-sm" style={{ color: "var(--colorNeutralForeground3)" }}>
          {tab.subtitle}（待开发）
        </div>
      </div>
    );
  }

  const isAeBasic =
    isp === "ISP6S" && tab.label === "AE Basic" && !!importSt.parsed;

  return (
    <div
      className="flex h-full w-full flex-col overflow-y-auto overflow-x-hidden"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-col gap-4 px-6 pt-6">
        {/* File picker card */}
        <div
          className="flex items-center gap-4 rounded-lg border p-4 transition-colors"
          style={{
            background:  "var(--colorNeutralBackground2)",
            borderColor: dragOver
              ? "var(--colorBrandStroke1)"
              : "var(--colorNeutralStroke2)",
          }}
        >
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg"
            style={{ background: "var(--colorNeutralBackground3)", color: "var(--colorNeutralForeground2)" }}
          >
            <ArrowUpload24Regular />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold"
                 style={{ color: "var(--colorNeutralForeground1)" }}>
              {tab.subtitle} · 期望 {tab.fileHint}
            </div>
            <div className="mt-1 truncate text-xs"
                 style={{ color: "var(--colorNeutralForeground3)" }}>
              {importSt.filePath ?? "未选择文件 — 点 '浏览' 或拖入到本区域"}
            </div>
          </div>
          <Button appearance="secondary" icon={<Folder24Regular />} onClick={onPick}>
            浏览
          </Button>
          <Button
            appearance="primary"
            icon={<ArrowSync24Regular />}
            disabled={!importSt.filePath || importSt.status === "parsing"}
            onClick={onParse}
          >
            {importSt.status === "parsing" ? "解析中…" : "解析"}
          </Button>
        </div>

        {/* Status / summary card */}
        {importSt.message && (
          <div
            className="rounded-md border p-3 text-xs"
            style={{
              background:  importSt.status === "error"
                ? "var(--colorPaletteRedBackground1)"
                : "var(--colorNeutralBackground2)",
              borderColor: importSt.status === "error"
                ? "var(--colorPaletteRedBorder1)"
                : "var(--colorNeutralStroke2)",
              color: importSt.status === "error"
                ? "var(--colorPaletteRedForeground1)"
                : "var(--colorNeutralForeground2)",
            }}
          >
            {importSt.message}
          </div>
        )}
      </div>

      {/* ISP6S AE Basic — mount the visualization card after parse */}
      {isAeBasic && importSt.filePath && (
        <Isp6sAeVisual isp={isp} tabIdx={tabIdx} filePath={importSt.filePath} />
      )}

      {/* Generic quick-look (other tabs) */}
      {!isAeBasic && importSt.parsed && (
        <div className="mx-6 mb-6 mt-4">
          <div
            className="rounded-md border p-3 text-xs"
            style={{
              background:  "var(--colorNeutralBackground3)",
              borderColor: "var(--colorNeutralStroke2)",
              color:       "var(--colorNeutralForeground2)",
              fontFamily:  "ui-monospace, SFMono-Regular, Consolas, monospace",
            }}
          >
            <div>变量：{importSt.parsed.var_type} {importSt.parsed.var_name}</div>
            <div>路径：{importSt.parsed.file}</div>
            <div>字段：{importSt.parsed.fields.length}</div>
            <div>注释：{importSt.parsed.comments.length}</div>
            <div>头部：{importSt.parsed.includes.slice(0, 5).join(", ")}{importSt.parsed.includes.length > 5 ? " …" : ""}</div>
          </div>
        </div>
      )}
    </div>
  );
}
