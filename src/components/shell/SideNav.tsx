import { NavLink } from "react-router-dom";
import { tokens } from "@fluentui/react-components";
import { FluentIcon, type LuxeIconName } from "@/components/icons/FluentIcon";

interface NavItem {
  to:    string;
  icon:  LuxeIconName;
  hint:  string;
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
  return (
    <nav
      className="flex h-full w-12 flex-col items-center justify-between border-r py-3"
      style={{
        background:  tokens.colorNeutralBackground2,
        borderColor: tokens.colorNeutralStroke2,
      }}
    >
      <div className="flex flex-col items-center gap-2">
        {TOP_ITEMS.map((item) => <NavButton key={item.to} {...item} />)}
      </div>
      <div className="flex flex-col items-center gap-2">
        {BOTTOM_ITEMS.map((item) => <NavButton key={item.to} {...item} />)}
      </div>
    </nav>
  );
}

function NavButton({ to, icon, hint }: NavItem) {
  return (
    <NavLink
      to={to}
      title={hint}
      className={({ isActive }) =>
        [
          "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
          isActive
            ? "text-white"
            : "text-neutral-300 hover:text-white",
        ].join(" ")
      }
      style={({ isActive }) => ({
        background: isActive
          ? tokens.colorBrandBackground
          : "transparent",
      })}
    >
      <FluentIcon name={icon} />
    </NavLink>
  );
}
