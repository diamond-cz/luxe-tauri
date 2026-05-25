/**
 * Fluent UI v9 icon wrapper. We pick the small subset we actually use rather
 * than re-exporting all of @fluentui/react-icons.
 *
 * Naming kept close to the original Python `ic_fluent_*` keys so future MTK /
 * Qualcomm / Unisoc / Settings keys can be added in one place.
 */
import {
  Home24Filled,
  Settings24Filled,
  Camera24Filled,
  ShieldCheckmark24Filled,
  PaintBrush24Filled,
} from "@fluentui/react-icons";
import type { FluentIcon as RFluentIcon } from "@fluentui/react-icons";

export type LuxeIconName =
  | "ic_fluent_home_filled"
  | "ic_fluent_settings_filled"
  | "ic_fluent_window_location_target_filled"   // MTK
  | "ic_fluent_window_shield_filled"            // Qualcomm
  | "ic_fluent_window_brush_filled";            // Unisoc

const REGISTRY: Record<LuxeIconName, RFluentIcon> = {
  ic_fluent_home_filled:                     Home24Filled,
  ic_fluent_settings_filled:                 Settings24Filled,
  ic_fluent_window_location_target_filled:   Camera24Filled,
  ic_fluent_window_shield_filled:            ShieldCheckmark24Filled,
  ic_fluent_window_brush_filled:             PaintBrush24Filled,
};

export function FluentIcon({
  name,
  className,
}: { name: LuxeIconName; className?: string }) {
  const Cmp = REGISTRY[name];
  return <Cmp className={className} />;
}
