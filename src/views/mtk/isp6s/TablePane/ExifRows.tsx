import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ImageTomlSection } from "@/types/ipc";

const ROW_HEIGHT = 38;
const OVERSCAN = 8;
const KEY_BACKGROUND = "color-mix(in srgb, var(--colorBrandBackground2) 9%, var(--colorNeutralBackground1))";
const SELECTED_BACKGROUND = "color-mix(in srgb, var(--colorBrandBackground2) 45%, var(--colorNeutralBackground1))";

export function ExifRows({ fields }: { fields: ImageTomlSection["fields"] }) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [firstVisible, setFirstVisible] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ row: number; column: "key" | "value" } | null>(null);
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
    const update = () => setViewportHeight((height) => height === viewport.clientHeight ? height : viewport.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const start = Math.max(0, firstVisible - OVERSCAN);
  const end = Math.min(fields.length, firstVisible + Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN);
  return <div className="flex min-h-0 flex-1 flex-col" role="table" aria-label={t("image_exif.table")} aria-rowcount={fields.length + 1}>
    <div className="sr-only" role="row">
      <span className="px-2 py-2" role="columnheader">{t("image_exif.column.key")}</span>
      <span className="px-2 py-2" role="columnheader">{t("image_exif.column.value")}</span>
    </div>
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" data-isp6s-details-scroll="true"
      onScroll={(event) => {
        const next = Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT);
        setFirstVisible((current) => current === next ? current : next);
      }}>
      <div style={{ height: fields.length * ROW_HEIGHT, position: "relative" }} role="rowgroup">
        {fields.slice(start, end).map((field, offset) => {
          const row = start + offset;
          return <div key={`${row}:${field.key}`} className="absolute left-0 grid w-full border-b text-xs" role="row" aria-rowindex={row + 2}
            style={{ top: row * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: "50% 50%",
              borderColor: "var(--colorNeutralStroke2)", color: "var(--colorNeutralForeground1)" }}>
            {(["key", "value"] as const).map((column) => {
              const selected = selectedCell?.row === row && selectedCell.column === column;
              return <div key={column} className={`flex min-w-0 items-center px-2 outline-none ${column === "key" ? "border-r font-semibold" : ""}`}
                role="cell" tabIndex={0} aria-selected={selected}
                onClick={(event) => selectCell(event.currentTarget, row, column)}
                onKeyDown={(event) => { if (event.key === "Enter") selectCell(event.currentTarget, row, column); }}
                onCopy={(event) => { event.clipboardData.setData("text/plain", field[column]); event.preventDefault(); }}
                style={{ borderColor: "var(--colorNeutralStroke2)", cursor: "text",
                  background: selected ? SELECTED_BACKGROUND : row % 2 === 0 ? "var(--colorNeutralBackground1)" : KEY_BACKGROUND,
                  boxShadow: selected ? "inset 3px 0 0 var(--colorBrandStroke1)" : undefined }}>
                <span className={`block w-full min-w-0 overflow-hidden ${column === "value" ? "truncate" : ""}`} title={field[column]}
                  data-tooltip-position="below-start" data-tooltip-wrap="true" data-tooltip-truncated="true"
                  style={column === "key" ? { lineHeight: "16px", maxHeight: 32, overflowWrap: "anywhere" } : undefined}>{field[column]}</span>
              </div>;
            })}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
