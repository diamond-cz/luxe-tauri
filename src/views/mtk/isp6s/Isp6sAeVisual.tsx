import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  PanelBottomContract20Regular,
  PanelBottomExpand20Filled,
} from "@fluentui/react-icons";
import { Panel, PanelGroup, type ImperativePanelHandle } from "react-resizable-panels";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { getIsp6sSchema, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import { loadImageToml, parseImageExif, scanImageDir, type ExifParseProgress, type ImageEntry } from "@/ipc/imageScan";
import type { ToastKind } from "@/components/common/Toast";
import { saveStateSection } from "@/ipc/stateIo";
import { useMtkStore, DEFAULT_IMAGE_DIR_STATE } from "@/stores/mtkStore";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import type { IspId } from "../ispTabs";
import { LceTab, TablePane } from "./TablePane/TablePane";
import { NormalTable } from "./TablePane/NormalTable";
import { FaceTable } from "./TablePane/FaceTable";
import { ParaCheckMode } from "./ImagePane/ParaCheckMode";
import type { PreviewMode, SourceEditorBinding } from "./ImagePane/ImagePane";
import type { ParseResult } from "@/types/cpp_parser";
import { workspaceSession, type DetailsTab } from "./workspaceSession";

const ImagePane = lazy(() => import("./ImagePane/ImagePane").then(({ ImagePane }) => ({ default: ImagePane })));

interface Props {
  isp:       IspId;
  tabIdx:    number;
  /** cpp file path — must be present when `parsed` is true so source jumps work. */
  filePath:  string | null;
  /** true once the parameter file has been successfully parsed. */
  parsed:    boolean;
  toneMode?: boolean;
  toneParsed?: ParseResult | null;
  cppImportRevision: number;
  onImageDirChange: (dir: string) => void;
  onCppPathChange: (path: string) => void;
  debugParserPath: string | null;
  onDebugParserPathChange: (path: string) => void;
  onNotice: (toast: { kind: ToastKind; title: string; detail?: string }) => void;
  onWorkspaceDividerChange: (x: number) => void;
}

const CARD_GAP_PX      = 12;
const DETAILS_DEFAULT_SIZE = 42;
const DETAILS_MIN_SIZE = 25;
const WORKSPACE_DIVIDER_ID = "isp6s-workspace-source-divider";
let isp6sSchemaPromise: Promise<Isp6sSchemaRoot> | null = null;

export function Isp6sAeVisual({
  isp, tabIdx, filePath, cppImportRevision, toneMode = false, toneParsed, onImageDirChange, onCppPathChange, debugParserPath, onDebugParserPathChange, onNotice, onWorkspaceDividerChange,
}: Props) {
  const workspaceKey = `${isp}|${tabIdx}`;
  const session = workspaceSession(workspaceKey);
  const [schema, setSchema] = useState<Isp6sSchemaRoot | null>(null);
  const [err,    setErr]    = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>(() => session.detailsTab);
  const [sourceEditorBinding, setSourceEditorBinding] = useState<SourceEditorBinding | null>(null);
  const [tonePreviewMode, setTonePreviewMode] = useState<PreviewMode>(() => session.sourceMode);
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [heatmapSelection, setHeatmapSelection] = useState<{ entries: ImageEntry[]; paths: string[] } | null>(null);
  const [imageSearchError, setImageSearchError] = useState<string | null>(null);
  const [calculatorSourcePath, setCalculatorSourcePath] = useState<string | null>(filePath);
  const [exifProgress, setExifProgress] = useState<ExifParseProgress | null>(null);
  const [exifParsing, setExifParsing] = useState(false);
  const [imageDataRevision, setImageDataRevision] = useState(0);
  const exifParsingRef = useRef(false);
  const workspaceRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceLeftRef = useRef<HTMLDivElement | null>(null);
  const detailsBodyRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const body = detailsBodyRef.current;
    if (!body) return;
    const saved = session.detailsScroll[detailsTab];
    if (!saved) return;
    let frame: number | null = null;
    const restore = () => {
      const scroller = body.querySelector<HTMLElement>(".normal-sheet-viewport, [data-isp6s-details-scroll]");
      if (!scroller) return false;
      frame = window.requestAnimationFrame(() => {
        scroller.scrollTop = saved.top;
        scroller.scrollLeft = saved.left;
      });
      return true;
    };
    const observer = new MutationObserver(() => { if (restore()) observer.disconnect(); });
    if (!restore()) observer.observe(body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [detailsTab, schema, session]);
  const reportWorkspaceDivider = useCallback(() => {
    const rect = document.getElementById(WORKSPACE_DIVIDER_ID)?.getBoundingClientRect();
    if (rect) onWorkspaceDividerChange(rect.left + rect.width / 2);
  }, [onWorkspaceDividerChange]);

  useLayoutEffect(() => {
    const root = workspaceRootRef.current;
    const left = workspaceLeftRef.current;
    if (!schema || !root || !left) return;
    const observer = new ResizeObserver(reportWorkspaceDivider);
    observer.observe(root);
    observer.observe(left);
    reportWorkspaceDivider();
    return () => observer.disconnect();
  }, [schema, reportWorkspaceDivider]);
  const imageTabIdx = toneMode ? 0 : tabIdx;
  const imageDirEntry = useMtkStore((s) => s.imageDir[`${isp}|${imageTabIdx}`]);
  const imageDir = imageDirEntry ?? DEFAULT_IMAGE_DIR_STATE;
  const currentEntry = imageDir.entries[imageDir.current];
  const setImageDir   = useMtkStore((s) => s.setImageDir);

  useEffect(() => {
    if (!imageDir.dir) {
      session.selectedToml = null;
      setHeatmapSelection(null);
      return;
    }
    if (session.imageDir !== imageDir.dir) {
      session.imageDir = imageDir.dir;
      session.imagePath = currentEntry?.jpg_path ?? null;
      session.imageScroll = null;
      session.selectedToml = null;
      setHeatmapSelection(null);
      return;
    }
    if (imageDir.entries.length === 0) return;
    if (!session.imagePath) {
      session.imagePath = currentEntry?.jpg_path ?? null;
      return;
    }
    const savedIndex = imageDir.entries.findIndex((entry) => entry.jpg_path === session.imagePath);
    if (savedIndex >= 0 && savedIndex !== imageDir.current) void onPickImage(savedIndex);
  // Restore only when the workspace mounts or the folder changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDir.dir, imageDir.entries, session]);

  useEffect(() => {
    if (imageDir.status === "done" && currentEntry
      && session.imagePath === currentEntry.jpg_path) {
      session.selectedToml = {
        dir: imageDir.dir ?? "",
        path: currentEntry.toml_path,
        data: imageDir.tomlData,
      };
    }
  }, [currentEntry, imageDir.entries, imageDir.status, imageDir.tomlData, session]);

  const handleParseExif = async () => {
    if (exifParsingRef.current) return;
    const dir = imageDir.dir;
    if (!dir || imageDir.entries.length === 0) {
      onNotice({ kind: "info", title: "请先导入图片文件夹" });
      return;
    }
    let parserPath = debugParserPath;
    if (!parserPath) {
      onNotice({ kind: "info", title: "请先导入 DP 解析工具 DebugParser.exe" });
      const picked = await openDialog({ multiple: false, filters: [{ name: "DebugParser.exe", extensions: ["exe"] }] });
      if (typeof picked !== "string") return;
      if (picked.split(/[\\/]/).pop()?.toLowerCase() !== "debugparser.exe") {
        onNotice({ kind: "error", title: "请选择 DebugParser.exe" });
        return;
      }
      parserPath = picked;
      onDebugParserPathChange(picked);
    }

    exifParsingRef.current = true;
    setExifParsing(true);
    setExifProgress({ stage: "EXIF", completed: 0, total: imageDir.entries.length });
    const selectedPath = currentEntry?.jpg_path;
    try {
      const result = await parseImageExif(parserPath, dir, (progress) => {
        if (exifParsingRef.current) setExifProgress(progress);
      });
      if (useMtkStore.getState().imageDir[`${isp}|${imageTabIdx}`]?.dir !== dir) return;
      const entries = await scanImageDir(dir);
      const current = Math.max(0, entries.findIndex((entry) => entry.jpg_path === selectedPath));
      const tomlData = entries[current]
        ? await loadImageToml(entries[current].toml_path).catch((): Record<string, string> => ({}))
        : {};
      setImageDir(isp, imageTabIdx, { entries, current, tomlData, status: "done", message: null });
      setImageDataRevision((revision) => revision + 1);
      onNotice({
        kind: result.failed > 0 ? "error" : "success",
        title: result.failed > 0 ? "部分图片解析失败" : "图片解析完成",
        detail: `生成 ${result.processed} 张，跳过 ${result.skipped} 张，失败 ${result.failed} 张`,
      });
    } catch (error) {
      onNotice({ kind: "error", title: "图片 EXIF 解析失败", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      exifParsingRef.current = false;
      setExifParsing(false);
      setExifProgress(null);
    }
  };

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
    isp6sSchemaPromise ??= getIsp6sSchema();
    isp6sSchemaPromise
      .then((s) => { if (!cancelled) setSchema(s); })
      .catch((e) => { isp6sSchemaPromise = null; if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  /* Image switching is driven by TablePane row clicks; folder selection also
   * lives in the image-list card. */
  const onPickImage = async (idx: number) => {
    if (idx < 0 || idx >= imageDir.entries.length) return;
    const selectedEntry = imageDir.entries[idx];
    session.imageDir = imageDir.dir;
    session.imagePath = selectedEntry.jpg_path;
    const imageDirKey = `${isp}|${imageTabIdx}`;
    const selectionIsCurrent = () => {
      const current = useMtkStore.getState().imageDir[imageDirKey];
      return current?.dir === imageDir.dir && current.current === idx
        && current.entries[idx]?.jpg_path === selectedEntry.jpg_path;
    };
    setHeatmapSelection(null);
    const cachedToml = session.selectedToml?.dir === imageDir.dir
      && session.selectedToml.path === selectedEntry.toml_path
      ? session.selectedToml.data : null;
    setImageDir(isp, imageTabIdx, {
      dir: imageDir.dir, entries: imageDir.entries,
      current: idx, tomlData: cachedToml ?? {}, status: cachedToml ? "done" : "loading", message: null,
    });
    if (cachedToml) return;
    try {
      const tomlData = await loadImageToml(selectedEntry.toml_path);
      if (!selectionIsCurrent()) return;
      session.selectedToml = { dir: imageDir.dir ?? "", path: selectedEntry.toml_path, data: tomlData };
      setImageDir(isp, imageTabIdx, {
        tomlData, status: "done",
        message: `当前 ${imageDir.entries[idx].name}`,
      });
    } catch {
      if (!selectionIsCurrent()) return;
      setImageDir(isp, imageTabIdx, {
        tomlData: {},
        status: "done",
        message: `当前 ${imageDir.entries[idx].name}（未找到同名 TOML，暂显示 -）`,
      });
    }
  };

  const onSelectHeatmapImages = (paths: string[]) => {
    const matchingPaths = new Set(paths);
    const selected = imageDir.entries.filter((entry) => matchingPaths.has(entry.toml_path));
    if (selected.length > 0) {
      const firstIndex = imageDir.entries.indexOf(selected[0]);
      void onPickImage(firstIndex);
    }
    setHeatmapSelection({ entries: imageDir.entries, paths: selected.map((entry) => entry.toml_path) });
  };
  const selectedHeatmapPaths = heatmapSelection?.entries === imageDir.entries ? heatmapSelection.paths : [];

  const handleImageSearch = async () => {
    const query = imageSearchQuery.trim();
    if (!query) {
      setImageSearchError(null);
      return;
    }

    const normalise = (value: string) => value.toLocaleLowerCase().replace(/[\s_.-]+/g, "");
    const fuzzyMatches = (candidate: string, search: string) => {
      const text = normalise(candidate);
      const needle = normalise(search);
      if (!needle) return false;
      if (text.includes(needle)) return true;
      let offset = 0;
      for (const character of needle) {
        offset = text.indexOf(character, offset);
        if (offset < 0) return false;
        offset += 1;
      }
      return true;
    };

    const matchIndex = imageDir.entries.findIndex((entry) => {
      const fileName = entry.jpg_path.split(/[\\/]/).filter(Boolean).pop() ?? entry.name;
      return fuzzyMatches(entry.name, query) || fuzzyMatches(fileName, query);
    });
    if (matchIndex < 0) {
      setImageSearchError("未找到匹配图片");
      return;
    }

    const matched = imageDir.entries[matchIndex];
    const fileName = matched.jpg_path.split(/[\\/]/).filter(Boolean).pop() ?? matched.name;
    setImageSearchQuery(fileName);
    setImageSearchError(null);
    await onPickImage(matchIndex);
  };

  const workspaceRatios = useMemo(() => {
    const values = visual.workspace_column_ratios ?? [];
    return values.every((value) => Number.isFinite(value) && value >= 0) && values.some((value) => value > 0)
      ? values : [67, 33];
  }, [visual.workspace_column_ratios]);
  const sourceColumnSize = Math.min(70, Math.max(24, workspaceRatios[workspaceRatios.length - 1] ?? 33));
  const detailsSize = Number.isFinite(visual.workspace_details_ratio)
    ? Math.min(70, Math.max(DETAILS_MIN_SIZE, visual.workspace_details_ratio))
    : DETAILS_DEFAULT_SIZE;
  const detailsPanelRef = useRef<ImperativePanelHandle | null>(null);

  const hideDetailsPanel = () => {
    const panel = detailsPanelRef.current;
    if (!panel) return;
    const size = panel.getSize();
    if (size >= DETAILS_MIN_SIZE) patchVis({ workspace_details_ratio: size });
    panel.collapse();
  };

  const setPreviewMode = useCallback((m: PreviewMode) => patchVis({ preview_mode: m }), [patchVis]);

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

  const renderDetailsPanel = () => {
    const tabs: Array<{ id: typeof detailsTab; label: string }> = [
      { id: "normal", label: "Normal" },
      { id: "face", label: "Face" },
      { id: "lce", label: "LCE" },
      { id: "bcompare", label: "bcompare" },
    ];

    return (
      <div className="flex h-full w-full flex-col overflow-hidden"
           style={{
             background: "var(--colorNeutralBackground1)",
             border: "1px solid var(--colorNeutralStroke2)",
             borderRadius: 8,
           }}>
        <div className="flex h-8 shrink-0 items-stretch px-2"
             style={{
               background: "var(--colorNeutralBackground2)",
               borderBottom: "1px solid var(--colorNeutralStroke2)",
             }}>
          {tabs.map((tab) => {
            const active = detailsTab === tab.id;
            const button = (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { session.detailsTab = tab.id; setDetailsTab(tab.id); }}
                className="px-3 text-xs transition-colors"
                style={{
                  color: active ? "var(--colorNeutralForeground1)" : "var(--colorNeutralForeground3)",
                  background: active ? "var(--colorNeutralBackground1)" : "transparent",
                  border: 0,
                  borderBottom: active ? "2px solid var(--colorBrandStroke1)" : "2px solid transparent",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {tab.label}
              </button>
            );
            return button;
          })}
          <button
            type="button"
            title="隐藏图片详情卡片"
            aria-label="隐藏图片详情卡片"
            onClick={hideDetailsPanel}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center"
            style={{ color: "var(--colorNeutralForeground2)" }}
          >
            <PanelBottomContract20Regular />
          </button>
        </div>
        <div ref={detailsBodyRef} className="min-h-0 flex-1 overflow-hidden"
             onScrollCapture={(event) => {
               const target = event.target;
               if (target instanceof HTMLElement && target !== detailsBodyRef.current) {
                 session.detailsScroll[detailsTab] = { top: target.scrollTop, left: target.scrollLeft };
               }
             }}>
          {detailsTab === "normal" && <NormalTable tomlData={imageDir.tomlData} />}
          {detailsTab === "face" && <FaceTable tomlData={imageDir.tomlData} />}
          {detailsTab === "lce" && (
            <LceTab
              schema={schema}
              tomlData={imageDir.tomlData}
            />
          )}
          {detailsTab === "bcompare" && (
            <ParaCheckMode
              filePath={filePath ?? ""}
              schema={schema}
              tomlData={imageDir.tomlData}
              sourceEditor={sourceEditorBinding?.filePath === filePath
                && sourceEditorBinding.importRevision === cppImportRevision ? sourceEditorBinding : null}
            />
          )}
        </div>
      </div>
    );
  };

  /* ── Table panel — wraps TablePane in standard padding. ── */
  const renderTablePanel = () => (
    <div className="h-full w-full min-w-0">
      <Suspense fallback={<PaneFallback label="正在加载图片列表..." />}>
        <TablePane
          schema={schema}
          toneMode={toneMode}
          filePath={filePath}
          cppImportRevision={cppImportRevision}
          calculatorSourcePath={calculatorSourcePath}
          entries={imageDir.entries}
          current={imageDir.current}
          selectedHeatmapPaths={selectedHeatmapPaths}
          imageDir={imageDir.dir}
          imageDataRevision={imageDataRevision}
          scrollPosition={session.imageDir === imageDir.dir ? session.imageScroll : null}
          onScrollPositionChange={(position) => { session.imageScroll = position; }}
          exifParsing={exifParsing}
          onParseExif={() => void handleParseExif()}
          onPickImage={onPickImage}
          onImageDirChange={onImageDirChange}
          imageSearchQuery={imageSearchQuery}
          imageSearchError={imageSearchError}
          onImageSearchQueryChange={(value) => {
            setImageSearchQuery(value);
            if (imageSearchError) setImageSearchError(null);
          }}
          onImageSearch={() => void handleImageSearch()}
        />
      </Suspense>
    </div>
  );

  /* ── Final layout ── */
  const renderSourceCodePanel = () => (
    <div className="h-full w-full min-w-0">
      <Suspense fallback={<PaneFallback label="正在加载源代码卡片..." />}>
        <ImagePane
          key={`${filePath ?? ""}|${cppImportRevision}`}
          toneMode={toneMode}
          toneParsed={toneParsed}
          importRevision={cppImportRevision}
          mode={toneMode ? tonePreviewMode : visual.preview_mode ?? "param_map"}
          onMode={toneMode ? (mode) => { session.sourceMode = mode; setTonePreviewMode(mode); } : (mode) => { session.sourceMode = mode; setPreviewMode(mode); }}
          filePath={filePath ?? ""}
          onCppPathChange={onCppPathChange}
          schema={schema}
          entry={currentEntry}
          entries={imageDir.entries}
          tomlData={imageDir.tomlData}
          onSelectHeatmapImages={onSelectHeatmapImages}
          onCalculatorSourcePathChange={setCalculatorSourcePath}
          onSourceEditorBindingChange={setSourceEditorBinding}
          scrollSession={session}
        />
      </Suspense>
    </div>
  );

  const updateSourceColumnSize = (size: number) => {
    const nextSourceSize = Math.min(70, Math.max(24, size));
    if (Math.abs(nextSourceSize - sourceColumnSize) < 0.05) return;
    patchVis({ workspace_column_ratios: [100 - nextSourceSize, nextSourceSize] });
  };

  if (toneMode) {
    return (
      <div ref={workspaceRootRef} className="flex h-full w-full min-w-0 flex-col">
        {exifProgress && (
          <div className="mb-2 flex h-7 shrink-0 items-center gap-3 px-2 text-xs"
               style={{ color: "var(--colorNeutralForeground2)", background: "var(--colorNeutralBackground2)" }}>
            <span className="shrink-0">{exifProgress.stage} {exifProgress.completed}/{exifProgress.total}</span>
            <progress className="h-2 min-w-0 flex-1" value={exifProgress.completed} max={Math.max(1, exifProgress.total)}
                      style={{ accentColor: "var(--colorBrandBackground)" }} aria-label="图片解析进度" />
          </div>
        )}
        <PanelGroup direction="horizontal" className="min-h-0 w-full min-w-0 flex-1">
          <Panel defaultSize={100 - session.toneSourceSize} minSize={30} className="min-w-0 overflow-hidden">
            <div ref={workspaceLeftRef} className="h-full w-full min-w-0">
              <PanelGroup direction="vertical" className="h-full w-full min-w-0">
                <Panel defaultSize={100 - session.toneLceSize} minSize={25} className="min-h-0 overflow-hidden">
                  {renderTablePanel()}
                </Panel>
                <ResizeHandle direction="vertical" size={CARD_GAP_PX} />
                <Panel defaultSize={session.toneLceSize} minSize={25} className="min-h-0 overflow-hidden" onResize={(size) => {
                  if (Number.isFinite(size) && size >= 25 && size <= 75) session.toneLceSize = size;
                }}>
                  <div className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg border"
                       style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground1)" }}>
                    <div className="flex h-8 shrink-0 items-end border-b px-2"
                         style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground2)" }}>
                      <span className="border-b-2 px-3 py-1 text-xs font-semibold"
                            style={{ borderColor: "var(--colorBrandStroke1)", color: "var(--colorNeutralForeground1)" }}>LCE</span>
                    </div>
                    <div className="min-h-0 flex-1">
                      <LceTab schema={schema} tomlData={imageDir.tomlData} />
                    </div>
                  </div>
                </Panel>
              </PanelGroup>
            </div>
          </Panel>
          <ResizeHandle id={WORKSPACE_DIVIDER_ID} direction="horizontal" size={CARD_GAP_PX} />
          <Panel defaultSize={session.toneSourceSize} minSize={25} className="min-w-0 overflow-hidden" onResize={(size) => {
            if (Number.isFinite(size) && size >= 25 && size <= 70) session.toneSourceSize = size;
          }}>
            {renderSourceCodePanel()}
          </Panel>
        </PanelGroup>
      </div>
    );
  }

  return (
    <div ref={workspaceRootRef} className="flex h-full w-full min-w-0 flex-col">
    {exifProgress && (
      <div className="mb-2 flex h-7 shrink-0 items-center gap-3 px-2 text-xs"
           style={{ color: "var(--colorNeutralForeground2)", background: "var(--colorNeutralBackground2)" }}>
        <span className="shrink-0">{exifProgress.stage} {exifProgress.completed}/{exifProgress.total}</span>
        <progress className="h-2 min-w-0 flex-1" value={exifProgress.completed} max={Math.max(1, exifProgress.total)}
                  style={{ accentColor: "var(--colorBrandBackground)" }}
                  aria-label={`图片解析 ${exifProgress.stage}`} />
      </div>
    )}
    <PanelGroup direction="horizontal" className="min-h-0 w-full min-w-0 flex-1">
      <Panel defaultSize={100 - sourceColumnSize} minSize={30} className="min-w-0 overflow-hidden">
        <div ref={workspaceLeftRef} className="relative h-full w-full min-w-0">
        <PanelGroup direction="vertical" className="h-full w-full min-w-0">
          <Panel defaultSize={visual.table_collapsed ? 100 : 100 - detailsSize} minSize={30}>
            {renderTablePanel()}
          </Panel>
          <ResizeHandle direction="vertical" size={visual.table_collapsed ? 0 : CARD_GAP_PX} className="overflow-hidden" />
          <Panel
            ref={detailsPanelRef}
            defaultSize={visual.table_collapsed ? 0 : detailsSize}
            minSize={DETAILS_MIN_SIZE}
            collapsible
            collapsedSize={0}
            onCollapse={() => patchVis({ table_collapsed: true })}
            onExpand={() => patchVis({ table_collapsed: false })}
            onResize={(size) => {
              if (size >= DETAILS_MIN_SIZE && Math.abs(size - detailsSize) > 0.05) {
                patchVis({ workspace_details_ratio: size });
              }
            }}
          >
            {renderDetailsPanel()}
          </Panel>
        </PanelGroup>
        {visual.table_collapsed && (
          <button
            type="button"
            title="显示图片详情卡片"
            aria-label="显示图片详情卡片"
            onClick={() => detailsPanelRef.current?.expand(detailsSize)}
            className="absolute bottom-1 left-1/2 z-20 flex h-7 w-7 -translate-x-1/2 items-center justify-center"
            style={{
              border: "1px solid var(--colorNeutralStroke2)",
              borderRadius: 8,
              background: "var(--colorNeutralBackground1)",
              color: "var(--colorBrandForeground1)",
            }}
          >
            <PanelBottomExpand20Filled />
          </button>
        )}
        </div>
      </Panel>
      <ResizeHandle id={WORKSPACE_DIVIDER_ID} direction="horizontal" size={CARD_GAP_PX} />
      <Panel defaultSize={sourceColumnSize} minSize={24} className="min-w-0 overflow-hidden" onResize={updateSourceColumnSize}>
        {renderSourceCodePanel()}
      </Panel>
    </PanelGroup>
    </div>
  );

}

function PaneFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs"
         style={{ color: "var(--colorNeutralForeground3)" }}>
      {label}
    </div>
  );
}
