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

export const saveStateSection = (section: string, value: unknown) =>
  call<void>("save_state_section", { section, value });

export const flushStateNow = () =>
  call<void>("flush_state_now");

/* -------- window geometry -------- */

export const computeAdaptiveGeometry = (saved: SavedGeom, avail: AvailRect) =>
  call<TargetGeom>("compute_adaptive_geometry", { saved, avail });

export const currentAvailRect = () =>
  call<AvailRect>("current_avail_rect");

export const applyWindowGeometry = (geom: TargetGeom) =>
  call<void>("apply_window_geometry", { geom });

export const saveWindowGeometry = () =>
  call<void>("save_window_geometry");
