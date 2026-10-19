import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eye20Regular, EyeOff20Regular, Search24Regular } from "@fluentui/react-icons";
import { loadImageTomlSections, type ImageTomlSection } from "@/ipc/imageScan";

const ROW_HEIGHT = 38;
const OVERSCAN = 8;
const EXIF_HEADER_BACKGROUND = "color-mix(in srgb, var(--colorBrandBackground2) 16%, var(--colorNeutralBackground1))";
const EXIF_KEY_BACKGROUND = "color-mix(in srgb, var(--colorNeutralBackground2) 45%, var(--colorNeutralBackground1))";
const EXIF_SELECTED_BACKGROUND = "color-mix(in srgb, var(--colorBrandBackground2) 45%, var(--colorNeutralBackground1))";

export function ExifTable({ tomlPath }: { tomlPath: string | null }) {
  const [loaded, setLoaded] = useState<{ path: string; sections: ImageTomlSection[]; error: string | null } | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [query, setQuery] = useState("");
  const [keyColumnRatio, setKeyColumnRatio] = useState(50);
  const [showHeader, setShowHeader] = useState(true);

  useEffect(() => {
    if (!tomlPath) return;
    let cancelled = false;
    loadImageTomlSections(tomlPath).then(
      (sections) => { if (!cancelled) setLoaded({ path: tomlPath, sections, error: null }); },
      (error) => {
        if (!cancelled) setLoaded({ path: tomlPath, sections: [], error: String(error) });
      },
    );
    return () => { cancelled = true; };
  }, [tomlPath]);

  const search = useMemo(() => {
    const needle = query.trim();
    if (!needle) return { needle, pattern: null, error: null };
    try {
      return { needle, pattern: new RegExp(needle, "i"), error: null };
    } catch (error) {
      return { needle, pattern: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [query]);

  const sections = loaded?.path === tomlPath ? loaded.sections : [];
  const matchingSections = useMemo(() => {
    if (search.error) return [];
    if (!search.needle) return sections;
    return sections.map((section) => ({
      ...section,
      fields: section.fields.filter(({ key }) => search.pattern?.test(key)),
    })).filter((section) => section.fields.length > 0);
  }, [search, sections]);
  const selected = matchingSections.find((section) => section.name === selectedName) ?? matchingSections[0];
  const loading = Boolean(tomlPath) && loaded?.path !== tomlPath;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col" style={{ background: "var(--colorNeutralBackground1)" }}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2"
        style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground1)" }}>
        <Search24Regular className="h-4 w-4 shrink-0" aria-hidden="true"
          style={{ color: "var(--colorNeutralForeground3)" }} />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索 KEY" aria-label="搜索 EXIF 关键字" maxLength={200}
          aria-invalid={Boolean(search.error)}
          className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
          style={{ color: "var(--colorNeutralForeground2)", caretColor: "var(--colorBrandForeground1)" }} />
      </div>
      <div className="flex h-9 shrink-0 items-stretch border-b px-2"
        style={{ borderColor: "var(--colorNeutralStroke2)", background: EXIF_HEADER_BACKGROUND }}>
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto" role="tablist" aria-label="EXIF 分组">
          {matchingSections.map((section) => (
            <button key={section.name} type="button" role="tab" aria-selected={section === selected}
              onClick={() => setSelectedName(section.name)}
              className="shrink-0 border-b-2 px-3 text-xs transition-colors hover:bg-[var(--colorNeutralBackground2)]"
              style={{ borderColor: section === selected ? "var(--colorBrandStroke1)" : "transparent",
                color: section === selected ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground2)",
                fontWeight: section === selected ? 600 : 400 }}>
              {section.name}
            </button>
          ))}
        </div>
        <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
          aria-label={showHeader ? "隐藏 KEY 和 VALUE 表头" : "显示 KEY 和 VALUE 表头"}
          title={showHeader ? "隐藏 KEY 和 VALUE 表头" : "显示 KEY 和 VALUE 表头"}
          aria-pressed={showHeader} onClick={() => setShowHeader((value) => !value)}
          style={{ color: "var(--colorNeutralForeground2)", background: "transparent" }}>
          {showHeader ? <Eye20Regular aria-hidden="true" /> : <EyeOff20Regular aria-hidden="true" />}
        </button>
      </div>
      {selected ? <ExifRows key={`${tomlPath}:${selected.name}:${query}`} fields={selected.fields}
          keyColumnRatio={keyColumnRatio} onKeyColumnRatioChange={setKeyColumnRatio} showHeader={showHeader} />
        : <div className="flex min-h-0 flex-1 items-center justify-center px-3 text-xs"
            role={search.error || loaded?.error ? "alert" : undefined}
            style={{ color: search.error || loaded?.error ? "var(--colorPaletteRedForeground1)" : "var(--colorNeutralForeground3)" }}>
            {search.error ? `正则表达式无效：${search.error}`
              : !tomlPath ? "请选择图片" : loading ? "正在读取 EXIF..."
                : loaded?.error ? "无法读取同名 TOML 文件" : search.needle ? "没有匹配的关键字" : "TOML 中没有可显示的字段"}
          </div>}
    </div>
  );
}

