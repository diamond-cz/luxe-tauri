import { useEffect, useMemo, useState } from "react";

import { cppGetFieldsAtPath } from "@/ipc/cppParser";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";

interface Props {
  filePath: string;
  schema:   Isp6sSchemaRoot;
  tomlData: Record<string, string>;
}

interface CheckRow {
  label:    string;
  cpp_path: string;
  toml_key: string;
  cppValue: string;
  tomlValue: string;
  match:    boolean;
}

/**
 * 3-column comparison table: 关键字 | 参数文件值 (AE.cpp) | 图片3A 值 (image TOML).
 * Rows come from `[[para_check.items]]` in Isp6s.toml.
 */
export function ParaCheckMode({ filePath, schema, tomlData }: Props) {
  const items = useMemo(() => schema.para_check?.items ?? [], [schema]);
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!filePath || items.length === 0) { setRows([]); return; }
    setLoading(true);
    (async () => {
      const computed: CheckRow[] = [];
      for (const it of items) {
        let cppValue = "—";
        try {
          const f = await cppGetFieldsAtPath(filePath, it.cpp_path);
          if (f.length > 0) cppValue = f[0].value;
        } catch {/* ignore */}
        const tomlValue = tomlData[it.toml_key] ?? "—";
        computed.push({
          label:    it.label,
          cpp_path: it.cpp_path,
          toml_key: it.toml_key,
          cppValue,
          tomlValue,
          match: cppValue !== "—" && tomlValue !== "—" && cppValue === tomlValue,
        });
      }
      if (!cancelled) {
        setRows(computed);
        setLoading(false);
      }
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filePath, items, tomlData]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-3 py-2 text-xs"
           style={{ color: "var(--colorNeutralForeground3)" }}>
        <span>参数版本对比 · 红色 = AE.cpp 值与图片 TOML 不一致</span>
        {loading && <span>loading…</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm" style={{ fontFamily: "ui-monospace, monospace" }}>
          <thead style={{
            background: "var(--colorNeutralBackground3)",
            color:      "var(--colorNeutralForeground2)",
            position:   "sticky", top: 0,
          }}>
            <tr>
              <Th>关键字</Th>
              <Th>参数文件</Th>
              <Th>图片3A</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}
                  style={{ borderBottom: "1px solid var(--colorNeutralStroke3)" }}>
                <Td>
                  <span title={`${r.cpp_path} ↔ ${r.toml_key}`}>{r.label}</span>
                </Td>
                <Td highlight={!r.match}>{r.cppValue}</Td>
                <Td highlight={!r.match}>{r.tomlValue}</Td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={3} className="p-4 text-center text-xs"
                      style={{ color: "var(--colorNeutralForeground3)" }}>
                Isp6s.toml 未配置 [[para_check.items]]
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
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
function Td({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <td className="px-3 py-1.5"
        style={{
          color: highlight ? "var(--colorPaletteRedForeground1)" : "var(--colorNeutralForeground2)",
          fontWeight: highlight ? 600 : 400,
        }}>
      {children}
    </td>
  );
}
