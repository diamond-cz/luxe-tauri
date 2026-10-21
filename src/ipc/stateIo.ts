import { call } from "./client";
import type {
  AvailRect,
  SavedGeom,
  StateRoot,
  TargetGeom,
} from "@/types/ipc";

/* -------- state.toml -------- */

export const loadState = () =>
  call<StateRoot>("load_state");

let stateWrites: Promise<void> = Promise.resolve();

export const saveStateSection = (section: string, value: unknown) => {
  const pending = stateWrites.catch(() => {}).then(() =>
    call<void>("save_state_section", { section, value }));
  stateWrites = pending;
  return pending;
};

export const flushStateNow = () => {
  const pending = stateWrites.then(() => call<void>("flush_state_now"));
  stateWrites = pending;
  return pending;
};

/* -------- window geometry -------- */

export const computeAdaptiveGeometry = (saved: SavedGeom, avail: AvailRect) =>
  call<TargetGeom>("compute_adaptive_geometry", { saved, avail });

export const currentAvailRect = () =>
  call<AvailRect>("current_avail_rect");

export const applyWindowGeometry = (geom: TargetGeom) =>
  call<void>("apply_window_geometry", { geom });

export const saveWindowGeometry = () =>
  call<void>("save_window_geometry");
