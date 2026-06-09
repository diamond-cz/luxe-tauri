import { useState, type ReactNode } from "react";
import { ChevronDown24Regular } from "@fluentui/react-icons";

interface Props {
  title:     string;
  /** Optional badge area in the header right side. */
  badges?:   ReactNode;
  /** Optional extra actions placed between badges and chevron. Click events
   *  are stopped so they don't toggle the card. */
  headerExtra?: ReactNode;
  /** Whether the card is collapsed initially. */
  defaultCollapsed?: boolean;
  /** Controlled-mode collapsed state. */
  collapsed?: boolean;
  onToggle?:  (collapsed: boolean) => void;
  children:   ReactNode;
  className?: string;
  surface?: "default" | "panel";
}

/**
 * Equivalent of hiz's `CollapsibleCard` (`isp6s_ae.py:608`).
 * - Click header to toggle collapse
 * - Header right slot for badge strip
 * - Body slides via height transition; uses CSS `grid-template-rows: 0fr/1fr`
 *   trick so we don't have to measure content height
 */
export function CollapsibleCard({
  title, badges, headerExtra, defaultCollapsed = false,
  collapsed, onToggle, children, className, surface = "default",
}: Props) {
  const [internal, setInternal] = useState(defaultCollapsed);
  const isControlled = collapsed !== undefined;
  const open  = isControlled ? !collapsed : !internal;
  const cardBackground = surface === "panel"
    ? "var(--colorNeutralBackground1)"
    : "var(--colorNeutralBackground2)";
  const headerBackground = surface === "panel"
    ? "var(--colorNeutralBackground2)"
    : "transparent";
  const hoverBackground = surface === "panel"
    ? "var(--colorNeutralBackground3)"
    : "var(--colorNeutralBackground3)";

  const flip = () => {
    if (isControlled) onToggle?.(!collapsed);
    else { setInternal((s) => !s); onToggle?.(!internal); }
  };

  return (
    <div
      className={"flex flex-col rounded-xl border " + (className ?? "")}
      style={{
        background:  cardBackground,
        borderColor: "var(--colorNeutralStroke2)",
      }}
    >
      <button
        type="button"
        onClick={flip}
        className={
          "flex h-11 w-full items-center justify-between gap-2 pl-7 pr-3 transition-colors " +
          (open ? "rounded-t-xl" : "rounded-xl")
        }
        style={{
          color: "var(--colorNeutralForeground1)",
          background: headerBackground,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget as HTMLButtonElement).style.background =
            hoverBackground}
        onMouseLeave={(e) =>
          (e.currentTarget as HTMLButtonElement).style.background = headerBackground}
      >
        <span className="flex items-center gap-2">
          <span className="relative -top-0.5 text-sm font-semibold">{title}</span>
        </span>
        <span className="flex items-center gap-2">
          {badges && (
            <span className="flex items-center gap-1.5">{badges}</span>
          )}
          {headerExtra && (
            <span className="flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}>
              {headerExtra}
            </span>
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
          <div className="px-3 pb-3 pt-1.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
