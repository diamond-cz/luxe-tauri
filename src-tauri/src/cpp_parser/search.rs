//! Comment / value / line / range search — ports of the search_* methods in
//! the Python TreeSitterCppParser.

use serde::Serialize;

use super::types::{FieldEntry, ParseResult, StructNode};

pub fn search_by_comment<'a>(
    res: &'a ParseResult,
    keyword: &str,
    case_sensitive: bool,
) -> Vec<&'a FieldEntry> {
    if case_sensitive {
        res.fields.iter().filter(|f| f.comment.contains(keyword)).collect()
    } else {
        let kw = keyword.to_lowercase();
        res.fields.iter().filter(|f| f.comment.to_lowercase().contains(&kw)).collect()
    }
}

pub fn search_by_value<'a>(res: &'a ParseResult, value: &str) -> Vec<&'a FieldEntry> {
    res.fields.iter().filter(|f| f.value == value).collect()
}

pub fn get_fields_by_line<'a>(res: &'a ParseResult, line: u32) -> Vec<&'a FieldEntry> {
    res.fields.iter().filter(|f| f.line == line).collect()
}

pub fn get_fields_in_range<'a>(
    res: &'a ParseResult,
    start_line: u32,
    end_line: u32,
) -> Vec<&'a FieldEntry> {
    res.fields
        .iter()
        .filter(|f| f.line >= start_line && f.line <= end_line)
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct SectionInfo {
    pub path:        String,
    pub comment:     String,
    pub line_start:  u32,
    pub line_end:    u32,
    pub value_count: usize,
    pub child_count: usize,
}

pub fn get_section_names(res: &ParseResult) -> Vec<SectionInfo> {
    let mut acc = Vec::new();
    collect(&res.tree, &mut acc);
    acc
}
fn collect(node: &StructNode, acc: &mut Vec<SectionInfo>) {
    if !node.section_comment.is_empty() {
        acc.push(SectionInfo {
            path:        node.path.clone(),
            comment:     node.section_comment.clone(),
            line_start:  node.line_start,
            line_end:    node.line_end,
            value_count: node.values.len(),
            child_count: node.children.len(),
        });
    }
    for c in &node.children {
        collect(c, acc);
    }
}
