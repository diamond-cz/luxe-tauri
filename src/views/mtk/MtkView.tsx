import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { parseCppFile } from "@/ipc/cppParser";
import { isFile } from "@/ipc/shell";
import { scanImageDir, loadImageToml } from "@/ipc/imageScan";
import { flushStateNow, saveStateSection } from "@/ipc/stateIo";
import { useMtkStore } from "@/stores/mtkStore";
import { Toast, type ToastKind } from "@/components/common/Toast";

import { ISP_LIST, ISP_TABS, type IspId } from "./ispTabs";
import { IspSelectBar } from "./IspSelectBar";
import { isDebugParserExecutable } from "./debugParserPath";

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
  const restoredCppPaths = useRef<Record<string, string>>({});
  const restoredParserPath = useRef<string | null>(null);
  const cppRequestIds = useRef<Record<string, number>>({});
  const parserRequestId = useRef(0);
  const imageRequestId = useRef(0);
  const imageLoadKey = useRef<string | null>(null);

  const ispIdx = Math.max(0, Math.min(mtk.current_isp, ISP_LIST.length - 1));
  const ispId: IspId = ISP_LIST[ispIdx].id;
  const tabs   = ISP_TABS[ispId];
  const tabIdx = Math.max(0, Math.min(mtk.current_tab, tabs.length - 1));
  const tab    = tabs[tabIdx];
  const key    = `${ispId}|${tabIdx}`;
  const imageTabIdx = ispId === "ISP6S" && (tabIdx === 0 || tabIdx === 1) ? 0 : tabIdx;
  const imageKey = `${ispId}|${imageTabIdx}`;

  useEffect(() => () => {
    for (const key of Object.keys(cppRequestIds.current)) cppRequestIds.current[key] += 1;
    restoredCppPaths.current = {};
  }, []);
  useEffect(() => () => { parserRequestId.current += 1; }, []);
  useEffect(() => () => {
    imageRequestId.current += 1;
    const pendingKey = imageLoadKey.current;
    const pending = pendingKey ? useMtkStore.getState().imageDir[pendingKey] : null;
    if (pendingKey && (pending?.status === "scanning" || pending?.status === "loading")) {
      const [isp, tab] = pendingKey.split("|");
      useMtkStore.getState().setImageDir(isp as IspId, Number(tab), {
        dir: null, entries: [], current: 0, tomlData: {}, status: "idle",
      });
    }
  }, [imageKey]);

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
    if (workspaceDividerXRef.current !== null && Math.abs(workspaceDividerXRef.current - x) < 0.5) return;
    workspaceDividerXRef.current = x;
    alignWorkspaceDividerRef.current?.(x);
  }, []);

  const onCppPathChange = useCallback(async (path: string) => {
    const importKey = `${ispId}|${tabIdx}`;
    const requestId = cppRequestIds.current[importKey] = (cppRequestIds.current[importKey] ?? 0) + 1;
    restoredCppPaths.current[importKey] = path;
    setCppPath(path, ispId, tabIdx);
    setImport(ispId, tabIdx, { filePath: path, parsed: null, status: "parsing", message: null });
    try {
      if (!(await isFile(path))) {
        if (requestId === cppRequestIds.current[importKey]) {
          setImport(ispId, tabIdx, { status: "error", message: "参数文件不存在" });
          setToast({ kind: "error", title: "参数文件不存在", detail: path });
        }
        return;
      }
      if (requestId !== cppRequestIds.current[importKey]) return;
      const result = await parseCppFile(path);
      if (requestId !== cppRequestIds.current[importKey]) return;
      setImport(ispId, tabIdx, {
        parsed:  result,
        revision: (useMtkStore.getState().imports[importKey]?.revision ?? 0) + 1,
        status:  "done",
        message: null,
      });
      setToast({
        kind:  "success",
        title: "解析完成",
        detail: `${result.fields.length} 字段 / ${result.comments.length} 注释`,
      });
    } catch (err) {
      if (requestId !== cppRequestIds.current[importKey]) return;
      const msg = err instanceof Error ? err.message : String(err);
      setImport(ispId, tabIdx, { filePath: path, parsed: null, status: "error", message: msg });
      setToast({ kind: "error", title: "解析失败", detail: msg });
    }
  }, [ispId, tabIdx, setCppPath, setImport]);

  const onDebugParserPathChange = useCallback(async (path: string) => {
    const requestId = ++parserRequestId.current;
    if (!isDebugParserExecutable(path)) {
      setToast({ kind: "error", title: "请选择 DebugParser.exe", detail: path });
      return;
    }
    restoredParserPath.current = path;
    setDebugParserPath(path);
    try {
      await saveStateSection("mtk", useMtkStore.getState().mtk);
      await flushStateNow();
    } catch (error) {
      if (requestId === parserRequestId.current) {
        setToast({ kind: "error", title: "DP解析工具路径", detail: String(error) });
      }
      return;
    }
    if (requestId !== parserRequestId.current) return;
    try {
      if (!(await isFile(path))) {
        if (requestId === parserRequestId.current) setToast({ kind: "error", title: "DP 解析工具不存在", detail: path });
        return;
      }
      if (requestId !== parserRequestId.current) return;
    } catch (error) {
      if (requestId === parserRequestId.current) setToast({ kind: "error", title: "检查 DP 解析工具失败", detail: String(error) });
    }
  }, [setDebugParserPath]);

  useEffect(() => {
    const paths = { ...mtk.cpp_paths };
    if (mtk.cpp_path && !paths["ISP6S|0"]) paths["ISP6S|0"] = mtk.cpp_path;
    for (const [savedKey, path] of Object.entries(paths)) {
      const [savedIsp, savedTab] = savedKey.split("|");
      const savedTabIdx = Number(savedTab);
      if (!path || !ISP_TABS[savedIsp as IspId]?.[savedTabIdx]?.fileHint
        || restoredCppPaths.current[savedKey] === path) continue;
      restoredCppPaths.current[savedKey] = path;
      const requestId = cppRequestIds.current[savedKey] = (cppRequestIds.current[savedKey] ?? 0) + 1;
      const currentImport = useMtkStore.getState().imports[savedKey];
      if (currentImport?.filePath === path && currentImport.status === "done") continue;
      setImport(savedIsp as IspId, savedTabIdx, { filePath: path, parsed: null, status: "parsing", message: null });
      void isFile(path).then(async (valid) => {
        if (requestId !== cppRequestIds.current[savedKey]) return;
        if (!valid) {
          setImport(savedIsp as IspId, savedTabIdx, { status: "error", message: "参数文件不存在" });
          setToast({ kind: "error", title: "上次的参数文件暂时不可用", detail: path });
          return;
        }
        try {
          const parsed = await parseCppFile(path);
          if (requestId !== cppRequestIds.current[savedKey]) return;
          setImport(savedIsp as IspId, savedTabIdx, {
            parsed, revision: (useMtkStore.getState().imports[savedKey]?.revision ?? 0) + 1,
            status: "done", message: null,
          });
        } catch (error) {
          if (requestId !== cppRequestIds.current[savedKey]) return;
          const message = error instanceof Error ? error.message : String(error);
          setImport(savedIsp as IspId, savedTabIdx, { status: "error", message });
          setToast({ kind: "error", title: "上次的参数文件无法加载", detail: message });
        }
      }).catch((error) => {
        if (requestId !== cppRequestIds.current[savedKey]) return;
        setImport(savedIsp as IspId, savedTabIdx, { status: "error", message: String(error) });
        setToast({ kind: "error", title: "检查参数文件失败", detail: String(error) });
      });
    }
  }, [mtk.cpp_path, mtk.cpp_paths, setImport]);

  useEffect(() => {
    const path = mtk.debug_parser_path;
    if (!path || restoredParserPath.current === path) return;
    restoredParserPath.current = path;
    const requestId = ++parserRequestId.current;
    let cancelled = false;
    let completed = false;
    isFile(path).then((valid) => {
      if (cancelled || requestId !== parserRequestId.current) return;
      completed = true;
      if (!valid || !isDebugParserExecutable(path)) {
        setToast({ kind: "error", title: "上次的 DP 解析工具路径已失效", detail: path });
      }
    }).catch((error) => {
      if (!cancelled && requestId === parserRequestId.current) setToast({ kind: "error", title: "检查 DP 解析工具失败", detail: String(error) });
    });
    return () => {
      cancelled = true;
      if (!completed && restoredParserPath.current === path) restoredParserPath.current = null;
    };
  }, [mtk.debug_parser_path]);

  const onImageDirChange = useCallback(async (dir: string, selectedImage?: string | null) => {
    const requestId = ++imageRequestId.current;
    imageLoadKey.current = `${ispId}|${imageTabIdx}`;
    const previousDir = useMtkStore.getState().imageDir[`${ispId}|${imageTabIdx}`]?.dir;
    setImageDir(ispId, imageTabIdx, {
      dir,
      ...(previousDir !== dir ? { entries: [], current: 0 } : {}),
      tomlData: {}, status: "scanning", message: null,
    });
    try {
      const entries = await scanImageDir(dir);
      if (requestId !== imageRequestId.current) return;
      if (entries.length === 0) {
        setImageDir(ispId, imageTabIdx, {
          entries: [], current: 0, tomlData: {},
          status: "error",
          message: "目录下没有找到 JPG、JPEG 或 PNG 图片",
        });
        return;
      }
      const current = Math.max(0, entries.findIndex((entry) => entry.jpg_path === selectedImage));
      setImageDir(ispId, imageTabIdx, { entries, current, tomlData: {}, status: "loading", message: null });
      const tomlData = await loadImageToml(entries[current].toml_path).catch((): Record<string, string> => ({}));
      if (requestId !== imageRequestId.current) return;
      const latest = useMtkStore.getState().imageDir[`${ispId}|${imageTabIdx}`];
      if (latest?.dir !== dir || latest.entries[latest.current]?.jpg_path !== entries[current].jpg_path) return;
      setImageDir(ispId, imageTabIdx, {
        tomlData, status: "done",
        message: `已加载 ${entries.length} 张图片 · 当前 ${entries[current].name}`,
      });
    } catch (e) {
      if (requestId !== imageRequestId.current) return;
      setImageDir(ispId, imageTabIdx, {
        status:  "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [ispId, imageTabIdx, setImageDir]);

  const savedImageDir = mtk.image_workspaces?.[imageKey]?.dir;
  useEffect(() => {
    if (!savedImageDir || useMtkStore.getState().imageDir[imageKey]?.dir === savedImageDir) return;
    const selected = useMtkStore.getState().mtk.image_workspaces?.[imageKey]?.selected_image;
    void onImageDirChange(savedImageDir, selected);
    const request = imageRequestId.current;
    return () => {
      if (imageRequestId.current === request) {
        imageRequestId.current += 1;
        // A cancelled restore must remain eligible when the effect remounts.
        const current = useMtkStore.getState().imageDir[imageKey];
        if (current?.status === "scanning" || current?.status === "loading") {
          setImageDir(ispId, imageTabIdx, { dir: null, entries: [], current: 0, tomlData: {}, status: "idle" });
        }
      }
    };
  }, [savedImageDir, imageKey, imageTabIdx, ispId, onImageDirChange, setImageDir]);

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
        onDebugParserPathChange={onDebugParserPathChange}
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
                  key={`${ispId}|${tabIdx}`}
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
                  onDebugParserPathChange={onDebugParserPathChange}
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
