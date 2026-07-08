import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Button } from "@fluentui/react-components";
import {
  ChevronDown24Regular,
  ChevronUp24Regular,
  Copy24Regular,
} from "@fluentui/react-icons";

import { HoverTooltip } from "@/components/common/HoverTooltip";
import { cppGetFieldsByLine } from "@/ipc/cppParser";

interface Props {
  draft: SourceCodeDraft | null;
  resolveFilePath?: string;
  loadError?: string | null;
  /** Highlight ranges (1-indexed inclusive). */
  ranges?: Array<[number, number]>;
  /** Line to scroll to (1-indexed). */
  jumpLine?: number;
  jumpKey?: number;
  onTextChange: (text: string) => void;
  onPreviewChart?: (targetLabel?: string) => void;
  chartJumpLabel?: string;
  rangeGroups?: SourceRangeGroup[];
}

export interface SourceRangeGroup {
  id: string;
  label: string;
  paths: string[];
  chartTargetLabel?: string;
}

interface SourceArea {
  id: string;
  label: string;
  chartTargetLabel?: string;
  rangeIndices: number[];
}

export interface SourceCodeDraft {
  filePath: string;
  text: string;
  savedText: string;
  initialText: string;
  lineEnding: "\n" | "\r\n";
  version: number;
  loadVersion: number;
}

export function normalizeSourceText(rawText: string): Pick<SourceCodeDraft, "text" | "lineEnding"> {
  const lineEnding = rawText.includes("\r\n") ? "\r\n" : "\n";
  return {
    text: rawText.replace(/\r\n/g, "\n"),
    lineEnding,
  };
}

export function serializeSourceText(draft: Pick<SourceCodeDraft, "text" | "lineEnding">): string {
  return draft.text.replace(/\n/g, draft.lineEnding);
}

export function sourceDraftDirty(draft: SourceCodeDraft | null): boolean {
  return Boolean(draft && draft.text !== draft.savedText);
}

export function sourceDraftCanRestore(draft: SourceCodeDraft | null): boolean {
  return Boolean(draft && draft.text !== draft.initialText);
}

