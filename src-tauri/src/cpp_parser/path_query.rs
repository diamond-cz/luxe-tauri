//! Lookup helpers — direct ports of TreeSitterCppParser convenience methods.

use serde::Serialize;

use super::types::{FieldEntry, ParseResult, StructNode};

/// `get_fields_at_path("[0][3][1]")` — prefix match on the dotted/indexed path.
pub fn get_fields_at_path<'a>(
    res: &'a ParseResult,
    prefix: &str,
) -> Vec<&'a FieldEntry> {
    res.fields.iter().filter(|f| f.path.starts_with(prefix)).collect()
}

/// `get_values_at_path(prefix, key)` — return values; when `key == 0` (default)
/// auto-detect: if all values are on a single line → flat Vec<String>; if
/// values span multiple lines → grouped per-line as `Vec<Vec<String>>`.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ValuesAtPath {
    Flat(Vec<String>),
    Grouped(Vec<Vec<String>>),
}

pub fn get_values_at_path(res: &ParseResult, prefix: &str, key: u8) -> ValuesAtPath {
    let fields = get_fields_at_path(res, prefix);
    if key == 1 {
        return ValuesAtPath::Flat(fields.iter().map(|f| f.value.clone()).collect());
    }
    let mut seen_lines = std::collections::BTreeSet::new();
    for f in &fields {
        seen_lines.insert(f.line);
    }
    if seen_lines.len() <= 1 {
        return ValuesAtPath::Flat(fields.iter().map(|f| f.value.clone()).collect());
    }
    let mut grouped: indexmap_lite::Map = indexmap_lite::Map::new();
    for f in fields {
        grouped.entry(f.line).push(f.value.clone());
    }
    ValuesAtPath::Grouped(grouped.into_values())
}

/// Locate a `StructNode` by its path; e.g. `"[0][3][1]"`.
pub fn get_node_at_path<'a>(res: &'a ParseResult, path: &str) -> Option<&'a StructNode> {
    find_node(&res.tree, path)
}
fn find_node<'a>(node: &'a StructNode, path: &str) -> Option<&'a StructNode> {
    if node.path == path {
        return Some(node);
    }
    for child in &node.children {
        if let Some(found) = find_node(child, path) {
            return Some(found);
        }
    }
    None
}

/// Tiny ordered-by-insertion map, only what we need for value grouping.
mod indexmap_lite {
    pub struct Map {
        order: Vec<u32>,
        data:  std::collections::HashMap<u32, Vec<String>>,
    }
    impl Map {
        pub fn new() -> Self {
            Self { order: Vec::new(), data: std::collections::HashMap::new() }
        }
        pub fn entry(&mut self, key: u32) -> EntryRef<'_> {
            if !self.data.contains_key(&key) {
                self.order.push(key);
                self.data.insert(key, Vec::new());
            }
            EntryRef { vec: self.data.get_mut(&key).expect("inserted above") }
        }
        pub fn into_values(self) -> Vec<Vec<String>> {
            self.order.into_iter().map(|k| self.data.get(&k).cloned().unwrap_or_default()).collect()
        }
    }
    pub struct EntryRef<'a> { pub vec: &'a mut Vec<String> }
    impl EntryRef<'_> {
        pub fn push(&mut self, v: String) { self.vec.push(v); }
    }
}
