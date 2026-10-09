import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { saveStateSection } from "@/ipc/stateIo";
import { parseCppFile } from "@/ipc/cppParser";
import { isFile } from "@/ipc/shell";
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
  const debugParserPath = useMtkStore((s) => s.debugParserPath);
  const setDebugParserPath = useMtkStore((s) => s.setDebugParserPath);
  const setCppPath = useMtkStore((s) => s.setCppPath);
  const restoredCppPath = useRef<string | null>(null);
  const restoredParserPath = useRef<string | null>(null);
  const cppRequestId = useRef(0);

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
  const imports = importsEntry ?? { filePath: null, parsed: null, revision: 0, status: "idle" as const, message: null };
  const setImport = useMtkStore((s) => s.setImport);

  const setImageDir = useMtkStore((s) => s.setImageDir);

  const [toast, setToast] = useState<{
    kind: ToastKind;
    title: string;
    detail?: string;
    duration?: number;
  } | null>(null);
  const workspaceDividerXRef = useRef<number | null>(null);
  const alignWorkspaceDividerRef = useRef<((x: number) => void) | null>(null);
  const registerWorkspaceDividerAlign = useCallback((align: ((x: number) => void) | null) => {
    alignWorkspaceDividerRef.current = align;
    if (align && workspaceDividerXRef.current !== null) align(workspaceDividerXRef.current);
  }, []);
  const reportWorkspaceDivider = useCallback((x: number) => {
    workspaceDividerXRef.current = x;
    alignWorkspaceDividerRef.current?.(x);
  }, []);

  const onCppPathChange = useCallback(async (path: string) => {
    const requestId = ++cppRequestId.current;
    try {
      if (!(await isFile(path))) {
        if (requestId === cppRequestId.current) setToast({ kind: "error", title: "参数文件不存在", detail: path });
        return;
      }
      if (requestId !== cppRequestId.current) return;
      setImport(ispId, tabIdx, { filePath: path, parsed: null, status: "parsing", message: null });
      const result = await parseCppFile(path);
      if (requestId !== cppRequestId.current) return;
      setImport(ispId, tabIdx, {
        parsed:  result,
        revision: (useMtkStore.getState().imports[`${ispId}|${tabIdx}`]?.revision ?? 0) + 1,
        status:  "done",
        message: null,
      });
      if (ispId === "ISP6S" && tabIdx === 0) {
        restoredCppPath.current = path;
        setCppPath(path);
      }
      setToast({
        kind:  "success",
        title: "解析完成",
        detail: `${result.fields.length} 字段 / ${result.comments.length} 注释`,
      });
    } catch (err) {
      if (requestId !== cppRequestId.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setImport(ispId, tabIdx, { status: "error", message: null });
      setToast({ kind: "error", title: "解析失败", detail: msg });
    }
  }, [ispId, tabIdx, setCppPath, setImport]);

  useEffect(() => {
    const path = mtk.cpp_path;
    if (!path || restoredCppPath.current === path) return;
    restoredCppPath.current = path;
    const requestId = ++cppRequestId.current;
    let cancelled = false;
    isFile(path).then(async (valid) => {
      if (cancelled || requestId !== cppRequestId.current) return;
      if (!valid) {
        setCppPath(null);
        setToast({ kind: "error", title: "上次的参数文件已失效", detail: path });
        return;
      }
      setImport("ISP6S", 0, { filePath: path, parsed: null, status: "parsing", message: null });
      try {
        const parsed = await parseCppFile(path);
        if (!cancelled && requestId === cppRequestId.current) setImport("ISP6S", 0, { parsed, status: "done", message: null });
      } catch (error) {
        if (cancelled || requestId !== cppRequestId.current) return;
        setImport("ISP6S", 0, { filePath: null, parsed: null, status: "idle", message: null });
        setCppPath(null);
        setToast({ kind: "error", title: "上次的参数文件无法加载", detail: error instanceof Error ? error.message : String(error) });
      }
    }).catch((error) => {
      if (!cancelled && requestId === cppRequestId.current) setToast({ kind: "error", title: "检查参数文件失败", detail: String(error) });
    });
    return () => { cancelled = true; };
  }, [mtk.cpp_path, setCppPath, setImport]);

  useEffect(() => {
    const path = mtk.debug_parser_path;
    if (!path || restoredParserPath.current === path) return;
    restoredParserPath.current = path;
    let cancelled = false;
    isFile(path).then((valid) => {
      if (cancelled) return;
      if (valid && path.split(/[\\/]/).pop()?.toLowerCase() === "debugparser.exe") {
        setDebugParserPath(path);
      } else {
        setDebugParserPath(null);
        setToast({ kind: "error", title: "上次的 DP 解析工具路径已失效", detail: path });
      }
    }).catch((error) => {
      if (!cancelled) setToast({ kind: "error", title: "检查 DP 解析工具失败", detail: String(error) });
    });
    return () => { cancelled = true; };
  }, [mtk.debug_parser_path, setDebugParserPath]);

  const onImageDirChange = async (dir: string) => {
    const imageTabIdx = ispId === "ISP6S" && (tabIdx === 0 || tabIdx === 1) ? 0 : tabIdx;
    const imageDirKey = `${ispId}|${imageTabIdx}`;
    setImageDir(ispId, imageTabIdx, { dir, tomlData: {}, status: "scanning", message: null });
    try {
      const entries = await scanImageDir(dir);
      if (useMtkStore.getState().imageDir[imageDirKey]?.dir !== dir) return;
      if (entries.length === 0) {
        setImageDir(ispId, imageTabIdx, {
          entries: [], current: 0, tomlData: {},
          status: "error",
          message: "目录下没有找到 JPG、JPEG 或 PNG 图片",
        });
        return;
      }
      setImageDir(ispId, imageTabIdx, { entries, current: 0, tomlData: {}, status: "loading", message: null });
      const tomlData = await loadImageToml(entries[0].toml_path).catch((): Record<string, string> => ({}));
      if (useMtkStore.getState().imageDir[imageDirKey]?.dir !== dir) return;
      setImageDir(ispId, imageTabIdx, {
        tomlData, status: "done",
        message: `已加载 ${entries.length} 张图片 · 当前 ${entries[0].name}`,
      });
    } catch (e) {
      if (useMtkStore.getState().imageDir[imageDirKey]?.dir !== dir) return;
      setImageDir(ispId, imageTabIdx, {
        status:  "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const isIsp6sWorkspace = ispId === "ISP6S" && (tab.label === "AE Basic" || tab.label === "ToneMap");
  const parsedReady = Boolean(imports.parsed && imports.filePath);

  return (
    <div className="flex h-full w-full flex-col">
      <IspSelectBar
        isp={ispId}
        tabIdx={tabIdx}
        cppFileHint={tab.fileHint}
        cppPath={imports.filePath}
        debugParserPath={debugParserPath}
        pickerRatios={mtk.inner_splitter}
        onRegisterWorkspaceDividerAlign={registerWorkspaceDividerAlign}
        onIspChange={(id) => setCurrentIsp(ISP_LIST.findIndex((i) => i.id === id))}
        onTabChange={setCurrentTab}
        onCppPathChange={onCppPathChange}
        onDebugParserPathChange={setDebugParserPath}
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
            {isIsp6sWorkspace ? (
              <Suspense fallback={<Hint hint="正在加载 ISP6S AE 可视化..." />}>
                <Isp6sAeVisual
                  isp={ispId}
                  tabIdx={tabIdx}
                  filePath={imports.filePath}
                  parsed={parsedReady}
                  toneMode={tab.label === "ToneMap"}
                  toneParsed={tab.label === "ToneMap" ? imports.parsed : null}
                  cppImportRevision={imports.revision}
                  onImageDirChange={onImageDirChange}
                  onCppPathChange={onCppPathChange}
                  debugParserPath={debugParserPath}
                  onDebugParserPathChange={setDebugParserPath}
                  onNotice={setToast}
                  onWorkspaceDividerChange={reportWorkspaceDivider}
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
