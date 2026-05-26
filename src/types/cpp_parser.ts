/** Mirrors `src-tauri/src/cpp_parser/types.rs` — keep in sync. */
export interface FieldEntry {
  path:       string;
  value:      string;
  comment:    string;
  line:       number;
  depth:      number;
  index:      number;
  value_type: string;
}

export interface StructNode {
  path:            string;
  depth:           number;
  line_start:      number;
  line_end:        number;
  section_comment: string;
  values:          FieldEntry[];
  children:        StructNode[];
}

export interface CommentEntry {
  line: number;
  text: string;
  raw:  string;
}

export interface MacroEntry {
  name:  string;
  value: string;
}

export interface ParseResult {
  file:     string;
  var_name: string;
  var_type: string;
  fields:   FieldEntry[];
  tree:     StructNode;
  comments: CommentEntry[];
  includes: string[];
  macros:   MacroEntry[];
}
