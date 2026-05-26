/**
 * Fluent UI v9 icon wrapper. We map the original `ic_fluent_*` names from the
 * Python codebase onto @fluentui/react-icons concrete components so call sites
 * don't have to know the camelCase form.
 */
import {
  Home24Filled, Home24Regular,
  Settings24Filled,
  Camera24Filled,
  ShieldCheckmark24Filled,
  PaintBrush24Filled,
  /* Settings rows */
  LocalLanguage24Regular,
  DarkTheme24Regular,
  ResizeLarge24Regular,
  DismissSquare24Regular,
  Folder24Regular,
  ArrowSync24Regular,
  Alert24Regular,
  Save24Regular,
  Keyboard24Regular,
  DismissCircle24Filled,
  Person24Regular,
  Info24Regular,
  PeopleTeam24Regular,
  Open24Regular,
  ArrowExit24Filled,
  Apps24Regular,
} from "@fluentui/react-icons";
import type { FluentIcon as RFluentIcon } from "@fluentui/react-icons";

export type LuxeIconName =
  | "ic_fluent_home_filled"
  | "ic_fluent_home_regular"
  | "ic_fluent_settings_filled"
  | "ic_fluent_window_location_target_filled"
  | "ic_fluent_window_shield_filled"
  | "ic_fluent_window_brush_filled"
  | "ic_fluent_local_language_regular"
  | "ic_fluent_dark_theme_regular"
  | "ic_fluent_resize_large_regular"
  | "ic_fluent_dismiss_square_regular"
  | "ic_fluent_folder_regular"
  | "ic_fluent_arrow_sync_regular"
  | "ic_fluent_alert_regular"
  | "ic_fluent_save_regular"
  | "ic_fluent_keyboard_regular"
  | "ic_fluent_dismiss_circle_filled"
  | "ic_fluent_person_regular"
  | "ic_fluent_home_database_regular"
  | "ic_fluent_info_regular"
  | "ic_fluent_diversity_regular"
  | "ic_fluent_open_regular"
  | "ic_fluent_sign_out_filled";

const REGISTRY: Record<LuxeIconName, RFluentIcon> = {
  ic_fluent_home_filled:                     Home24Filled,
  ic_fluent_home_regular:                    Home24Regular,
  ic_fluent_settings_filled:                 Settings24Filled,
  ic_fluent_window_location_target_filled:   Camera24Filled,
  ic_fluent_window_shield_filled:            ShieldCheckmark24Filled,
  ic_fluent_window_brush_filled:             PaintBrush24Filled,
  ic_fluent_local_language_regular:          LocalLanguage24Regular,
  ic_fluent_dark_theme_regular:              DarkTheme24Regular,
  ic_fluent_resize_large_regular:            ResizeLarge24Regular,
  ic_fluent_dismiss_square_regular:          DismissSquare24Regular,
  ic_fluent_folder_regular:                  Folder24Regular,
  ic_fluent_arrow_sync_regular:              ArrowSync24Regular,
  ic_fluent_alert_regular:                   Alert24Regular,
  ic_fluent_save_regular:                    Save24Regular,
  ic_fluent_keyboard_regular:                Keyboard24Regular,
  ic_fluent_dismiss_circle_filled:           DismissCircle24Filled,
  ic_fluent_person_regular:                  Person24Regular,
  ic_fluent_home_database_regular:           Home24Regular,
  ic_fluent_info_regular:                    Info24Regular,
  ic_fluent_diversity_regular:               PeopleTeam24Regular,
  ic_fluent_open_regular:                    Open24Regular,
  ic_fluent_sign_out_filled:                 ArrowExit24Filled,
};

// keep imports tree-shaken cleanly
void Apps24Regular;

export function FluentIcon({
  name,
  className,
}: { name: LuxeIconName; className?: string }) {
  const Cmp = REGISTRY[name];
  return <Cmp className={className} />;
}
