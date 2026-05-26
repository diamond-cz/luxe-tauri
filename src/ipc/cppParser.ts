import { call } from "./client";
import type { FieldEntry, ParseResult, StructNode } from "@/types/cpp_parser";

/** Mirror of `src-tauri/src/commands/cpp_cmds.rs`. Path arg is the AE.cpp/...cpp file path. */

export const parseCppFile = (path: string) =>
  call<ParseResult>("parse_cpp_file", { path });

export const cppGetFieldsAtPath = (path: string, query: string) =>
  call<FieldEntry[]>("cpp_get_fields_at_path", { path, query });

export const cppGetValuesAtPath = (path: string, query: string, key?: 0 | 1) =>
  call<string[] | string[][]>("cpp_get_values_at_path", { path, query, key });

export const cppGetNodeAtPath = (path: string, query: string) =>
  call<StructNode | null>("cpp_get_node_at_path", { path, query });

export const cppSearchByComment = (
  path: string,
  pattern: string,
  caseSensitive?: boolean,
) =>
  call<FieldEntry[]>("cpp_search_by_comment", {
    path,
    pattern,
    caseSensitive: caseSensitive ?? false,
  });

export const cppGetFieldsByLine = (path: string, line: number) =>
  call<FieldEntry[]>("cpp_get_fields_by_line", { path, line });

export const cppGetFieldsInRange = (path: string, start: number, end: number) =>
  call<FieldEntry[]>("cpp_get_fields_in_range", { path, start, end });

export interface SectionInfo {
  path:        string;
  comment:     string;
  line_start:  number;
  line_end:    number;
  value_count: number;
  child_count: number;
}
export const cppGetSectionNames = (path: string) =>
  call<SectionInfo[]>("cpp_get_section_names", { path });

export const cppClearCache = () => call<void>("cpp_clear_cache");

export interface ParaCheckItem {
  label:    string;
  cpp_path: string;
  toml_key: string;
}
export interface PreviewInfoItem {
  label:    string;
  toml_key: string;
}
export interface NormalCard {
  CWR?: string;
  wt?:  Record<string, string>;
  tar?: Record<string, string>;
}
export interface FaceSub  { wt_max?: string[]; FBT?: string; FLT?: string }
export interface TouchSub { wt_max?: string[]; tar?: string }
export interface FaceTouchCard {
  CWR?:          string;
  LCE_Gain_num?: string;
  LCE_Gain_den?: string;
  Face?:         FaceSub;
  Touch?:        TouchSub;
}
export interface Isp6sSchemaRoot {
  card?: { Normal?: NormalCard; face_touch?: FaceTouchCard };
  Image: Record<string, string>;
  lce?:  { group?: any[] };
  para_check?:   { items?: ParaCheckItem[] };
  preview_info?: { items?: PreviewInfoItem[] };
  card_source?: Record<string, CardSourceSpec>;
}
export const getIsp6sSchema = () => call<Isp6sSchemaRoot>("get_isp6s_schema");

/* ─── card_source resolver ─── */
export interface CardSourceSpec {
  keywords?:    string[];
  paths?:       string[];
  line_ranges?: Array<[number, number]>;
  context?:     string | number;
  jump_to?:     string;
  highlight?:   string;
}
export interface CardSourceHit {
  ranges:    Array<[number, number]>;
  jump_line: number;
  highlight: string;
}
export const cppResolveCardSource = (path: string, spec: CardSourceSpec) =>
  call<CardSourceHit>("cpp_resolve_card_source", { path, spec });
