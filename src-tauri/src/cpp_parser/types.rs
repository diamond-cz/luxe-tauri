//! Data contract for the C/C++ parser. Mirrors hiz's
//! `src/core/cpp_parser.py::FieldEntry` / `StructNode` / `ParseResult` so the
//! frontend (and Python tests) see byte-identical JSON shapes.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldEntry {
    /// Path string, e.g. `"[0][3][1].20"` — `[i]` enters the i-th child
    /// initializer_list, `.j` is the j-th direct value at that level.
    pub path:       String,
    pub value:      String,
    pub comment:    String,
    /// 1-indexed source line.
    pub line:       u32,
    pub depth:      u32,
    pub index:      u32,
    /// One of: "number", "bool", "identifier", "init_list", "unary",
    /// or the raw tree-sitter node kind for everything else.
    pub value_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructNode {
    pub path:            String,
    pub depth:           u32,
    pub line_start:      u32,
    pub line_end:        u32,
    pub section_comment: String,
    #[serde(default)] pub values:   Vec<FieldEntry>,
    #[serde(default)] pub children: Vec<StructNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentEntry {
    pub line: u32,
    pub text: String,
    pub raw:  String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroEntry {
    pub name:  String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub file:     String,
    pub var_name: String,
    pub var_type: String,
    pub fields:   Vec<FieldEntry>,
    pub tree:     StructNode,
    pub comments: Vec<CommentEntry>,
    pub includes: Vec<String>,
    pub macros:   Vec<MacroEntry>,
}

impl StructNode {
    pub fn empty() -> Self {
        Self {
            path: "[empty]".into(),
            depth: 0,
            line_start: 0,
            line_end: 0,
            section_comment: String::new(),
            values: vec![],
            children: vec![],
        }
    }
}