export function SourceCodeView({
  draft,
  resolveFilePath,
  loadError,
  ranges,
  jumpLine,
  jumpKey,
  onTextChange,
  onPreviewChart,
  chartJumpLabel,
  rangeGroups,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const [scrollFrame, setScrollFrame] = useState({ top: 0, height: 0 });
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [activeLinePaths, setActiveLinePaths] = useState<string[]>([]);
  const [rangeStartPaths, setRangeStartPaths] = useState<string[][]>([]);
  const [pathCopied, setPathCopied] = useState(false);

  const parserPath = resolveFilePath ?? draft?.filePath;
  const text = draft?.text ?? "";
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const lineCount = Math.max(1, lines.length);
  const editorHeight = lineCount * LINE_H;
  const codeWidth = useMemo(() => {
    const maxLen = lines.reduce((max, line) => Math.max(max, line.length), 0);
    return Math.max(900, maxLen * 7 + 32);
  }, [lines]);

  const highlightRanges = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (const [a, b] of ranges ?? []) {
      const start = clampNumber(Math.min(a, b), 1, lineCount);
      const end = clampNumber(Math.max(a, b), 1, lineCount);
      if (start <= end) out.push([start, end]);
    }
    return out.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  }, [lineCount, ranges]);
  const highlightRangeKey = useMemo(
    () => highlightRanges.map(([start, end]) => `${start}-${end}`).join("|"),
    [highlightRanges],
  );

  const hiSet = useMemo(() => {
    const result = new Set<number>();
    for (const [a, b] of highlightRanges) {
      for (let i = a; i <= b; i += 1) result.add(i);
    }
    return result;
  }, [highlightRanges]);
  const highlightedLines = useMemo(
    () => Array.from(hiSet).filter((lineNo) => lineNo >= 1 && lineNo <= lineCount),
    [hiSet, lineCount],
  );
  const activeRangeIndex = useMemo(() => {
    if (!activeLine) return -1;
    return highlightRanges.findIndex(([start, end]) => activeLine >= start && activeLine <= end);
  }, [activeLine, highlightRanges]);
  const sourceAreas = useMemo(
    () => buildSourceAreas(highlightRanges, rangeStartPaths, rangeGroups, chartJumpLabel),
    [chartJumpLabel, highlightRanges, rangeGroups, rangeStartPaths],
  );
  const activeAreaIndex = useMemo(() => {
    if (activeRangeIndex < 0) return -1;
    return sourceAreas.findIndex((area) => area.rangeIndices.includes(activeRangeIndex));
  }, [activeRangeIndex, sourceAreas]);
  const activeArea = activeAreaIndex >= 0 ? sourceAreas[activeAreaIndex] : null;
  const sourceAreaButtonPlacements = useMemo(
    () => sourceAreas
      .map((area) => ({
        area,
        top: sourceAreaButtonTop(area, highlightRanges, scrollFrame),
      }))
      .filter((item): item is { area: SourceArea; top: number } => item.top !== null),
    [highlightRanges, scrollFrame, sourceAreas],
  );
  const activeLinePathText = useMemo(() => activeLinePaths.join(", "), [activeLinePaths]);
  const activeLinePathSummary = useMemo(() => {
    if (activeLinePaths.length <= 1) return activeLinePaths[0] ?? "";
    return `${activeLinePaths[0]}  +${activeLinePaths.length - 1}`;
  }, [activeLinePaths]);
  const activePathTop = useMemo(() => {
    if (!activeLine || activeLinePaths.length === 0) return null;
    if (activeArea) {
      const areaTop = sourceAreaTop(activeArea, highlightRanges, scrollFrame);
      if (areaTop !== null) {
        return clampNumber(areaTop - LINE_PATH_BADGE_H - 8, 8, Math.max(8, scrollFrame.height - LINE_PATH_BADGE_H - 8));
      }
    }

    const lineViewportTop = (activeLine - 1) * LINE_H - scrollFrame.top;
    if (scrollFrame.height > 0 && (lineViewportTop < -LINE_H || lineViewportTop > scrollFrame.height)) return null;
    const rawTop = lineViewportTop - LINE_PATH_BADGE_H - 8;
    if (scrollFrame.height <= 0) return Math.max(0, rawTop);
    return clampNumber(rawTop, 8, Math.max(8, scrollFrame.height - LINE_PATH_BADGE_H - 8));
  }, [activeArea, activeLine, activeLinePaths.length, highlightRanges, scrollFrame]);

  const syncActiveLineFromTextarea = (nextText = text, selectionStart = textareaRef.current?.selectionStart ?? 0) => {
    const maxLine = Math.max(1, lineNumberFromOffset(nextText, nextText.length));
    const nextLine = clampNumber(lineNumberFromOffset(nextText, selectionStart), 1, maxLine);
    setActiveLine((current) => current === nextLine ? current : nextLine);
  };

  const jumpToLine = (line: number) => {
    const nextLine = clampNumber(line, 1, lineCount);
    scrollerRef.current?.scrollTo({ top: Math.max(0, (nextLine - 6) * LINE_H), behavior: "auto" });
    setActiveLine(nextLine);
  };

  const jumpToRange = (index: number) => {
    const range = highlightRanges[index];
    if (!range) return;
    jumpToLine(range[0]);
  };

  const jumpToArea = (index: number) => {
    const area = sourceAreas[index];
    if (!area) return;
    jumpToRange(area.rangeIndices[0]);
  };

  const copyActiveLinePaths = async () => {
    if (!activeLinePathText) return;
    try {
      await navigator.clipboard.writeText(activeLinePathText);
      setPathCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setPathCopied(false);
        copyTimerRef.current = null;
      }, 1200);
    } catch (error) {
      console.warn("copy source line paths failed", error);
    }
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => {
      setScrollFrame((current) => {
        const next = { top: scroller.scrollTop, height: scroller.clientHeight };
        return current.top === next.top && current.height === next.height ? current : next;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!parserPath || highlightRanges.length === 0) {
      setRangeStartPaths([]);
      return;
    }

    let cancelled = false;
    Promise.all(
      highlightRanges.map(async ([start]) => {
        try {
          const fields = await cppGetFieldsByLine(parserPath, start);
          return uniqueFieldPaths(fields.map((field) => field.path));
        } catch (error) {
          console.warn("load source range paths failed", error);
          return [];
        }
      }),
    ).then((next) => {
      if (!cancelled) setRangeStartPaths(next);
    });
    return () => {
      cancelled = true;
    };
  }, [highlightRangeKey, highlightRanges, parserPath]);

  useLayoutEffect(() => {
    if (!jumpLine || !scrollerRef.current) return;
    const top = (jumpLine - 6) * LINE_H;
    scrollerRef.current.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  }, [jumpLine, jumpKey, draft?.loadVersion]);

  useEffect(() => {
    if (!jumpLine) return;
    setActiveLine(clampNumber(jumpLine, 1, lineCount));
  }, [jumpLine, jumpKey, lineCount]);

  useEffect(() => {
    if (!parserPath || !activeLine) {
      setActiveLinePaths([]);
      return;
    }

    let cancelled = false;
    cppGetFieldsByLine(parserPath, activeLine)
      .then((fields) => {
        if (cancelled) return;
        setActiveLinePaths(uniqueFieldPaths(fields.map((field) => field.path)));
        setPathCopied(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("load source line paths failed", error);
        setActiveLinePaths([]);
        setPathCopied(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLine, draft?.filePath, resolveFilePath]);

  if (loadError) {
    return (
      <div
        className="m-3 rounded-md border p-3 text-xs"
        style={{
          background: "var(--colorPaletteRedBackground1)",
          borderColor: "var(--colorPaletteRedBorder1)",
          color: "var(--colorPaletteRedForeground1)",
        }}
      >
        加载源文件失败：{loadError}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={scrollerRef}
        className="h-full w-full overflow-auto"
        style={sourceScrollerStyle}
        onScroll={(event) => {
          const target = event.currentTarget;
          setScrollFrame((current) => {
            const next = { top: target.scrollTop, height: target.clientHeight };
            return current.top === next.top && current.height === next.height ? current : next;
          });
        }}
      >
        <div style={{ display: "flex", width: "max-content", minHeight: "100%" }}>
          <div style={{ ...sourceGutterStyle, height: editorHeight }}>
            {lines.map((_, index) => {
              const lineNo = index + 1;
              const highlighted = hiSet.has(lineNo);
              return (
                <div
                  key={lineNo}
                  style={{
                    ...sourceGutterLineStyle,
                    background: highlighted ? SOURCE_HIGHLIGHT_BACKGROUND : "transparent",
                  }}
                >
                  {lineNo}
                </div>
              );
            })}
          </div>
          <div style={{ ...sourceEditorWrapStyle, width: codeWidth, height: editorHeight }}>
            {highlightedLines.map((lineNo) => (
              <div
                key={lineNo}
                style={{
                  ...sourceHighlightLineStyle,
                  top: (lineNo - 1) * LINE_H,
                }}
              />
            ))}
            <textarea
              ref={textareaRef}
              aria-label="Source editor"
              spellCheck={false}
              wrap="off"
              value={text}
              onFocus={() => syncActiveLineFromTextarea()}
              onClick={() => syncActiveLineFromTextarea()}
              onKeyUp={() => syncActiveLineFromTextarea()}
              onSelect={() => syncActiveLineFromTextarea()}
              onMouseUp={() => syncActiveLineFromTextarea()}
              onChange={(event) => {
                onTextChange(event.target.value);
                syncActiveLineFromTextarea(event.target.value, event.target.selectionStart);
              }}
              style={{ ...sourceTextareaStyle, width: codeWidth, height: editorHeight }}
            />
          </div>
        </div>
      </div>
      {activePathTop !== null && activeLinePathText && (
        <div style={{ ...linePathBadgeWrapStyle, top: activePathTop }}>
          <div style={linePathBadgeStyle}>
            <span style={linePathLabelStyle}>paths</span>
            <div style={linePathTextWrapStyle}>
              <HoverTooltip
                content={`Line ${activeLine ?? "-"} paths: ${activeLinePathText}`}
                positioning="below-center"
                wrap
                maxWidth={520}
                inline
              >
                <span style={linePathTextStyle}>{activeLinePathSummary}</span>
              </HoverTooltip>
            </div>
            <div style={linePathActionsStyle}>
              <HoverTooltip content={pathCopied ? "已复制当前行 paths" : "复制当前行 paths"} positioning="below-center" inline>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Copy24Regular />}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={copyActiveLinePaths}
                  aria-label={pathCopied ? "已复制当前行 paths" : "复制当前行 paths"}
                  style={linePathActionButtonStyle(pathCopied)}
                />
              </HoverTooltip>
              {sourceAreas.length > 1 && activeAreaIndex >= 0 && (
                <div style={linePathRegionNavStyle} aria-label="源码区域跳转">
                  <span style={linePathSeparatorStyle} aria-hidden />
                  <span style={linePathRegionTextStyle}>{activeAreaIndex + 1}/{sourceAreas.length}</span>
                  <HoverTooltip content="跳转到上一个源码区域" positioning="below-center" inline>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<ChevronUp24Regular />}
                      disabled={activeAreaIndex <= 0}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => jumpToArea(activeAreaIndex - 1)}
                      aria-label="跳转到上一个源码区域"
                      style={linePathActionButtonStyle(false)}
                    />
                  </HoverTooltip>
                  <HoverTooltip content="跳转到下一个源码区域" positioning="below-center" inline>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<ChevronDown24Regular />}
                      disabled={activeAreaIndex >= sourceAreas.length - 1}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => jumpToArea(activeAreaIndex + 1)}
                      aria-label="跳转到下一个源码区域"
                      style={linePathActionButtonStyle(false)}
                    />
                  </HoverTooltip>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {onPreviewChart && sourceAreaButtonPlacements.map(({ area, top }) => (
        <div key={area.id} style={{ ...highlightCardJumpWrapStyle, top }}>
          <HoverTooltip
            content={`跳转到 ${area.label} 图表区域`}
            positioning="below-center"
            inline
          >
            <Button
              size="small"
              appearance="subtle"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPreviewChart(area.chartTargetLabel)}
              aria-label={`跳转到 ${area.label} 图表区域`}
              style={highlightCardJumpButtonStyle}
            >
              {area.label}
            </Button>
          </HoverTooltip>
        </div>
      ))}
    </div>
  );
}

const LINE_H = 18;
const LINE_PATH_BADGE_H = 30;
const CARD_JUMP_BUTTON_H = 30;
const SOURCE_AREA_BUTTON_COLUMN_W = 172;
const SOURCE_HIGHLIGHT_BACKGROUND = "color-mix(in srgb, var(--colorBrandBackground2) 46%, transparent)";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lineNumberFromOffset(text: string, offset: number): number {
  const safeOffset = clampNumber(offset, 0, text.length);
  let line = 1;
  for (let index = 0; index < safeOffset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function uniqueFieldPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

function buildSourceAreas(
  ranges: Array<[number, number]>,
  rangePaths: string[][],
  groups: SourceRangeGroup[] | undefined,
  fallbackLabel: string | undefined,
): SourceArea[] {
  const areas: SourceArea[] = [];
  const areaById = new Map<string, SourceArea>();
  const hasGroups = Boolean(groups?.length);
  if (hasGroups && rangePaths.length < ranges.length) return areas;

  ranges.forEach((_, rangeIndex) => {
    const group = hasGroups ? findRangeGroup(rangePaths[rangeIndex] ?? [], groups ?? []) : null;
    const id = group?.id ?? `range-${rangeIndex}`;
    const label = group?.label ?? fallbackLabel ?? `区域 ${rangeIndex + 1}`;
    const chartTargetLabel = group?.chartTargetLabel ?? fallbackLabel;

    let area = areaById.get(id);
    if (!area) {
      area = { id, label, chartTargetLabel, rangeIndices: [] };
      areaById.set(id, area);
      areas.push(area);
    }
    area.rangeIndices.push(rangeIndex);
  });

  return areas;
}

function sourceAreaButtonTop(
  area: SourceArea,
  ranges: Array<[number, number]>,
  scrollFrame: { top: number; height: number },
): number | null {
  if (scrollFrame.height <= 0) return null;

  let visibleTop: number | null = null;
  let visibleBottom: number | null = null;
  for (const rangeIndex of area.rangeIndices) {
    const range = ranges[rangeIndex];
    if (!range) continue;
    const [start, end] = range;
    const top = (start - 1) * LINE_H - scrollFrame.top;
    const bottom = end * LINE_H - scrollFrame.top;
    if (bottom < 0 || top > scrollFrame.height) continue;
    const rangeTop = clampNumber(top, 0, scrollFrame.height);
    const rangeBottom = clampNumber(bottom, 0, scrollFrame.height);
    visibleTop = visibleTop === null ? rangeTop : Math.min(visibleTop, rangeTop);
    visibleBottom = visibleBottom === null ? rangeBottom : Math.max(visibleBottom, rangeBottom);
  }

  if (visibleTop === null || visibleBottom === null) return null;
  const rawTop = (visibleTop + visibleBottom - CARD_JUMP_BUTTON_H) / 2;
  return clampNumber(rawTop, 8, Math.max(8, scrollFrame.height - CARD_JUMP_BUTTON_H - 8));
}

function sourceAreaTop(
  area: SourceArea,
  ranges: Array<[number, number]>,
  scrollFrame: { top: number; height: number },
): number | null {
  if (scrollFrame.height <= 0) return null;

  let topMost: number | null = null;
  for (const rangeIndex of area.rangeIndices) {
    const range = ranges[rangeIndex];
    if (!range) continue;
    const [start, end] = range;
    const top = (start - 1) * LINE_H - scrollFrame.top;
    const bottom = end * LINE_H - scrollFrame.top;
    if (bottom < 0 || top > scrollFrame.height) continue;
    const visibleTop = clampNumber(top, 0, scrollFrame.height);
    topMost = topMost === null ? visibleTop : Math.min(topMost, visibleTop);
  }
  return topMost;
}

function findRangeGroup(paths: string[], groups: SourceRangeGroup[]): SourceRangeGroup | null {
  for (const group of groups) {
    if (group.paths.some((prefix) => paths.some((path) => pathMatchesPrefix(path, prefix)))) {
      return group;
    }
  }
  return null;
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

const sourceScrollerStyle: CSSProperties = {
  background: "var(--colorNeutralBackground1)",
  color: "var(--colorNeutralForeground1)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
  lineHeight: `${LINE_H}px`,
};

const sourceGutterStyle: CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 2,
  flex: "0 0 56px",
  background: "var(--colorNeutralBackground1)",
  borderRight: "1px solid var(--colorNeutralStroke2)",
  userSelect: "none",
};

const sourceGutterLineStyle: CSSProperties = {
  height: LINE_H,
  paddingRight: 8,
  textAlign: "right",
  color: "var(--colorNeutralForeground4)",
};

const sourceEditorWrapStyle: CSSProperties = {
  position: "relative",
  flex: "0 0 auto",
  minWidth: 0,
};

const sourceHighlightLineStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  height: LINE_H,
  background: SOURCE_HIGHLIGHT_BACKGROUND,
  pointerEvents: "none",
};

const sourceTextareaStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "block",
  minWidth: 900,
  margin: 0,
  padding: "0 8px",
  border: "none",
  outline: "none",
  resize: "none",
  overflow: "hidden",
  whiteSpace: "pre",
  background: "transparent",
  color: "var(--colorNeutralForeground1)",
  font: "inherit",
  lineHeight: `${LINE_H}px`,
};

const linePathBadgeWrapStyle: CSSProperties = {
  position: "absolute",
  right: SOURCE_AREA_BUTTON_COLUMN_W + 28,
  zIndex: 8,
  maxWidth: `min(760px, calc(100% - ${SOURCE_AREA_BUTTON_COLUMN_W + 108}px))`,
  pointerEvents: "auto",
};

const linePathBadgeStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "max-content minmax(72px, 1fr) max-content",
  alignItems: "center",
  gap: 7,
  height: LINE_PATH_BADGE_H,
  maxWidth: "100%",
  padding: "0 4px 0 9px",
  border: "1px solid color-mix(in srgb, var(--colorBrandStroke1) 62%, var(--colorNeutralStroke2))",
  borderRadius: 9,
  background: "color-mix(in srgb, var(--colorNeutralBackground1) 90%, var(--colorBrandBackground2))",
  color: "var(--colorNeutralForeground1)",
  boxShadow: "0 8px 22px color-mix(in srgb, var(--colorNeutralForeground1) 16%, transparent)",
  backdropFilter: "blur(10px)",
};

const linePathLabelStyle: CSSProperties = {
  color: "var(--colorBrandForeground1)",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.2,
};

const linePathTextWrapStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
};

