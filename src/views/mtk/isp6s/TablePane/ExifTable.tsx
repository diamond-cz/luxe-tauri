import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Input, Tab, TabList } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { ChevronDown20Regular, Dismiss20Regular, Heart20Filled, Heart20Regular, Search24Regular } from "@fluentui/react-icons";
import { loadImageExif, type ImageExifDocument } from "@/ipc/imageScan";
import { ExifAeTables, ExifDetail, ExifSource } from "./ExifMetadataViews";
import { ExifRows } from "./ExifRows";
import { buildExifTabs, matchesExifField, matchesExifModule, validExifTable } from "./exifPresentation";

const EXIF_SEARCH_HISTORY_KEY = "luxe:isp6s:exif-search-history";
const EXIF_SEARCH_HISTORY_LIMIT = 50;
interface SearchHistoryItem { query: string; favorite: boolean }

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
  } catch { return []; }
}

export function ExifTable({ tomlPath, revision = 0 }: { tomlPath: string | null; revision?: number }) {
  const { t } = useTranslation();
  const id = useId();
  const [loaded, setLoaded] = useState<{ path: string; revision: number; document: ImageExifDocument | null; error: boolean } | null>(null);
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
      if (target instanceof Node && !searchBarRef.current?.contains(target) && !historyListRef.current?.contains(target)) setHistoryOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHistoryOpen(false);
      historyButtonRef.current?.focus();
    };
    window.document.addEventListener("pointerdown", closeOnOutsidePress);
    window.document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.document.removeEventListener("keydown", closeOnEscape);
    };
  }, [historyOpen]);
  useEffect(() => {
    try { window.localStorage.setItem(EXIF_SEARCH_HISTORY_KEY, JSON.stringify(history)); }
    catch { /* Keep bounded history available in memory when storage is unavailable. */ }
  }, [history]);
  const rememberSearch = (value: string) => {
    const nextQuery = value.trim();
    if (!nextQuery) return;
    try { new RegExp(nextQuery, "i"); } catch { return; }
    setHistory((items) => {
      const previous = items.find((item) => item.query === nextQuery);
      const next = [{ query: nextQuery, favorite: previous?.favorite ?? false }, ...items.filter((item) => item.query !== nextQuery)];
      return [...next.filter((item) => item.favorite), ...next.filter((item) => !item.favorite)].slice(0, EXIF_SEARCH_HISTORY_LIMIT);
    });
  };
  const toggleFavorite = (value: string) => setHistory((items) => {
    const next = items.map((item) => item.query === value ? { ...item, favorite: !item.favorite } : item);
    return [...next.filter((item) => item.favorite), ...next.filter((item) => !item.favorite)];
  });
  useEffect(() => {
    if (!tomlPath) { setLoaded(null); return; }
    let cancelled = false;
    // Import preparation has already selected and persisted the source. Image
    // clicks only project its TOML; they never start another JPEG progress job.
    setLoaded(null);
    loadImageExif(tomlPath).then(
      (document) => { if (!cancelled) setLoaded({ path: tomlPath, revision, document, error: false }); },
      () => { if (!cancelled) setLoaded({ path: tomlPath, revision, document: null, error: true }); },
    );
    return () => { cancelled = true; };
  }, [tomlPath, revision]);
  const search = useMemo(() => {
    const needle = query.trim();
    if (!needle) return { pattern: null, error: null };
    try { return { pattern: new RegExp(needle, "i"), error: null }; }
    catch (error) { return { pattern: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [query]);
  const loadedCurrent = loaded?.path === tomlPath && loaded.revision === revision;
  const document = loadedCurrent ? loaded.document : null;
  const tabs = useMemo(() => document ? buildExifTabs(document) : [], [document]);
  const selected = tabs.find((tab) => tab.name === selectedName) ?? tabs[0];
  const fields = selected?.fields.filter(({ key }) => matchesExifField(key, search.pattern)) ?? [];
  const modules = document?.modules.filter((module) => matchesExifModule(module, search.pattern)) ?? [];
  const tables = document?.ae_tables.filter(validExifTable) ?? [];
  const total = selected?.name === "Detail" ? document?.modules.length ?? 0
    : selected?.name === "AE_Table" ? tables.length : selected?.fields.length ?? 0;
  const count = selected?.name === "Detail" ? modules.length
    : selected?.name === "AE_Table" ? tables.filter((table) => !search.pattern || search.pattern.test(table.name)).length : fields.length;
  const message = search.error ? t("image_exif.invalid_regex", { error: search.error })
    : !tomlPath ? t("image_exif.select_image") : !loadedCurrent ? t("image_exif.reading")
      : loaded.error ? t("image_exif.unavailable") : query.trim() ? t("image_exif.no_match") : t("image_exif.empty");
  return <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col" style={{ background: "var(--colorNeutralBackground1)" }}>
    <div ref={searchBarRef} className="relative z-10 flex min-h-10 shrink-0 items-center gap-2 border-b px-2 py-1"
      style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground1)" }}>
      <Input type="search" size="small" appearance="underline" value={query} onChange={(_, data) => setQuery(data.value)}
        onBlur={(event) => rememberSearch(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { rememberSearch(query); setHistoryOpen(false); } }}
        placeholder={t("image_exif.search_placeholder")} aria-label={t("image_exif.search_label")} maxLength={200}
        aria-invalid={Boolean(search.error)} className="min-w-0 flex-1"
        style={{ border: "none", boxShadow: "none", background: "transparent" }}
        contentBefore={<Search24Regular aria-hidden="true" style={{ color: "var(--colorNeutralForeground3)" }} />}
        contentAfter={<Button ref={historyButtonRef} size="small" appearance="transparent" icon={<ChevronDown20Regular />}
          aria-label={t("image_exif.search_history")} title={t("image_exif.search_history")} aria-expanded={historyOpen}
          aria-controls={historyOpen ? `${id}-history` : undefined} onClick={() => setHistoryOpen((open) => !open)} />} />
      <span className="shrink-0 text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
        {t("image_exif.match_count", { count: search.error ? 0 : count, total })}
      </span>
      {historyOpen && <div ref={historyListRef} id={`${id}-history`} role="group" aria-label={t("image_exif.search_history_group")}
        className="absolute left-0 right-0 top-full z-20 max-h-56 min-w-0 overflow-y-auto border p-1"
        style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground1)", boxShadow: "var(--shadow8)" }}>
        {history.length === 0 ? <div className="px-3 py-2 text-xs">{t("image_exif.search_history_empty")}</div> : history.map((item) =>
          <div key={item.query} className="flex min-h-9 min-w-0 items-center gap-1 rounded hover:bg-[var(--colorNeutralBackground2)]">
            <Button appearance="transparent" size="small" className="min-w-0 flex-1 justify-start" title={item.query}
              onClick={() => { setQuery(item.query); rememberSearch(item.query); setHistoryOpen(false); }}>{item.query}</Button>
            <Button appearance="transparent" size="small" icon={item.favorite ? <Heart20Filled /> : <Heart20Regular />}
              aria-label={t(item.favorite ? "image_exif.unfavorite" : "image_exif.favorite", { query: item.query })}
              aria-pressed={item.favorite} onClick={() => toggleFavorite(item.query)}
              style={{ color: item.favorite ? "var(--colorPaletteRedForeground1)" : "var(--colorNeutralForeground3)" }} />
            <Button appearance="transparent" size="small" icon={<Dismiss20Regular />}
              aria-label={t("image_exif.remove_history", { query: item.query })}
              onClick={() => setHistory((items) => items.filter((entry) => entry.query !== item.query))} />
          </div>)}
      </div>}
    </div>
    <div className="shrink-0 overflow-x-auto border-b" data-exif-module-tabs="true"
      style={{ borderColor: "var(--colorNeutralStroke2)", background: "color-mix(in srgb, var(--colorBrandBackground2) 18%, var(--colorNeutralBackground1))" }}>
      <TabList size="small" selectedValue={selected?.name ?? ""} aria-label={t("image_exif.sections")}
        onTabSelect={(_, data) => setSelectedName(String(data.value))}>
        {tabs.map((tab) => <Tab key={tab.name} value={tab.name} id={`${id}-${tab.name}`} aria-controls={`${id}-panel`}>{tab.name}</Tab>)}
      </TabList>
    </div>
    {document && selected?.name === "Detail" && <ExifSource document={document} />}
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={selected ? `${id}-${selected.name}` : undefined}
      className="flex min-h-0 flex-1 flex-col">
      {!search.error && selected && document ? selected.name === "Detail" ? <ExifDetail modules={modules} />
        : selected.name === "AE_Table" ? <ExifAeTables key={`${tomlPath}:${revision}`} tables={tables} pattern={search.pattern} />
          : fields.length ? <ExifRows key={`${tomlPath}:${revision}:${selected.name}:${query}`} fields={fields} />
            : <div className="p-3 text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>{message}</div>
        : <div className="flex min-h-0 flex-1 items-center justify-center px-3 text-xs" role={search.error || loaded?.error ? "alert" : "status"}
          style={{ color: search.error || loaded?.error ? "var(--colorPaletteRedForeground1)" : "var(--colorNeutralForeground3)" }}>{message}</div>}
    </div>
  </div>;
}
