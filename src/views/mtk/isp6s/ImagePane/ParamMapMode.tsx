import { useEffect, useState } from "react";

import { cppResolveCardSource } from "@/ipc/cppParser";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import { SourceCodeView } from "../SourceCodeView";

interface Props {
  filePath: string;
  schema:   Isp6sSchemaRoot;
  /** Card name that the user clicked (e.g. "MainT"). Drives the jump. */
  activeCard?: string;
}

/**
 * Notepad++-style read-only source view with click-card-to-jump. Resolution
 * of card → ranges/line goes through Rust `cpp_resolve_card_source` so the
 * `re:` regex / context = "block" / etc. semantics stay identical to hiz.
 */
export function ParamMapMode({ filePath, schema, activeCard }: Props) {
  const [ranges,   setRanges]   = useState<Array<[number, number]>>([]);
  const [jumpLine, setJumpLine] = useState<number>(1);
  const [err,      setErr]      = useState<string | null>(null);

  useEffect(() => {
    if (!activeCard) { setRanges([]); setJumpLine(1); setErr(null); return; }
    const spec = schema.card_source?.[activeCard];
    if (!spec) {
      setRanges([]); setJumpLine(1);
      setErr(`[card_source.${activeCard}] 未配置`);
      return;
    }
    let cancelled = false;
    cppResolveCardSource(filePath, spec)
      .then((hit) => {
        if (cancelled) return;
        setRanges(hit.ranges.map(([a, b]) => [a, b] as [number, number]));
        setJumpLine(hit.jump_line);
        setErr(null);
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [filePath, activeCard, schema]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs"
           style={{
             background: "var(--colorNeutralBackground3)",
             color:      "var(--colorNeutralForeground3)",
             borderBottom: "1px solid var(--colorNeutralStroke2)",
           }}>
        <span>
          {activeCard
            ? `卡片：${activeCard}`
            : "点击左侧任一子卡片在源码中定位"}
        </span>
        {err && (
          <span style={{ color: "var(--colorPaletteRedForeground1)" }}>{err}</span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <SourceCodeView filePath={filePath} ranges={ranges} jumpLine={jumpLine} />
      </div>
    </div>
  );
}
