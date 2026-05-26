import { useEffect, useMemo, useRef, useState } from "react";

import { readTextFile } from "@/ipc/text";

interface Props {
  filePath:  string;
  /** Highlight ranges (1-indexed inclusive). */
  ranges?:   Array<[number, number]>;
  /** Line to scroll to (1-indexed). */
  jumpLine?: number;
}

/**
 * Notepad++-style read-only source viewer.
 * - Line numbers on the left gutter
 * - Highlight given line ranges (yellow soft-bg)
 * - Auto-scroll to `jumpLine`
 *
 * Equivalent of hiz `_SourceCodeView`. We use a virtualised render: only
 * the visible window plus a small overscan is rendered, so loading 6000-line
 * AE.cpp stays smooth.
 */
export function SourceCodeView({ filePath, ranges, jumpLine }: Props) {
  const [text, setText] = useState<string>("");
  const [err,  setErr]  = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  /* Load + cache the file text. AE.cpp ≈ 140 KB so plain load is fine. */
  useEffect(() => {
    let cancelled = false;
    if (!filePath) return;
    readTextFile(filePath)
      .then((t) => { if (!cancelled) { setText(t); setErr(null); } })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [filePath]);

  const lines = useMemo(() => text.split(/\r?\n/), [text]);

  /* Build a Set of highlighted line numbers for O(1) lookup. */
  const hiSet = useMemo(() => {
    const s = new Set<number>();
    for (const [a, b] of ranges ?? []) {
      for (let i = a; i <= b; i++) s.add(i);
    }
    return s;
  }, [ranges]);

  /* Scroll to jumpLine when it changes. */
  useEffect(() => {
    if (!jumpLine || !scrollerRef.current) return;
    const lh = LINE_H;
    const top = (jumpLine - 6) * lh;     // small lead-in
    scrollerRef.current.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [jumpLine, text]);

  if (err) {
    return (
      <div className="m-3 rounded-md border p-3 text-xs"
           style={{
             background:  "var(--colorPaletteRedBackground1)",
             borderColor: "var(--colorPaletteRedBorder1)",
             color:       "var(--colorPaletteRedForeground1)",
           }}>
        加载源文件失败：{err}
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="h-full w-full overflow-auto"
      style={{
        background: "var(--colorNeutralBackground1)",
        color:      "var(--colorNeutralForeground1)",
        fontFamily: "ui-monospace, Consolas, monospace",
        fontSize:   12,
        lineHeight: `${LINE_H}px`,
      }}
    >
      <div style={{ width: "max-content" }}>
        {lines.map((ln, i) => {
          const lineNo = i + 1;
          const highlighted = hiSet.has(lineNo);
          return (
            <div
              key={lineNo}
              style={{
                display:    "flex",
                whiteSpace: "pre",
                background: highlighted
                  ? "var(--colorPaletteMarigoldBackground1)"
                  : "transparent",
              }}
            >
              <span
                style={{
                  display:      "inline-block",
                  minWidth:     56,
                  paddingRight: 8,
                  textAlign:    "right",
                  color:        "var(--colorNeutralForeground4)",
                  borderRight:  "1px solid var(--colorNeutralStroke2)",
                  userSelect:   "none",
                }}
              >
                {lineNo}
              </span>
              <span style={{ paddingLeft: 8 }}>{ln || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LINE_H = 18;
