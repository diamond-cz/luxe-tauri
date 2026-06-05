import { NavLink } from "react-router-dom";
import { FluentIcon, type LuxeIconName } from "@/components/icons/FluentIcon";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUpdateStore } from "@/stores/updateStore";

interface NavItem {
  to:    string;
  icon:  LuxeIconName;
  hint:  string;
}

interface NavButtonProps extends NavItem {
  badge?: boolean;
}

const TOP_ITEMS: NavItem[] = [
  { to: "/home",     icon: "ic_fluent_home_filled",                   hint: "首页" },
  { to: "/mtk",      icon: "ic_fluent_window_location_target_filled", hint: "MTK" },
  { to: "/qualcomm", icon: "ic_fluent_window_shield_filled",          hint: "Qualcomm" },
  { to: "/unisoc",   icon: "ic_fluent_window_brush_filled",           hint: "Unisoc" },
];

const BOTTOM_ITEMS: NavItem[] = [
  { to: "/settings", icon: "ic_fluent_settings_filled", hint: "设置" },
];

export function SideNav() {
  const updateAvailable = useUpdateStore((s) => s.status === "available");
  const updateNotify = useSettingsStore((s) => s.settings.update_notify);
  const showUpdateBadge = updateAvailable && updateNotify;

  return (
    <nav
      className="flex h-full w-12 shrink-0 flex-col items-center justify-between py-3"
      style={{
        background:  "var(--colorNeutralBackground2)",
        borderRight: "1px solid var(--colorNeutralStroke2)",
      }}
    >
      <div className="flex flex-col items-center gap-2">
        {TOP_ITEMS.map((item) => (
          <NavButton
            key={item.to}
            {...item}
            badge={item.to === "/home" && showUpdateBadge}
          />
        ))}
      </div>
      <div className="flex flex-col items-center gap-2">
        {BOTTOM_ITEMS.map((item) => <NavButton key={item.to} {...item} />)}
      </div>
    </nav>
  );
}

function NavButton({ to, icon, hint, badge = false }: NavButtonProps) {
  return (
    <HoverTooltip content={hint} positioning="right-center" inline>
      <NavLink
        to={to}
        aria-label={hint}
        className="relative flex h-10 w-10 items-center justify-center rounded-md transition-colors"
        style={({ isActive }) => ({
          background: isActive
            ? "var(--colorBrandBackground)"
            : "transparent",
          color: isActive
            ? "var(--colorNeutralForegroundOnBrand)"
            : "var(--colorNeutralForeground2)",
        })}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLAnchorElement;
          if (!el.classList.contains("active")) {
            el.style.background = "var(--colorNeutralBackground3)";
            el.style.color      = "var(--colorNeutralForeground1)";
          }
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLAnchorElement;
          // NavLink doesn't add an `active` class by default; check aria-current.
          const isActive = el.getAttribute("aria-current") === "page";
          el.style.background = isActive
            ? "var(--colorBrandBackground)"
            : "transparent";
          el.style.color = isActive
            ? "var(--colorNeutralForegroundOnBrand)"
            : "var(--colorNeutralForeground2)";
        }}
      >
        <FluentIcon name={icon} />
        {badge && (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
            style={{ background: "var(--colorPaletteRedBackground3)" }}
          />
        )}
      </NavLink>
    </HoverTooltip>
  );
}
