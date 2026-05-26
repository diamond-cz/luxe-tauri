import { useState, type ReactNode } from "react";
import { ChevronDown24Regular } from "@fluentui/react-icons";

interface Props {
  title:     string;
  /** Optional badge area in the header right side. */
  badges?:   ReactNode;
  /** Whether the card is collapsed initially. */
  defaultCollapsed?: boolean;
  /** Controlled-mode collapsed state. */
  collapsed?: boolean;
  onToggle?:  (collapsed: boolean) => void;
  children:   ReactNode;
  className?: string;
}

/**
 * Equivalent of hiz's `CollapsibleCard` (`isp6s_ae.py:608`).
 * - Click header to toggle collapse
 * - Header right slot for badge strip
 * - Body slides via height transition; uses CSS `grid-template-rows: 0fr/1fr`
 *   trick so we don't have to measure content height
 */
export function CollapsibleCard({
  title, badges, defaultCollapsed = false,
  collapsed, onToggle, children, className,
}: Props) {
  const [internal, setInternal] = useState(defaultCollapsed);
  const isControlled = collapsed !== undefined;
  const open  = isControlled ? !collapsed : !internal;

  const flip = () => {
    if (isControlled) onToggle?.(!collapsed);
    else { setInternal((s) => !s); onToggle?.(!internal); }
  };

  return (
    <div
      className={"flex flex-col rounded-xl border " + (className ?? "")}
      style={{
        background:  "var(--colorNeutralBackground2)",
        borderColor: "var(--colorNeutralStroke2)",
      }}
    >
      <button
        type="button"
        onClick={flip}
        className="flex h-12 w-full items-center justify-between gap-3 rounded-t-xl px-4 transition-colors"
        style={{ color: "var(--colorNeutralForeground1)" }}
        onMouseEnter={(e) =>
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--colorNeutralBackground3)"}
        onMouseLeave={(e) =>
          (e.currentTarget as HTMLButtonElement).style.background = "transparent"}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-4 w-1 rounded-sm"
            style={{ background: "var(--colorBrandBackground)" }}
          />
          <span className="text-sm font-semibold">{title}</span>
        </span>
        <span className="flex items-center gap-3">
          {badges && (
            <span className="flex items-center gap-2">{badges}</span>
          )}
          <ChevronDown24Regular
            className="transition-transform"
            style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          />
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
