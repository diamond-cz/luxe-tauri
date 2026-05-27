import { BadgeStrip } from "@/components/common/BadgeStrip";

interface Badge {
  label: string;
  value: string;
  hint?: string;
}

interface Props {
  title:      string;
  badges:     Badge[];
  accent?:    string;
  /** Inner content (e.g. nested sub-cards in M5b). */
  children?:  React.ReactNode;
  /** When provided, the whole card header becomes clickable. */
  onClick?:   () => void;
}

/**
 * Equivalent of hiz `_AEParamCard` — a rounded sub-panel with title + badge
 * strip on the same row. Optional `onClick` makes the header tile clickable
 * so the param_map preview can jump to the matching source range.
 */
export function AeParamCard({ title, badges, accent, children, onClick }: Props) {
  const clickable = !!onClick;
  return (
    <div
      className="flex flex-col rounded-lg border transition-colors"
      style={{
        background:  "var(--colorNeutralBackground3)",
        borderColor: "var(--colorNeutralStroke2)",
        cursor:      clickable ? "pointer" : "default",
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (clickable) (e.currentTarget as HTMLDivElement).style.borderColor =
          "var(--colorBrandStroke1)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor =
          "var(--colorNeutralStroke2)";
      }}
    >
      <div
        className="flex h-11 items-center justify-between gap-3 pl-9 pr-3"
        style={{
          borderBottom: children
            ? "1px solid var(--colorNeutralStroke2)"
            : "none",
        }}
      >
        <span className="flex items-center gap-2">
          {accent && (
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: accent }}
            />
          )}
          <span className="text-sm font-semibold"
                style={{ color: "var(--colorNeutralForeground1)" }}>
            {title}
          </span>
        </span>
        <BadgeStrip items={badges} />
      </div>
      {children && <div className="p-3">{children}</div>}
    </div>
  );
}
