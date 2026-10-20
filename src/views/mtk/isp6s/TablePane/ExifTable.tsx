import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown20Regular, Dismiss20Regular, Heart20Filled, Heart20Regular, Search24Regular } from "@fluentui/react-icons";
import { loadImageTomlSections, type ImageTomlSection } from "@/ipc/imageScan";

const ROW_HEIGHT = 38;
const OVERSCAN = 8;
const EXIF_HEADER_BACKGROUND = "color-mix(in srgb, var(--colorBrandBackground2) 16%, var(--colorNeutralBackground1))";
const EXIF_KEY_BACKGROUND = "color-mix(in srgb, var(--colorNeutralBackground2) 45%, var(--colorNeutralBackground1))";
const EXIF_SELECTED_BACKGROUND = "color-mix(in srgb, var(--colorBrandBackground2) 45%, var(--colorNeutralBackground1))";
const EXIF_SEARCH_HISTORY_KEY = "luxe:isp6s:exif-search-history";
const EXIF_SEARCH_HISTORY_LIMIT = 50;

interface SearchHistoryItem {
  query: string;
  favorite: boolean;
}

function readSearchHistory(): SearchHistoryItem[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(EXIF_SEARCH_HISTORY_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((item): item is SearchHistoryItem =>
      item !== null && typeof item === "object" && typeof item.query === "string"
      && typeof item.favorite === "boolean" && item.query.trim().length > 0 && item.query.length <= 200
    ).filter((item) => {
      if (seen.has(item.query)) return false;
      seen.add(item.query);
      return true;
    }).slice(0, EXIF_SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function ExifTable({ tomlPath }: { tomlPath: string | null }) {
  const [loaded, setLoaded] = useState<{ path: string; sections: ImageTomlSection[]; error: string | null } | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState(readSearchHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const searchBarRef = useRef<HTMLDivElement>(null);
  const historyListRef = useRef<HTMLDivElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!historyOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!searchBarRef.current?.contains(target) && !historyListRef.current?.contains(target)) {
        setHistoryOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHistoryOpen(false);
      historyButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [historyOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXIF_SEARCH_HISTORY_KEY, JSON.stringify(history));
    } catch {
      // History remains available until this view unmounts if storage is unavailable.
    }
  }, [history]);

  const rememberSearch = (value: string) => {
    const nextQuery = value.trim();
    if (!nextQuery) return;
    try {
      new RegExp(nextQuery, "i");
    } catch {
      return;
    }
    setHistory((items) => {
      const previous = items.find((item) => item.query === nextQuery);
      const next = [{ query: nextQuery, favorite: previous?.favorite ?? false },
        ...items.filter((item) => item.query !== nextQuery)];
      return [...next.filter((item) => item.favorite), ...next.filter((item) => !item.favorite)]
        .slice(0, EXIF_SEARCH_HISTORY_LIMIT);
    });
  };

  const toggleFavorite = (value: string) => {
    setHistory((items) => {
      const next = items.map((item) => item.query === value ? { ...item, favorite: !item.favorite } : item);
      return [...next.filter((item) => item.favorite), ...next.filter((item) => !item.favorite)];
    });
  };

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
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col" style={{ background: "var(--colorNeutralBackground1)" }}>
      <div ref={searchBarRef} className="flex h-8 shrink-0 items-center gap-2 border-b px-2"
        style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground1)" }}>
        <Search24Regular className="h-4 w-4 shrink-0" aria-hidden="true"
          style={{ color: "var(--colorNeutralForeground3)" }} />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          onBlur={(event) => rememberSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            rememberSearch(event.currentTarget.value);
            setHistoryOpen(false);
          }}
          placeholder="搜索 KEY" aria-label="搜索 EXIF 关键字" maxLength={200}
          aria-invalid={Boolean(search.error)}
          className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
          style={{ color: "var(--colorNeutralForeground2)", caretColor: "var(--colorBrandForeground1)" }} />
        <button ref={historyButtonRef} type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
          aria-label="搜索历史" title="搜索历史" aria-expanded={historyOpen}
          aria-controls={historyOpen ? "exif-search-history" : undefined}
          onClick={() => setHistoryOpen((open) => !open)}
          style={{ color: "var(--colorNeutralForeground2)", background: "transparent" }}>
          <ChevronDown20Regular aria-hidden="true" />
        </button>
      </div>
      {historyOpen && (
        <div ref={historyListRef} id="exif-search-history" role="group" aria-label="EXIF 搜索历史"
          className="absolute left-0 right-0 top-8 z-20 min-w-0 overflow-y-auto border-b p-1"
          style={{ maxHeight: "calc(100% - 32px)", borderColor: "var(--colorNeutralStroke2)",
            background: "var(--colorNeutralBackground1)", boxShadow: "0 4px 8px rgba(0, 0, 0, 0.12)" }}>
          {history.length === 0
            ? <div className="px-3 py-2 text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>暂无搜索历史</div>
            : history.map((item) => (
              <div key={item.query} className="flex min-h-9 min-w-0 items-center gap-1 rounded hover:bg-[var(--colorNeutralBackground2)]">
                <button type="button" className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs"
                  title={item.query} onClick={() => { setQuery(item.query); rememberSearch(item.query); setHistoryOpen(false); }}>
                  {item.query}
                </button>
                <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
                  aria-label={item.favorite ? `取消收藏 ${item.query}` : `收藏 ${item.query}`}
                  title={item.favorite ? "取消收藏" : "收藏"}
                  aria-pressed={item.favorite} onClick={() => toggleFavorite(item.query)}
                  style={{ color: item.favorite ? "var(--colorPaletteRedForeground1)" : "var(--colorNeutralForeground3)" }}>
                  {item.favorite ? <Heart20Filled aria-hidden="true" /> : <Heart20Regular aria-hidden="true" />}
                </button>
                <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
                  aria-label={`移除 ${item.query}`} title="移除"
                  onClick={() => setHistory((items) => items.filter((entry) => entry.query !== item.query))}
                  style={{ color: "var(--colorNeutralForeground3)" }}>
                  <Dismiss20Regular aria-hidden="true" />
                </button>
              </div>
            ))}
        </div>
      )}
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
      </div>
      {selected ? <ExifRows key={`${tomlPath}:${selected.name}:${query}`} fields={selected.fields} />
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
}: {
  fields: ImageTomlSection["fields"];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [firstVisible, setFirstVisible] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ row: number; column: "key" | "value" } | null>(null);
  const columns = "50% 50%";

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
    if (!viewport) return;
    const update = () => {
      setViewportHeight((height) => height === viewport.clientHeight ? height : viewport.clientHeight);
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
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" data-isp6s-details-scroll="true"
        onScroll={(event) => {
          const next = Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT);
          setFirstVisible((current) => current === next ? current : next);
        }}>
        <div style={{ height: fields.length * ROW_HEIGHT, position: "relative" }} role="rowgroup">
          {fields.slice(start, end).map((field, offset) => {
            const row = start + offset;
            return <div key={`${row}:${field.key}`} className="absolute left-0 grid w-full border-b text-xs" role="row"
              aria-rowindex={row + 1}
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
