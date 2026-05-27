import { useState } from "react";
import { Button } from "@fluentui/react-components";
import {
  ArrowUpload24Regular,
  ArrowSync24Regular,
  Folder24Regular,
} from "@fluentui/react-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { parseCppFile } from "@/ipc/cppParser";
import type { ParseResult } from "@/types/cpp_parser";

export interface CppImportCardProps {
  title:       string;
  subtitle:    string;
  fileHint:    string;
  /** Accepted extensions for the picker. Defaults to common C/C++ suffixes. */
  extensions?: string[];
  /** Called after a successful parse. */
  onParsed?:   (result: ParseResult) => void;
}

interface State {
  filePath: string | null;
  parsed:   ParseResult | null;
  status:   "idle" | "parsing" | "done" | "error";
  message:  string | null;
}

const DEFAULT_EXT = ["cpp", "c", "h", "hpp"];

/**
 * Self-contained C++ file import + parse panel.
 * Used by Qualcomm / Unisoc platform views and (with a wrapper) by MTK.
 */
export function CppImportCard({
  title, subtitle, fileHint,
  extensions = DEFAULT_EXT, onParsed,
}: CppImportCardProps) {
  const [s, setS] = useState<State>({
    filePath: null, parsed: null, status: "idle", message: null,
  });
  const [dragOver, setDragOver] = useState(false);

  const patch = (p: Partial<State>) => setS((cur) => ({ ...cur, ...p }));

  const onPick = async () => {
    const picked = await openDialog({
      multiple: false,
      filters:  [{ name: "Source", extensions }],
    });
    if (typeof picked === "string") {
      patch({ filePath: picked, parsed: null, status: "idle", message: null });
    }
  };

  const onParse = async () => {
    if (!s.filePath) return;
    patch({ status: "parsing", message: null });
    try {
      const result = await parseCppFile(s.filePath);
      patch({
        parsed: result, status: "done",
        message: `解析完成：${result.fields.length} 字段 / ${result.comments.length} 注释`,
      });
      onParsed?.(result);
    } catch (err) {
      patch({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      className="flex h-full w-full flex-col gap-4 overflow-y-auto overflow-x-hidden p-6"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) patch({ filePath: f.name, parsed: null, status: "idle", message: null });
      }}
    >
      {/* File picker */}
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
          style={{
            background: "var(--colorNeutralBackground3)",
            color:      "var(--colorNeutralForeground2)",
          }}
        >
          <ArrowUpload24Regular />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold"
               style={{ color: "var(--colorNeutralForeground1)" }}>
            {title} · 期望 {fileHint}
          </div>
          <div className="mt-1 truncate text-xs"
               style={{ color: "var(--colorNeutralForeground3)" }}>
            {s.filePath ?? `${subtitle} — 点 '浏览' 或拖入到本区域`}
          </div>
        </div>
        <Button appearance="secondary" icon={<Folder24Regular />} onClick={onPick}>
          浏览
        </Button>
        <Button
          appearance="primary"
          icon={<ArrowSync24Regular />}
          disabled={!s.filePath || s.status === "parsing"}
          onClick={onParse}
        >
          {s.status === "parsing" ? "解析中…" : "解析"}
        </Button>
      </div>

      {/* Status banner */}
      {s.message && (
        <div
          className="rounded-md border p-3 text-xs"
          style={{
            background:  s.status === "error"
              ? "var(--colorPaletteRedBackground1)"
              : "var(--colorNeutralBackground2)",
            borderColor: s.status === "error"
              ? "var(--colorPaletteRedBorder1)"
              : "var(--colorNeutralStroke2)",
            color: s.status === "error"
              ? "var(--colorPaletteRedForeground1)"
              : "var(--colorNeutralForeground2)",
          }}
        >
          {s.message}
        </div>
      )}

      {/* Parse summary */}
      {s.parsed && (
        <div
          className="flex-1 min-h-0 overflow-auto rounded-md border p-3 text-xs"
          style={{
            background:  "var(--colorNeutralBackground3)",
            borderColor: "var(--colorNeutralStroke2)",
            color:       "var(--colorNeutralForeground2)",
            fontFamily:  "ui-monospace, SFMono-Regular, Consolas, monospace",
          }}
        >
          <div>变量：{s.parsed.var_type} {s.parsed.var_name}</div>
          <div>路径：{s.parsed.file}</div>
          <div>字段：{s.parsed.fields.length}</div>
          <div>注释：{s.parsed.comments.length}</div>
          <div>头部：{s.parsed.includes.slice(0, 8).join(", ")}{s.parsed.includes.length > 8 ? " …" : ""}</div>
          <div className="mt-2 opacity-60">
            该平台的可视化卡尚未实现 · 当前阶段仅做文件解析联调
          </div>
        </div>
      )}
    </div>
  );
}
