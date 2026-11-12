import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { Panel, PanelGroup, type ImperativePanelHandle } from "react-resizable-panels";
import { PanelBottomExpand20Regular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { getIsp6sSchema, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import { loadImageToml, type ExifParseProgress, type ImageEntry } from "@/ipc/imageScan";
import { clearWorkspaceImageSidecars, prepareWorkspaceImageSidecars, ImageExifTaskError, parseWorkspaceImageExif, type ImageSidecarCleanupPlan } from "@/services/imageExifService";
import { ImageSidecarCleanupDialog } from "./TablePane/ImageSidecarCleanupDialog";
import { MetadataProgress } from "./TablePane/MetadataProgress";
import type { ToastKind } from "@/components/common/Toast";
import { saveStateSection } from "@/ipc/stateIo";
import { useMtkStore, DEFAULT_IMAGE_DIR_STATE } from "@/stores/mtkStore";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import type { IspId } from "../ispTabs";
import { LceTab, TablePane } from "./TablePane/TablePane";
import { NormalTable } from "./TablePane/NormalTable";
import { FaceTable } from "./TablePane/FaceTable";
import { ExifTable } from "./TablePane/ExifTable";
import { ParaCheckMode } from "./ImagePane/ParaCheckMode";
import type { PreviewMode, SourceEditorBinding } from "./ImagePane/ImagePane";
import type { ParseResult } from "@/types/cpp_parser";
import { workspaceSession, type DetailsTab, type ScrollPosition, type WorkspaceSession } from "./workspaceSession";
import { WorkspaceColumns, WorkspaceHideButton } from "./WorkspaceColumns";
import { panelMotionStyle, usePanelCollapseTransition } from "./usePanelCollapseTransition";
import { publishImageSelection } from "@/services/imageSyncService";

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
  caLtmParsed?: ParseResult | null;
  caLtmPath?: string | null;
  caLtmRevision?: number;
  caLtmStatus?: "idle" | "parsing" | "done" | "error";
  caLtmMessage?: string | null;
  cppImportRevision: number;
  onImageDirChange: (dir: string) => void;
  onCppPathChange: (path: string) => void;
  debugParserPath: string | null;
  onNotice: (toast: { kind: ToastKind; title: string; detail?: string }) => void;
  onWorkspaceDividerChange: (x: number) => void;
}

const CARD_GAP_PX      = 12;
const WORKSPACE_DIVIDER_ID = "isp6s-workspace-source-divider";
const DETAILS_DEFAULT_SIZE = 42;
const DETAILS_MIN_SIZE = 25;
const AE_DETAILS_TABS = [
  { id: "exif", label: "EXIF" },
  { id: "normal", label: "Normal" },
  { id: "face", label: "Face" },
  { id: "lce", label: "LCE" },
  { id: "bcompare", label: "bcompare" },
] as const;
const TONE_DETAILS_TABS = [
  { id: "exif", label: "EXIF" },
  { id: "lce", label: "LCE" },
  { id: "tone_cpp", label: "Tone.cpp" },
] as const;
let isp6sSchemaPromise: Promise<Isp6sSchemaRoot> | null = null;

export function Isp6sAeVisual({
  isp, tabIdx, filePath, cppImportRevision, toneMode = false, toneParsed, caLtmParsed, caLtmPath, caLtmRevision, caLtmStatus, caLtmMessage, onImageDirChange, onCppPathChange, debugParserPath, onNotice, onWorkspaceDividerChange,
}: Props) {
  const { t } = useTranslation();
  const workspaceKey = `${isp}|${tabIdx}`;
  const session = workspaceSession(workspaceKey);
  const [schema, setSchema] = useState<Isp6sSchemaRoot | null>(null);
  const [err,    setErr]    = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>(() => {
    const saved = session.detailsTab;
    const initial = toneMode
      ? saved === "exif" || saved === "tone_cpp" ? saved : "lce"
      : saved === "normal" || saved === "face" || saved === "lce" || saved === "exif" || saved === "bcompare"
        ? saved
        : "normal";
    session.detailsTab = initial;
    return initial;
  });
  const [sourceEditorBinding, setSourceEditorBinding] = useState<SourceEditorBinding | null>(null);
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [heatmapSelection, setHeatmapSelection] = useState<{ entries: ImageEntry[]; paths: string[] } | null>(null);
  const [visibleHeatmapPaths, setVisibleHeatmapPaths] = useState<{ entries: ImageEntry[]; paths: string[] | null } | null>(null);
  const [imageSearchError, setImageSearchError] = useState<string | null>(null);
  const [calculatorSourcePath, setCalculatorSourcePath] = useState<string | null>(filePath);
  const [exifProgress, setExifProgress] = useState<ExifParseProgress | null>(null);
  const [cleanupPlan, setCleanupPlan] = useState<ImageSidecarCleanupPlan | null>(null);
  const [deletingSidecars, setDeletingSidecars] = useState(false);
  const [exifParsing, setExifParsing] = useState(false);
  const exifParsingRef = useRef(false);
  const exifRequestRef = useRef(0);
  const exifProgressControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    exifRequestRef.current += 1;
    exifProgressControllerRef.current?.abort();
    exifProgressControllerRef.current = null;
    exifParsingRef.current = false;
  }, []);
  const workspaceRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceLeftRef = useRef<HTMLDivElement | null>(null);
  const reportWorkspaceDivider = useCallback(() => {
    const rect = document.getElementById(WORKSPACE_DIVIDER_ID)?.getBoundingClientRect();
    if (rect && rect.width > 0) onWorkspaceDividerChange(rect.left + rect.width / 2);
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
  const workspaceSelection = useMtkStore((s) => s.imageSelection[workspaceKey]);
  const setImageSelection = useMtkStore((s) => s.setImageSelection);
  const imageDir = imageDirEntry ?? DEFAULT_IMAGE_DIR_STATE;
  const imageDataRevision = imageDir.metadataRevision ?? 0;
  const selectionSyncEnabled = useIsp6sVisualStore((s) => s.selectionSyncEnabled);
  const setSelectionSyncEnabled = useIsp6sVisualStore((s) => s.setSelectionSyncEnabled);
  const pairedWorkspaceKey = isp === "ISP6S" && (tabIdx === 0 || tabIdx === 1)
    ? `${isp}|${tabIdx === 0 ? 1 : 0}` : null;
  const syncPairedScroll = (path: string, position: ScrollPosition | null,
    enabled = useIsp6sVisualStore.getState().selectionSyncEnabled) => {
    if (!enabled || !pairedWorkspaceKey) return;
    const pairedSession = workspaceSession(pairedWorkspaceKey);
    pairedSession.imageDir = imageDir.dir;
    pairedSession.imagePath = path;
    pairedSession.imageScroll = position ? { ...position } : { top: 0, left: 0 };
    pairedSession.imageScrollPath = path;
  };
  const selectedIndex = workspaceSelection
    ? imageDir.entries.findIndex((entry) => entry.jpg_path === workspaceSelection)
    : imageDir.current;
  const currentIndex = selectedIndex >= 0 && selectedIndex < imageDir.entries.length ? selectedIndex : imageDir.current;
  const currentEntry = imageDir.entries[currentIndex];
  const setImageDir   = useMtkStore((s) => s.setImageDir);
  const [selectedTomlData, setSelectedTomlData] = useState<Record<string, string>>({});
  const selectedTomlLoadRef = useRef(0);

  useEffect(() => {
    const requestId = ++selectedTomlLoadRef.current;
    if (!currentEntry || !imageDir.dir) {
      setSelectedTomlData({});
      return;
    }
    const cached = session.selectedToml;
    if (cached?.dir === imageDir.dir && cached.path === currentEntry.toml_path && cached.revision === imageDataRevision) {
      setSelectedTomlData(cached.data);
      return;
    }
    let active = true;
    setSelectedTomlData({});
    void loadImageToml(currentEntry.toml_path).then((data) => {
      if (!active || requestId !== selectedTomlLoadRef.current) return;
      session.selectedToml = { dir: imageDir.dir ?? "", path: currentEntry.toml_path, revision: imageDataRevision, data };
      setSelectedTomlData(data);
    }).catch(() => {
      if (active && requestId === selectedTomlLoadRef.current) setSelectedTomlData({});
    }).finally(() => {
      active = false;
    });
    return () => { active = false; };
  }, [currentEntry?.jpg_path, currentEntry?.toml_path, imageDir.dir, imageDir.entries, imageDataRevision, session]);

  useEffect(() => {
    if (!imageDir.dir) {
      session.selectedToml = null;
      setHeatmapSelection(null);
      return;
    }
    const folderChanged = session.imageDir !== imageDir.dir;
    const previousPath = folderChanged ? null : session.imagePath;
    if (folderChanged) {
      session.imageDir = imageDir.dir;
      session.imageScroll = null;
      session.imageScrollPath = null;
      session.selectedToml = null;
      setHeatmapSelection(null);
    }
    if (imageDir.entries.length === 0) return;
    const selectedPath = imageDir.entries.find((entry) => entry.jpg_path === workspaceSelection)?.jpg_path;
    if (selectedPath) {
      session.imagePath = selectedPath;
    } else {
      const restoredPath = imageDir.entries.find((entry) => entry.jpg_path === previousPath)?.jpg_path;
      const fallbackPath = restoredPath ?? currentEntry?.jpg_path ?? null;
      session.imagePath = fallbackPath;
      if (fallbackPath) setImageSelection(workspaceKey, fallbackPath);
    }
  }, [currentEntry?.jpg_path, imageDir.dir, imageDir.entries, session, setImageSelection, workspaceKey, workspaceSelection]);

  const handleParseExif = async () => {
    if (exifParsingRef.current) return;
    const dir = imageDir.dir;
    if (!dir || imageDir.entries.length === 0) {
      onNotice({ kind: "info", title: t("image_exif.error.empty") });
      return;
    }
    const request = ++exifRequestRef.current;
    const active = () => request === exifRequestRef.current;
    const sameWorkspace = () => active()
      && useMtkStore.getState().imageDir[`${isp}|${imageTabIdx}`]?.dir === dir;
    const progressController = new AbortController();
    exifProgressControllerRef.current = progressController;
    exifParsingRef.current = true;
    setExifParsing(true);
    setExifProgress({ stage: "EXIF", completed: 0, total: imageDir.entries.length });
    try {
      const result = await parseWorkspaceImageExif(isp, imageTabIdx, debugParserPath, (progress) => {
        if (sameWorkspace()) setExifProgress(progress);
      }, workspaceKey, progressController.signal);
      if (!sameWorkspace()) return;
      const incomplete = result.failed > 0 || result.partial > 0;
      onNotice({
        kind: result.failed > 0 ? "error" : result.partial > 0 ? "info" : "success",
        title: t(incomplete ? "image_exif.partial" : "image_exif.completed"),
        detail: [t("image_exif.summary", { ...result }),
          result.partial > 0 ? t("image_exif.fallback_hint") : ""].filter(Boolean).join(" "),
      });
    } catch (error) {
      if (sameWorkspace()) onNotice({ kind: "error", title: t("image_exif.failed"),
        detail: error instanceof ImageExifTaskError ? t(`image_exif.error.${error.code}`)
          : error instanceof Error ? error.message : String(error) });
    } finally {
      progressController.abort();
      if (exifProgressControllerRef.current === progressController) {
        exifProgressControllerRef.current = null;
      }
      if (active()) {
        exifParsingRef.current = false;
        setExifParsing(false);
        setExifProgress(null);
      }
    }
  };

  const handlePreviewSidecars = async (imagePaths: string[]) => {
    if (exifParsingRef.current) return;
    const request = ++exifRequestRef.current;
    const dir = imageDir.dir;
    const active = () => request === exifRequestRef.current;
    const sameWorkspace = () => active() && useMtkStore.getState().imageDir[`${isp}|${imageTabIdx}`]?.dir === dir;
    exifParsingRef.current = true;
    setExifParsing(true);
    try {
      const plan = await prepareWorkspaceImageSidecars(isp, imageTabIdx, imagePaths, workspaceKey);
      if (!sameWorkspace()) {
        if (active()) { exifParsingRef.current = false; setExifParsing(false); }
        return;
      }
      if (!plan.files.length) onNotice({ kind: "info", title: t("image_exif.cleanup.none") });
      else { setCleanupPlan(plan); return; }
    } catch (error) {
      if (sameWorkspace()) onNotice({ kind: "error", title: t("image_exif.cleanup.failed"),
        detail: error instanceof ImageExifTaskError ? t(`image_exif.error.${error.code}`) : t("image_exif.cleanup.check_failed") });
    }
    if (active()) { exifParsingRef.current = false; setExifParsing(false); }
  };
  const cancelCleanup = () => {
    if (deletingSidecars) return;
    setCleanupPlan(null);
    exifParsingRef.current = false;
    setExifParsing(false);
  };
  const handleConfirmCleanup = async () => {
    if (!cleanupPlan || deletingSidecars) return;
    const plan = cleanupPlan;
    const request = ++exifRequestRef.current;
    const active = () => request === exifRequestRef.current;
    setDeletingSidecars(true);
    try {
      const result = await clearWorkspaceImageSidecars(isp, imageTabIdx, plan);
      if (active() && useMtkStore.getState().imageDir[`${isp}|${imageTabIdx}`]?.dir === plan.dir) {
        onNotice({ kind: result.failed.length ? "error" : "success", title: t("image_exif.cleanup.completed"),
          detail: t("image_exif.cleanup.summary", { deleted: result.deleted.length, failed: result.failed.length }) });
      }
    } catch (error) {
      if (active()) onNotice({ kind: "error", title: t("image_exif.cleanup.failed"),
        detail: error instanceof ImageExifTaskError ? t(`image_exif.error.${error.code}`) : t("image_exif.cleanup.check_failed") });
    } finally {
      if (active()) {
        setCleanupPlan(null); setDeletingSidecars(false); setExifParsing(false); exifParsingRef.current = false;
      }
    }
  };
  const cleanupDialog = <ImageSidecarCleanupDialog files={cleanupPlan?.files ?? null}
    imageCount={cleanupPlan?.imagePaths.length ?? 0} deleting={deletingSidecars}
    onCancel={cancelCleanup} onConfirm={() => void handleConfirmCleanup()} />;
  const metadataProgress = imageDir.metadataPreparing ? <MetadataProgress progress={imageDir.preparationProgress} />
    : exifProgress ? <MetadataProgress progress={exifProgress} /> : null;

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
  const onPickImage = async (idx: number, options?: { preserveHeatmapSelection?: boolean }) => {
    if (idx < 0 || idx >= imageDir.entries.length) return;
    const selectedEntry = imageDir.entries[idx];
    session.imageDir = imageDir.dir;
    session.imagePath = selectedEntry.jpg_path;
    session.imageScrollPath = selectedEntry.jpg_path;
    const imageDirKey = `${isp}|${imageTabIdx}`;
    setImageSelection(workspaceKey, selectedEntry.jpg_path);
    void publishImageSelection(selectedEntry.jpg_path).catch((error) =>
      console.debug("publish image sync selection failed", error),
    );
    if (selectionSyncEnabled && pairedWorkspaceKey) {
      setImageSelection(pairedWorkspaceKey, selectedEntry.jpg_path);
      syncPairedScroll(selectedEntry.jpg_path, session.imageScroll);
    }
    const selectionIsCurrent = () => {
      const latest = useMtkStore.getState();
      const current = latest.imageDir[imageDirKey];
      return current?.loadRevision === selectionRevision && current.dir === imageDir.dir && current.current === idx
        && current.entries[idx]?.jpg_path === selectedEntry.jpg_path;
    };
    // 普通点击图片时清除热力图筛选；标题栏的上一张/下一张导航会显式保留
    // 当前命中集合，避免切换当前图片时把多选状态一并清空。
    if (!options?.preserveHeatmapSelection) setHeatmapSelection(null);
    const cachedToml = session.selectedToml?.dir === imageDir.dir
      && session.selectedToml.path === selectedEntry.toml_path
      && session.selectedToml.revision === imageDataRevision
      ? session.selectedToml.data : null;
    setImageDir(isp, imageTabIdx, {
      current: idx, tomlData: cachedToml ?? {}, status: cachedToml ? "done" : "loading", message: null,
    });
    const selectionRevision = useMtkStore.getState().imageDir[imageDirKey].loadRevision;
    if (cachedToml) return;
    try {
      const tomlData = await loadImageToml(selectedEntry.toml_path);
      if (!selectionIsCurrent()) return;
      session.selectedToml = { dir: imageDir.dir ?? "", path: selectedEntry.toml_path, revision: imageDataRevision, data: tomlData };
      setImageDir(isp, imageTabIdx, {
        tomlData, status: "done",
        message: `当前 ${imageDir.entries[idx].name}`,
      });
    } catch {
      if (!selectionIsCurrent()) return;
      setImageDir(isp, imageTabIdx, {
        tomlData: {},
        status: "done",
        message: t("image_sync.current_without_toml", { name: imageDir.entries[idx].name }),
      });
    }
  };

  const onSelectHeatmapImages = (paths: string[], options?: { toggle?: boolean; focusPath?: string }) => {
    const currentPaths = heatmapSelection?.entries === imageDir.entries ? heatmapSelection.paths : [];
    const nextPaths = new Set(currentPaths);
    const matchingPaths = new Set(paths);
    if (options?.toggle) {
      for (const path of matchingPaths) {
        if (nextPaths.has(path)) nextPaths.delete(path);
        else nextPaths.add(path);
      }
    } else {
      nextPaths.clear();
      matchingPaths.forEach((path) => nextPaths.add(path));
    }
    const selected = imageDir.entries.filter((entry) => nextPaths.has(entry.toml_path));
    if (options?.focusPath) {
      const focusIndex = selected.findIndex((entry) => entry.toml_path === options.focusPath);
      if (focusIndex > 0) selected.unshift(selected.splice(focusIndex, 1)[0]);
    }
    if (selected.length > 0) {
      const firstIndex = imageDir.entries.indexOf(selected[0]);
      void onPickImage(firstIndex, { preserveHeatmapSelection: true });
    }
    setHeatmapSelection({ entries: imageDir.entries, paths: selected.map((entry) => entry.toml_path) });
  };
  const selectedHeatmapPaths = heatmapSelection?.entries === imageDir.entries ? heatmapSelection.paths : [];
  const filteredHeatmapPaths = visibleHeatmapPaths?.entries === imageDir.entries ? visibleHeatmapPaths.paths : null;
  const handleVisibleHeatmapPathsChange = useCallback((entries: ImageEntry[], paths: string[] | null) => {
    setVisibleHeatmapPaths((current) => {
      if (current?.entries === entries && current.paths === paths) return current;
      if (current?.entries === entries && current.paths && paths && current.paths.length === paths.length
        && current.paths.every((path, index) => path === paths[index])) return current;
      return { entries, paths };
    });
  }, []);

  const handleImageSearch = async () => {
    const query = imageSearchQuery.trim();
    if (!query) {
      setImageSearchError(null);
      return;
    }

    let pattern: RegExp;
    try {
      pattern = new RegExp(query, "i");
    } catch {
      setImageSearchError("正则表达式无效");
      return;
    }
    const matchIndex = imageDir.entries.findIndex((entry) => {
      const fileName = entry.jpg_path.split(/[\\/]/).filter(Boolean).pop() ?? entry.name;
      return pattern.test(entry.name) || pattern.test(fileName);
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
  const detailsShowButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterDetailsCollapseRef = useRef(false);
  const { transitioning: detailsTransitioning, motion: detailsMotion, collapse: collapseDetails, expand: expandDetails, onTransitionEnd: onDetailsTransitionEnd } = usePanelCollapseTransition();
  useLayoutEffect(() => {
    if (visual.table_collapsed && !detailsTransitioning && focusAfterDetailsCollapseRef.current) {
      focusAfterDetailsCollapseRef.current = false;
      detailsShowButtonRef.current?.focus();
    }
  }, [visual.table_collapsed, detailsTransitioning]);
  const hideDetailsPanel = useCallback(() => {
    const panel = detailsPanelRef.current;
    if (!panel) return;
    const size = panel.getSize();
    if (size >= DETAILS_MIN_SIZE) patchVis({ workspace_details_ratio: size });
    focusAfterDetailsCollapseRef.current = true;
    collapseDetails(() => panel.collapse());
  }, [collapseDetails, patchVis]);
  const setPreviewMode = useCallback((m: PreviewMode) => patchVis({ preview_mode: m }), [patchVis]);
  const handleNormalPreviewMode = useCallback((mode: PreviewMode) => {
    setPreviewMode(mode);
  }, [setPreviewMode]);
  const handleTonePreviewMode = useCallback((mode: PreviewMode) => {
    patchVis({ tone_preview_mode: mode === "param_map" ? "param_map" : "chart_map" });
  }, [patchVis]);
  const handleDetailsTabChange = useCallback((tab: DetailsTab) => {
    session.detailsTab = tab;
    setDetailsTab(tab);
  }, [session]);

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

  /* ── Table panel — wraps TablePane in standard padding. ── */
  const renderTablePanel = (onHide: () => void) => (
    <div className="h-full w-full min-w-0">
      <Suspense fallback={<PaneFallback label="正在加载图片列表..." />}>
        <TablePane
          onHide={onHide}
          schema={schema}
          toneMode={toneMode}
          filePath={filePath}
          cppImportRevision={cppImportRevision}
          calculatorSourcePath={calculatorSourcePath}
          entries={imageDir.entries}
          current={currentIndex}
          selectedHeatmapPaths={selectedHeatmapPaths}
          onSelectHeatmapImages={onSelectHeatmapImages}
          onVisibleHeatmapPathsChange={handleVisibleHeatmapPathsChange}
          imageDir={imageDir.dir}
          imageDataRevision={imageDataRevision}
          scrollPosition={session.imageDir === imageDir.dir
            && session.imageScrollPath === currentEntry?.jpg_path ? session.imageScroll : null}
          onScrollPositionChange={(position) => {
            session.imageScroll = position;
            session.imageScrollPath = currentEntry?.jpg_path ?? null;
            if (pairedWorkspaceKey && currentEntry?.jpg_path
              && useMtkStore.getState().imageSelection[pairedWorkspaceKey] === currentEntry.jpg_path) {
              syncPairedScroll(currentEntry.jpg_path, position);
            }
          }}
          exifParsing={exifParsing || imageDir.metadataPreparing}
          onParseExif={() => void handleParseExif()}
          onClearSidecars={(paths) => void handlePreviewSidecars(paths)}
          onNotice={onNotice}
          onPickImage={onPickImage}
          onImageDirChange={onImageDirChange}
          selectionSyncEnabled={selectionSyncEnabled}
          onSelectionSyncChange={(enabled) => {
            setSelectionSyncEnabled(enabled);
            if (enabled && currentEntry && pairedWorkspaceKey) {
              setImageSelection(pairedWorkspaceKey, currentEntry.jpg_path);
              syncPairedScroll(currentEntry.jpg_path, session.imageScroll, true);
            }
          }}
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
  const renderSourceCodePanel = (onHide: () => void) => (
    <div className="h-full w-full min-w-0">
      <Suspense fallback={<PaneFallback label="正在加载源代码卡片..." />}>
        <ImagePane
          onHide={onHide}
          key={`${filePath ?? ""}|${cppImportRevision}`}
          toneMode={toneMode}
          toneParsed={toneParsed}
          caLtmParsed={caLtmParsed}
          caLtmPath={caLtmPath}
          caLtmRevision={caLtmRevision}
          caLtmStatus={caLtmStatus}
          caLtmMessage={caLtmMessage}
          importRevision={cppImportRevision}
          mode={toneMode ? visual.tone_preview_mode ?? "chart_map"
            : visual.preview_mode === "param_map" ? "param_map" : "chart_map"}
          onMode={toneMode ? handleTonePreviewMode : handleNormalPreviewMode}
          filePath={filePath ?? ""}
          onCppPathChange={onCppPathChange}
          schema={schema}
          entry={currentEntry}
          entries={imageDir.entries}
          imageDataRevision={imageDataRevision}
          visibleHeatmapPaths={filteredHeatmapPaths}
          selectedHeatmapPaths={selectedHeatmapPaths}
          tomlData={selectedTomlData}
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
        {cleanupDialog}
        {metadataProgress}
        <WorkspaceColumns session={session} sourceSize={session.toneSourceSize}
          onSourceSizeChange={(size) => { session.toneSourceSize = size; }}
          dividerId={WORKSPACE_DIVIDER_ID}
          renderSource={renderSourceCodePanel}
          renderImages={(hide) => (
            <div ref={workspaceLeftRef} className="h-full w-full min-w-0">
              <PanelGroup direction="vertical" className="h-full w-full min-w-0">
                <Panel defaultSize={100 - session.toneLceSize} minSize={25} className="min-h-0 overflow-hidden">
                  {renderTablePanel(hide)}
                </Panel>
                <ResizeHandle direction="vertical" size={CARD_GAP_PX} />
                <Panel defaultSize={session.toneLceSize} minSize={25} className="min-h-0 overflow-hidden" onResize={(size) => {
                  if (Number.isFinite(size) && size >= 25 && size <= 75) session.toneLceSize = size;
                }}>
                  <DetailsPanel
                    toneMode
                    detailsTab={detailsTab}
                    onTabChange={handleDetailsTabChange}
                    session={session}
                    schema={schema}
                    tomlData={selectedTomlData}
                    tomlPath={currentEntry?.toml_path ?? null}
                    imageDataRevision={imageDataRevision}
                    filePath={filePath}
                    cppImportRevision={cppImportRevision}
                    sourceEditorBinding={detailsTab === "tone_cpp" ? sourceEditorBinding : null}
                  />
                </Panel>
              </PanelGroup>
            </div>
          )} />
      </div>
    );
  }

  return (
    <div ref={workspaceRootRef} className="flex h-full w-full min-w-0 flex-col">
    {cleanupDialog}
    {metadataProgress}
    <WorkspaceColumns session={session} sourceSize={sourceColumnSize}
      onSourceSizeChange={updateSourceColumnSize}
      dividerId={WORKSPACE_DIVIDER_ID}
      renderSource={renderSourceCodePanel}
      renderImages={(hide) => (
        <div ref={workspaceLeftRef} className="relative h-full w-full min-w-0">
          <PanelGroup direction="vertical" className="h-full w-full min-w-0">
            <Panel defaultSize={visual.table_collapsed ? 100 : 100 - detailsSize} minSize={30}
              className={detailsTransitioning ? "transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none" : undefined}>
              {renderTablePanel(hide)}
            </Panel>
            <ResizeHandle direction="vertical" size={visual.table_collapsed ? 0 : CARD_GAP_PX}
              className={`overflow-hidden ${detailsTransitioning ? "transition-[height] duration-300 ease-out motion-reduce:transition-none" : ""}`} />
            <Panel ref={detailsPanelRef} defaultSize={visual.table_collapsed ? 0 : detailsSize} minSize={DETAILS_MIN_SIZE}
              className={detailsTransitioning ? "transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none" : undefined}
              onTransitionEnd={onDetailsTransitionEnd}
              collapsible collapsedSize={0} onCollapse={() => patchVis({ table_collapsed: true })}
              onExpand={() => patchVis({ table_collapsed: false })}
              onResize={(size) => { if (size >= DETAILS_MIN_SIZE && Math.abs(size - detailsSize) > 0.05) patchVis({ workspace_details_ratio: size }); }}>
              {(!visual.table_collapsed || detailsTransitioning) && <div className="h-full w-full min-h-0" style={panelMotionStyle(detailsMotion, "bottom")}>
                <DetailsPanel
                toneMode={false}
                detailsTab={detailsTab}
                onTabChange={handleDetailsTabChange}
                onHide={hideDetailsPanel}
                session={session}
                schema={schema}
                tomlData={selectedTomlData}
                tomlPath={currentEntry?.toml_path ?? null}
                imageDataRevision={imageDataRevision}
                filePath={filePath}
                cppImportRevision={cppImportRevision}
                sourceEditorBinding={detailsTab === "bcompare" ? sourceEditorBinding : null}
                />
              </div>}
            </Panel>
          </PanelGroup>
          {visual.table_collapsed && (!detailsTransitioning || detailsMotion === "expanding") && <Button ref={detailsShowButtonRef} size="small" appearance="subtle"
            title="显示图片详情卡片" aria-label="显示图片详情卡片"
            onClick={() => expandDetails(() => detailsPanelRef.current?.expand(detailsSize))}
            icon={<PanelBottomExpand20Regular />}
            className="absolute bottom-1 left-1/2 z-20 -translate-x-1/2"
            style={{ width: 28, minWidth: 28, height: 28, padding: 0, border: "1px solid var(--colorNeutralStroke2)",
              borderRadius: 8, background: "var(--colorNeutralBackground1)", color: "var(--colorBrandForeground1)" }} />}
        </div>
      )} />
    </div>
  );

}

interface DetailsPanelProps {
  toneMode?: boolean;
  detailsTab: DetailsTab;
  onTabChange: (tab: DetailsTab) => void;
  onHide?: () => void;
  session: WorkspaceSession;
  schema: Isp6sSchemaRoot;
  tomlData: Record<string, string>;
  tomlPath: string | null;
  imageDataRevision: number;
  filePath: string | null;
  cppImportRevision: number;
  sourceEditorBinding: SourceEditorBinding | null;
}

/**
 * The detail sheet is deliberately isolated from the image list workspace.
 * Image scanning, progress updates and splitter movement should not cause a
 * large table subtree to render again when its input data has not changed.
 */
const DetailsPanel = memo(function DetailsPanel({
  toneMode,
  detailsTab,
  onTabChange,
  onHide,
  session,
  schema,
  tomlData,
  tomlPath,
  imageDataRevision,
  filePath,
  cppImportRevision,
  sourceEditorBinding,
}: DetailsPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // The panel is intentionally mounted only while expanded. Restoring here
  // makes a collapse/expand cycle restore the saved scroll position as soon as
  // the selected table has mounted, without keeping an observer alive while
  // the panel is hidden.
  useLayoutEffect(() => {
    const saved = session.detailsScroll[detailsTab];
    if (!saved || detailsTab === "bcompare" || detailsTab === "tone_cpp") return;
    const body = bodyRef.current;
    if (!body) return;
    let frame: number | null = null;
    let timeout: number | null = null;
    let finished = false;
    const restore = () => {
      const scroller = body.querySelector<HTMLElement>(".normal-sheet-viewport, [data-isp6s-details-scroll]");
      if (!scroller) return false;
      finished = true;
      frame = window.requestAnimationFrame(() => {
        scroller.scrollTop = saved.top;
        scroller.scrollLeft = saved.left;
      });
      return true;
    };
    const observer = new MutationObserver(() => {
      if (restore()) observer.disconnect();
    });
    if (!restore()) {
      observer.observe(body, { childList: true, subtree: true });
      timeout = window.setTimeout(() => {
        if (!finished) observer.disconnect();
      }, 3000);
    }
    return () => {
      observer.disconnect();
      if (timeout !== null) window.clearTimeout(timeout);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [detailsTab, session, schema]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden"
         style={{ background: "var(--colorNeutralBackground1)", border: "1px solid var(--colorNeutralStroke2)", borderRadius: detailsTab === "bcompare" || detailsTab === "tone_cpp" ? 8 : "8px 8px 0 0" }}>
      <div className="flex h-8 shrink-0 items-stretch px-2"
           style={{ background: "var(--colorNeutralBackground2)", borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
        {(toneMode ? TONE_DETAILS_TABS : AE_DETAILS_TABS).map((tab) => {
          const active = detailsTab === tab.id;
          return <button key={tab.id} type="button" role="tab" aria-selected={active}
            onClick={() => onTabChange(tab.id)}
            className="px-3 text-xs transition-colors"
            style={{ color: active ? "var(--colorNeutralForeground1)" : "var(--colorNeutralForeground3)", background: active ? "var(--colorNeutralBackground1)" : "transparent", border: 0, borderBottom: active ? "2px solid var(--colorBrandStroke1)" : "2px solid transparent", fontWeight: active ? 600 : 400 }}>
            {tab.label}
          </button>;
        })}
        {onHide && <div className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center">
          <WorkspaceHideButton side="details" onHide={onHide} />
        </div>}
      </div>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-hidden"
           onScrollCapture={(event) => {
             const target = event.target;
             if (target instanceof HTMLElement && target !== bodyRef.current) {
               session.detailsScroll[detailsTab] = { top: target.scrollTop, left: target.scrollLeft };
             }
           }}>
        {detailsTab === "normal" && <NormalTable tomlData={tomlData} />}
        {detailsTab === "face" && <FaceTable tomlData={tomlData} />}
        {detailsTab === "lce" && <LceTab schema={schema} tomlData={tomlData} />}
        {detailsTab === "exif" && <ExifTable tomlPath={tomlPath} revision={imageDataRevision} />}
        {(toneMode ? detailsTab === "tone_cpp" : detailsTab === "bcompare") && <ParaCheckMode filePath={filePath ?? ""} schema={schema} tomlData={tomlData}
          toneMode={toneMode}
          sourceEditor={sourceEditorBinding?.filePath === filePath && sourceEditorBinding.importRevision === cppImportRevision ? sourceEditorBinding : null} />}
      </div>
    </div>
  );
});

function PaneFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs"
         style={{ color: "var(--colorNeutralForeground3)" }}>
      {label}
    </div>
  );
}