function ExifRows({
  fields,
  keyColumnRatio,
  onKeyColumnRatioChange,
  showHeader,
}: {
  fields: ImageTomlSection["fields"];
  keyColumnRatio: number;
  onKeyColumnRatioChange: (value: number) => void;
  showHeader: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [firstVisible, setFirstVisible] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ row: number; column: "key" | "value" } | null>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const columns = `${keyColumnRatio}% ${100 - keyColumnRatio}%`;

  const dragRef = useRef<{ startX: number; startRatio: number } | null>(null);
  const startColumnResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startRatio: keyColumnRatio };
  };
  const moveColumnResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    const width = (event.currentTarget.parentElement?.clientWidth ?? 0) - scrollbarWidth;
    if (!drag || width <= 0) return;
    const ratio = drag.startRatio + ((event.clientX - drag.startX) / width) * 100;
    onKeyColumnRatioChange(Math.min(75, Math.max(25, ratio)));
  };

  const selectCell = (cell: HTMLDivElement, row: number, column: "key" | "value") => {
    setSelectedCell({ row, column });
    cell.focus({ preventScroll: true });
    const content = cell.querySelector("span");
    if (!content) return;
    const range = document.createRange();
    range.selectNodeContents(content);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) {
      setScrollbarWidth((width) => width === 0 ? width : 0);
      return;
    }
    const update = () => {
      setViewportHeight((height) => height === viewport.clientHeight ? height : viewport.clientHeight);
      const nextScrollbarWidth = Math.max(0, viewport.offsetWidth - viewport.clientWidth);
      setScrollbarWidth((width) => width === nextScrollbarWidth ? width : nextScrollbarWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, firstVisible - OVERSCAN);
  const end = Math.min(fields.length, firstVisible + Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN);
  return (
    <div className="flex min-h-0 flex-1 flex-col" role="table" aria-label="EXIF 键值">
      {showHeader && <div className="grid h-8 shrink-0 border-b text-xs font-semibold" role="row"
        style={{ gridTemplateColumns: columns, borderColor: "var(--colorNeutralStroke2)", background: EXIF_HEADER_BACKGROUND,
          color: "var(--colorNeutralForeground2)", boxSizing: "border-box", paddingRight: scrollbarWidth, position: "relative" }}>
        <div className="flex items-center justify-center border-r" role="columnheader" style={{ borderColor: "var(--colorNeutralStroke2)" }}>KEY</div>
        <div className="flex items-center justify-center" role="columnheader">VALUE</div>
        <span role="separator" aria-orientation="vertical" aria-label="调整 KEY 和 VALUE 列宽"
          aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(keyColumnRatio)} tabIndex={0}
          onPointerDown={startColumnResize} onPointerMove={moveColumnResize}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            onKeyColumnRatioChange(Math.min(75, Math.max(25, keyColumnRatio + (event.key === "ArrowRight" ? 2 : -2))));
          }}
          style={{ position: "absolute", top: 0, bottom: 0,
            left: `calc((100% - ${scrollbarWidth}px) * ${keyColumnRatio / 100} - 3px)`, width: 7,
            cursor: "col-resize", touchAction: "none", zIndex: 2 }} />
      </div>}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" data-isp6s-details-scroll="true"
        onScroll={(event) => {
          const next = Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT);
          setFirstVisible((current) => current === next ? current : next);
        }}>
        <div style={{ height: fields.length * ROW_HEIGHT, position: "relative" }} role="rowgroup">
          {fields.slice(start, end).map((field, offset) => {
            const row = start + offset;
            return <div key={`${row}:${field.key}`} className="absolute left-0 grid w-full border-b text-xs" role="row"
              aria-rowindex={row + (showHeader ? 2 : 1)}
              style={{ top: (start + offset) * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: columns,
                borderColor: "var(--colorNeutralStroke2)", color: "var(--colorNeutralForeground1)" }}>
              <div className="flex min-w-0 items-center border-r px-2 font-semibold outline-none" role="cell"
                tabIndex={0} aria-selected={selectedCell?.row === row && selectedCell.column === "key"}
                onClick={(event) => selectCell(event.currentTarget, row, "key")}
                onKeyDown={(event) => { if (event.key === "Enter") selectCell(event.currentTarget, row, "key"); }}
                onCopy={(event) => { event.clipboardData.setData("text/plain", field.key); event.preventDefault(); }}
                style={{ borderColor: "var(--colorNeutralStroke2)", cursor: "text",
                  background: selectedCell?.row === row && selectedCell.column === "key" ? EXIF_SELECTED_BACKGROUND
                    : row % 2 === 0 ? "var(--colorNeutralBackground1)" : EXIF_KEY_BACKGROUND,
                  boxShadow: selectedCell?.row === row && selectedCell.column === "key" ? "inset 3px 0 0 var(--colorBrandStroke1)" : undefined }}>
                <span className="block w-full min-w-0 overflow-hidden" title={field.key}
                  data-tooltip-position="below-start" data-tooltip-wrap="true" data-tooltip-truncated="true"
                  style={{ lineHeight: "16px", maxHeight: 32, overflowWrap: "anywhere" }}>{field.key}</span>
              </div>
              <div className="flex min-w-0 items-center px-2 outline-none" role="cell"
                tabIndex={0} aria-selected={selectedCell?.row === row && selectedCell.column === "value"}
                onClick={(event) => selectCell(event.currentTarget, row, "value")}
                onKeyDown={(event) => { if (event.key === "Enter") selectCell(event.currentTarget, row, "value"); }}
                onCopy={(event) => { event.clipboardData.setData("text/plain", field.value); event.preventDefault(); }}
                style={{ cursor: "text",
                  background: selectedCell?.row === row && selectedCell.column === "value" ? EXIF_SELECTED_BACKGROUND
                    : row % 2 === 0 ? "var(--colorNeutralBackground1)" : EXIF_KEY_BACKGROUND,
                  boxShadow: selectedCell?.row === row && selectedCell.column === "value" ? "inset 3px 0 0 var(--colorBrandStroke1)" : undefined }}>
                <span className="block w-full min-w-0 truncate" title={field.value} data-tooltip-position="below-start" data-tooltip-wrap="true"
                  data-tooltip-truncated="true">{field.value}</span>
              </div>
            </div>;
          })}
        </div>
      </div>
    </div>
  );
}
