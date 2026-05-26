import { FluentIcon, type LuxeIconName } from "@/components/icons/FluentIcon";

interface Props {
  icon:   LuxeIconName;
  title:  string;
  desc?:  string;
  /** Right-side control(s). */
  children: React.ReactNode;
  className?: string;
}

/**
 * Reference design from hiz's page_about_custom._make_card:
 *   [icon]  title       <control>
 *           desc
 *
 * Cards have rounded corners + subtle background that stands out from the
 * panel background. Right column auto-sizes to content; left column flexes.
 */
export function SettingRow({ icon, title, desc, children, className }: Props) {
  return (
    <div
      className={
        "flex items-center gap-4 rounded-md border px-5 py-4 transition-colors hover:bg-white/[0.04] " +
        (className ?? "")
      }
      style={{
        background:  "var(--colorNeutralBackground2)",
        borderColor: "var(--colorNeutralStroke2)",
      }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
        style={{ color: "var(--colorNeutralForeground2)" }}
      >
        <FluentIcon name={icon} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" style={{ color: "var(--colorNeutralForeground1)" }}>
          {title}
        </div>
        {desc && (
          <div className="mt-0.5 truncate text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
            {desc}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
