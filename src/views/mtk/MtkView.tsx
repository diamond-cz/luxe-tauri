import { lazy, Suspense, useEffect, useState } from "react";

import { saveStateSection } from "@/ipc/stateIo";
import { parseCppFile } from "@/ipc/cppParser";
import { scanImageDir, loadImageToml } from "@/ipc/imageScan";
import { useMtkStore } from "@/stores/mtkStore";
import { Toast, type ToastKind } from "@/components/common/Toast";

import { ISP_LIST, ISP_TABS, type IspId } from "./ispTabs";
import { IspSelectBar } from "./IspSelectBar";

const Isp6sAeVisual = lazy(() => import("./isp6s/Isp6sAeVisual").then(({ Isp6sAeVisual }) => ({ default: Isp6sAeVisual })));

/**
 * MTK platform view.
 *
 * Layout:
 *   ┌─ IspSelectBar:  [ISP6S ▼]  AE Basic | ToneMap | …
 *   ├─ MtkPickerBar:  [🖼 图片文件夹][⇿][📄 参数文件]
 *   └─ Body: TablePane on top (image loaded) | Cards + ImagePane LR (parsed)
 */
export function MtkView() {
  const mtk            = useMtkStore((s) => s.mtk);
  const setCurrentIsp  = useMtkStore((s) => s.setCurrentIsp);
  const setCurrentTab  = useMtkStore((s) => s.setCurrentTab);
  const setInnerSplit  = useMtkStore((s) => s.setInnerSplit);

  const ispIdx = Math.max(0, Math.min(mtk.current_isp, ISP_LIST.length - 1));
  const ispId: IspId = ISP_LIST[ispIdx].id;
  const tabs   = ISP_TABS[ispId];
  const tabIdx = Math.max(0, Math.min(mtk.current_tab, tabs.length - 1));
  const tab    = tabs[tabIdx];
  const key    = `${ispId}|${tabIdx}`;

  /* Debounced persist of MTK nav state. */
  useEffect(() => {
    const t = setTimeout(() => {
      saveStateSection("mtk", mtk).catch((err) => console.warn("save mtk", err));
    }, 200);
    return () => clearTimeout(t);
  }, [mtk]);

  const importsEntry = useMtkStore((s) => s.imports[key]);
  const imports = importsEntry ?? { filePath: null, parsed: null, status: "idle" as const, message: null };
  const setImport = useMtkStore((s) => s.setImport);

  const setImageDir = useMtkStore((s) => s.setImageDir);

  const [toast, setToast] = useState<{
    kind: ToastKind;
    title: string;
    detail?: string;
    duration?: number;
  } | null>(null);

  const onCppPathChange = async (path: string) => {
    setImport(ispId, tabIdx, { filePath: path, parsed: null, status: "parsing", message: null });
    try {
      const result = await parseCppFile(path);
      setImport(ispId, tabIdx, {
        parsed:  result,
        status:  "done",
        message: null,
      });
      setToast({
        kind:  "success",
        title: "解析完成",
        detail: `${result.fields.length} 字段 / ${result.comments.length} 注释`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImport(ispId, tabIdx, { status: "error", message: null });
      setToast({ kind: "error", title: "解析失败", detail: msg });
    }
  };

  const onImageDirChange = async (dir: string) => {
    setImageDir(ispId, tabIdx, { dir, status: "scanning", message: null });
    try {
      const entries = await scanImageDir(dir);
      if (entries.length === 0) {
        setImageDir(ispId, tabIdx, {
          entries: [], current: 0, tomlData: {},
          status: "error",
          message: "目录下没有找到带同名 .toml 的图片",
        });
        return;
      }
      setImageDir(ispId, tabIdx, { entries, current: 0, status: "loading", message: null });
      const tomlData = await loadImageToml(entries[0].toml_path);
      setImageDir(ispId, tabIdx, {
        tomlData, status: "done",
        message: `已加载 ${entries.length} 张图片 · 当前 ${entries[0].name}`,
      });
    } catch (e) {
      setImageDir(ispId, tabIdx, {
        status:  "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const isAeBasic = ispId === "ISP6S" && tab.label === "AE Basic";
  const parsedReady = Boolean(imports.parsed && imports.filePath);

  return (
    <div className="flex h-full w-full flex-col">
      <IspSelectBar
        isp={ispId}
        tabIdx={tabIdx}
        cppFileHint={tab.fileHint}
        cppPath={imports.filePath}
        pickerRatios={mtk.inner_splitter}
        onIspChange={(id) => setCurrentIsp(ISP_LIST.findIndex((i) => i.id === id))}
        onTabChange={setCurrentTab}
        onCppPathChange={onCppPathChange}
        onPickerRatiosChange={setInnerSplit}
        onToast={setToast}
      />

      {/* Placeholder tabs (ISP7S 三 channel, etc.) get a single-message body. */}
      {tab.fileHint === null ? (
        <div className="flex flex-1 items-center justify-center text-sm"
             style={{ color: "var(--colorNeutralForeground3)" }}>
          {tab.subtitle}（待开发）
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            {isAeBasic ? (
              <Suspense fallback={<Hint hint="正在加载 ISP6S AE 可视化..." />}>
                <Isp6sAeVisual
                  isp={ispId}
                  tabIdx={tabIdx}
                  filePath={imports.filePath}
                  parsed={parsedReady}
                  onImageDirChange={onImageDirChange}
                />
              </Suspense>
            ) : parsedReady ? (
              <ParsedSummary parsed={imports.parsed!} />
            ) : (
              <Hint hint={`选择 ${tab.fileHint} 开始`} />
            )}
          </div>
        </>
      )}

      {toast && (
        <Toast
          kind={toast.kind}
          title={toast.title}
          detail={toast.detail}
          duration={toast.duration ?? 3000}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

function Hint({ hint }: { hint: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-sm"
         style={{ color: "var(--colorNeutralForeground3)" }}>
      {hint}
    </div>
  );
}

import type { ParseResult } from "@/types/cpp_parser";
function ParsedSummary({ parsed }: { parsed: ParseResult }) {
  return (
    <div className="mx-1 my-1 rounded-md border p-3 text-xs"
         style={{
           background:  "var(--colorNeutralBackground3)",
           borderColor: "var(--colorNeutralStroke2)",
           color:       "var(--colorNeutralForeground2)",
           fontFamily:  "ui-monospace, SFMono-Regular, Consolas, monospace",
         }}>
      <div>变量：{parsed.var_type} {parsed.var_name}</div>
      <div>路径：{parsed.file}</div>
      <div>字段：{parsed.fields.length}</div>
      <div>注释：{parsed.comments.length}</div>
      <div>头部：{parsed.includes.slice(0, 8).join(", ")}{parsed.includes.length > 8 ? " …" : ""}</div>
    </div>
  );
}
