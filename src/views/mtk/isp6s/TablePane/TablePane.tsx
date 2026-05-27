import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select } from "@fluentui/react-components";
import {
  Search24Regular,
  ChevronDown24Regular,
  ChevronUp24Regular,
  Image24Regular,
} from "@fluentui/react-icons";
import { convertFileSrc } from "@tauri-apps/api/core";

import { loadImageToml, type ImageEntry } from "@/ipc/imageScan";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import { LceChart } from "./LceChart";

type TabId = "image" | "normal" | "face" | "lce" | "all";

interface Props {
  schema:    Isp6sSchemaRoot;
  entries:   ImageEntry[];
  current:   number;
  tomlData:  Record<string, string>;
  onPickImage: (idx: number) => void;
  collapsed: boolean;
  onToggleCollapsed: (next: boolean) => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "image",  label: "Image" },
  { id: "normal", label: "Normal" },
  { id: "face",   label: "Face" },
  { id: "lce",    label: "LCE" },
  { id: "all",    label: "All" },
];

export function TablePane({
  schema, entries, current, tomlData, onPickImage,
  collapsed, onToggleCollapsed,
}: Props) {
  const [tab,    setTab]    = useState<TabId>("image");
  const [search, setSearch] = useState("");

  const currentEntry = entries[current];
  const thumbUrl = useMemo(() => {
    if (!currentEntry) return null;
    try { return convertFileSrc(currentEntry.jpg_path); }
    catch { return null; }
  }, [currentEntry?.jpg_path]);

  return (
    <div className="flex h-full w-full flex-col"
         style={{
           background:  "var(--colorNeutralBackground2)",
           border:      "1px solid var(--colorNeutralStroke2)",
           borderRadius: 12,
           overflow:    "hidden",
         }}>
      {/* Header bar — always visible: thumbnail + name + search + collapse toggle */}
      <div className="flex shrink-0 items-center gap-3 px-3 py-2"
           style={!collapsed
             ? { borderBottom: "1px solid var(--colorNeutralStroke2)" }
             : undefined}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
             style={{
               background: "var(--colorNeutralBackground3)",
               color:      "var(--colorNeutralForeground2)",
             }}>
          {thumbUrl ? (
            <img src={thumbUrl}
                 alt={currentEntry?.name ?? ""}
                 className="h-full w-full object-cover"
                 draggable={false} />
          ) : (
            <Image24Regular />
          )}
        </div>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold"
             style={{ color: "var(--colorNeutralForeground1)" }}
             title={currentEntry?.name ?? ""}>
          {currentEntry?.name ?? "未选择图片"}
        </div>
        <Input
          value={search}
          onChange={(_, d) => {
            setSearch(d.value);
            if (collapsed && d.value) onToggleCollapsed(false);
          }}
          placeholder="过滤…"
          contentBefore={<Search24Regular />}
          style={{ minWidth: 180 }}
        />
        <Button
          appearance="subtle"
          icon={collapsed ? <ChevronDown24Regular /> : <ChevronUp24Regular />}
          onClick={() => onToggleCollapsed(!collapsed)}
          aria-label={collapsed ? "展开" : "收起"}
        />
      </div>

      {!collapsed && (
        <>
          {/* Tabs row */}
          <div className="flex shrink-0 items-center gap-2 px-2 py-1.5"
               style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className="rounded-md px-3 py-1.5 text-xs transition-colors"
                  style={{
                    background: active ? "var(--colorBrandBackground)" : "transparent",
                    color:      active
                      ? "var(--colorNeutralForegroundOnBrand)"
                      : "var(--colorNeutralForeground2)",
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
            <div className="flex-1" />
            {tab === "lce" && entries.length > 0 && (
              <Select
                value={String(current)}
                onChange={(_, d) => onPickImage(parseInt(d.value, 10))}
                style={{ minWidth: 260 }}
              >
                {entries.map((e, i) => (
                  <option key={e.jpg_path} value={String(i)}>{e.name}</option>
                ))}
              </Select>
            )}
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === "image"  && <ImageTab    schema={schema} entries={entries} current={current}
                                             search={search} onPick={onPickImage} />}
            {tab === "normal" && <Placeholder label="Normal 表格 · 待 normal_table.toml 映射" />}
            {tab === "face"   && <Placeholder label="Face 表格 · 待 face_table.toml 映射" />}
            {tab === "lce"    && <LceTab tomlData={tomlData} />}
            {tab === "all"    && <AllTab tomlData={tomlData} search={search} />}
          </div>
        </>
      )}
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs"
         style={{ color: "var(--colorNeutralForeground3)" }}>
      {label}
    </div>
  );
}

/* ────── Image tab — list of images with extra columns from [Image] schema ────── */

function ImageTab({
  schema, entries, current, search, onPick,
}: {
  schema:   Isp6sSchemaRoot;
  entries:  ImageEntry[];
  current:  number;
  search:   string;
  onPick:   (idx: number) => void;
}) {
  const extraCols = useMemo(
    () => Object.entries(schema.Image ?? {}),
    [schema],
  );
  /* All toml maps loaded on demand. We cache per path so switching images
   * doesn't re-fetch. */
  const [tomls, setTomls] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, Record<string, string>> = { ...tomls };
      for (const e of entries) {
        if (next[e.toml_path]) continue;
        try {
          next[e.toml_path] = await loadImageToml(e.toml_path);
        } catch { /* ignore */ }
        if (cancelled) return;
      }
      setTomls(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries.map((e, i) => ({ e, i }));
    return entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.name.toLowerCase().includes(q));
  }, [entries, search]);

  return (
    <div className="h-full w-full overflow-auto">
      <table className="w-full border-collapse text-xs"
             style={{ fontFamily: "ui-monospace, monospace" }}>
        <thead style={{
          background: "var(--colorNeutralBackground3)",
          color:      "var(--colorNeutralForeground2)",
          position:   "sticky", top: 0, zIndex: 1,
        }}>
          <tr>
            <Th>idx</Th>
            <Th>name</Th>
            {extraCols.map(([col]) => <Th key={col}>{col}</Th>)}
          </tr>
        </thead>
        <tbody>
          {filtered.map(({ e, i }) => {
            const data = tomls[e.toml_path] ?? {};
            return (
              <tr key={e.jpg_path}
                  onClick={() => onPick(i)}
                  style={{
                    cursor: "pointer",
                    background: i === current
                      ? "var(--colorBrandBackground2)" : "transparent",
                    borderBottom: "1px solid var(--colorNeutralStroke3)",
                  }}>
                <Td>{i + 1}</Td>
                <Td>{e.name}</Td>
                {extraCols.map(([col, key]) => (
                  <Td key={col}>{data[key as string] ?? "—"}</Td>
                ))}
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr><td className="p-4 text-center"
                    style={{ color: "var(--colorNeutralForeground3)" }}
                    colSpan={2 + extraCols.length}>
              没有图片
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ────── LCE tab ────── */

function LceTab({ tomlData }: { tomlData: Record<string, string> }) {
  const labels = ["0", "1", "50", "250", "500", "750", "950", "999"];
  const num = (k: string) => {
    const v = tomlData[k];
    const f = parseFloat(v ?? "");
    return Number.isFinite(f) ? f : NaN;
  };
  const p = labels.map((n) => num(`SW_LCE_P${n}`));
  const o = labels.map((n) => num(`SW_LCE_O${n}`));
  return (
    <div className="h-full w-full p-3">
      <LceChart pSeries={p} oSeries={o} />
    </div>
  );
}

/* ────── All tab — flat key/value of the current image TOML ────── */

function AllTab({
  tomlData, search,
}: { tomlData: Record<string, string>; search: string }) {
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(tomlData)
      .filter(([k, v]) =>
        q === "" ||
        k.toLowerCase().includes(q) ||
        v.toLowerCase().includes(q),
      )
      .sort(([a], [b]) => a.localeCompare(b));
  }, [tomlData, search]);

  return (
    <div className="h-full w-full overflow-auto">
      <table className="w-full text-xs"
             style={{ fontFamily: "ui-monospace, monospace" }}>
        <thead style={{
          background: "var(--colorNeutralBackground3)",
          color:      "var(--colorNeutralForeground2)",
          position:   "sticky", top: 0, zIndex: 1,
        }}>
          <tr>
            <Th>key</Th>
            <Th>value</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}
                style={{ borderBottom: "1px solid var(--colorNeutralStroke3)" }}>
              <Td>{k}</Td>
              <Td>{v}</Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={2} className="p-4 text-center"
                    style={{ color: "var(--colorNeutralForeground3)" }}>
              （无数据）
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-semibold uppercase"
        style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3 py-1.5"
        style={{ color: "var(--colorNeutralForeground2)" }}>
      {children}
    </td>
  );
}