const linePathTextStyle: CSSProperties = {
  display: "block",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--colorNeutralForeground2)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 11,
  fontWeight: 700,
};

const linePathActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
};

const linePathRegionNavStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
};

const linePathSeparatorStyle: CSSProperties = {
  width: 1,
  height: 16,
  margin: "0 4px",
  background: "var(--colorNeutralStroke2)",
};

const linePathRegionTextStyle: CSSProperties = {
  minWidth: 34,
  textAlign: "center",
  color: "var(--colorNeutralForeground2)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 11,
  fontWeight: 800,
};

const highlightCardJumpWrapStyle: CSSProperties = {
  position: "absolute",
  right: 16,
  zIndex: 7,
  pointerEvents: "auto",
};

const highlightCardJumpButtonStyle: CSSProperties = {
  width: "auto",
  minWidth: 0,
  maxWidth: SOURCE_AREA_BUTTON_COLUMN_W,
  height: CARD_JUMP_BUTTON_H,
  padding: "0 10px",
  color: "var(--colorBrandForeground1)",
  border: "1px solid color-mix(in srgb, var(--colorBrandStroke1) 60%, var(--colorNeutralStroke2))",
  borderRadius: 8,
  background: "color-mix(in srgb, var(--colorNeutralBackground1) 88%, var(--colorBrandBackground2))",
  boxShadow: "0 8px 20px color-mix(in srgb, var(--colorNeutralForeground1) 14%, transparent)",
  fontSize: 12,
  fontWeight: 800,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function linePathActionButtonStyle(active: boolean): CSSProperties {
  return {
    width: 26,
    minWidth: 26,
    height: 24,
    color: active ? "var(--colorPaletteGreenForeground1)" : "var(--colorBrandForeground1)",
    borderRadius: 7,
    transition: "color 120ms ease, background-color 120ms ease, transform 90ms ease-out",
  };
}
