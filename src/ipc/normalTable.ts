import { call } from "./client";

export interface NormalTableSchema {
  block: NormalTableBlock[];
}

export type NormalTableBlock =
  | { type: "kv"; items?: NormalKvItem[] }
  | { type: "note"; text?: string }
  | {
      type: "grid";
      title?: string;
      title_style?: string;
      columns?: string[];
      rows?: NormalGridRow[];
    };

export interface NormalKvItem {
  label?: string;
  value?: string;
}

export interface NormalGridRow {
  label?: string;
  cells?: string[];
}

export const getNormalTableSchema = () =>
  call<NormalTableSchema>("get_normal_table_schema");
