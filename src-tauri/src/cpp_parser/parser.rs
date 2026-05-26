//! tree-sitter-c based parser — direct port of hiz's `TreeSitterCppParser`.
//!
//! Walks the AST exactly the same way as the Python version so paths produced
//! here match `test_ae_cpp.py` outputs byte-for-byte.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use tree_sitter::{Node, Parser, Tree};

use super::types::{CommentEntry, FieldEntry, MacroEntry, ParseResult, StructNode};
use crate::error::{AppError, AppResult};

/// Parse `file_path` and produce the `ParseResult`.
pub fn parse_file(file_path: &Path) -> AppResult<ParseResult> {
    let canon = fs::canonicalize(file_path)
        .map_err(|err| AppError::Path(format!("canonicalize {file_path:?}: {err}")))?;
    let source = fs::read_to_string(&canon)?;
    parse_source(&canon.to_string_lossy(), &source)
}

pub fn parse_source(file_label: &str, source: &str) -> AppResult<ParseResult> {
    let mut parser = Parser::new();
    let lang: tree_sitter::Language = tree_sitter_c::language();
    parser
        .set_language(&lang)
        .map_err(|err| AppError::Other(format!("tree-sitter set_language: {err}")))?;
    let tree = parser
        .parse(source.as_bytes(), None)
        .ok_or_else(|| AppError::Other("tree-sitter returned no tree".into()))?;

    let mut ctx = ParseContext::new(source, &tree);

    ctx.collect_comments(tree.root_node());
    ctx.collect_preprocessor(tree.root_node());
    let (var_name, var_type, struct_tree) = ctx.parse_declarations(tree.root_node());

    Ok(ParseResult {
        file:     file_label.to_string(),
        var_name,
        var_type,
        fields:   ctx.fields,
        tree:     struct_tree.unwrap_or_else(StructNode::empty),
        comments: ctx.comments,
        includes: ctx.includes,
        macros:   ctx.macros,
    })
}

struct ParseContext<'a> {
    source:        &'a str,
    lines:         Vec<&'a str>,
    line_comments: BTreeMap<u32, String>,
    comments:      Vec<CommentEntry>,
    includes:      Vec<String>,
    macros:        Vec<MacroEntry>,
    fields:        Vec<FieldEntry>,
}

impl<'a> ParseContext<'a> {
    fn new(source: &'a str, _tree: &Tree) -> Self {
        Self {
            source,
            lines:         source.lines().collect(),
            line_comments: BTreeMap::new(),
            comments:      Vec::new(),
            includes:      Vec::new(),
            macros:        Vec::new(),
            fields:        Vec::new(),
        }
    }

    fn node_text(&self, node: Node<'_>) -> String {
        node.utf8_text(self.source.as_bytes())
            .unwrap_or("")
            .to_owned()
    }

    // ── Pass 1: comments ───────────────────────────────────────────────
    fn collect_comments(&mut self, root: Node<'_>) {
        let mut cursor = root.walk();
        walk(&mut cursor, &mut |n| {
            if n.kind() == "comment" {
                let raw = self.node_text(n);
                let trimmed = raw.trim();
                let cleaned = if let Some(rest) = trimmed.strip_prefix("//") {
                    rest.trim().to_owned()
                } else if let Some(inner) = trimmed.strip_prefix("/*").and_then(|s| s.strip_suffix("*/")) {
                    inner.trim().to_owned()
                } else {
                    trimmed.to_owned()
                };
                let line = (n.start_position().row + 1) as u32;
                self.line_comments.insert(line, cleaned.clone());
                self.comments.push(CommentEntry {
                    line,
                    text: cleaned,
                    raw,
                });
            }
        });
    }

    // ── Pass 2: includes & macros ─────────────────────────────────────
    fn collect_preprocessor(&mut self, root: Node<'_>) {
        let mut cursor = root.walk();
        for child in root.children(&mut cursor) {
            match child.kind() {
                "preproc_include" => {
                    if let Some(path) = child.child_by_field_name("path") {
                        self.includes.push(self.node_text(path));
                    }
                }
                "preproc_def" => {
                    let name = child.child_by_field_name("name").map(|n| self.node_text(n));
                    let value = child.child_by_field_name("value").map(|n| self.node_text(n));
                    if let Some(name) = name {
                        self.macros.push(MacroEntry {
                            name,
                            value: value.unwrap_or_default(),
                        });
                    }
                }
                _ => {}
            }
        }
    }

    // ── Pass 3: variable declarations + nested structure ──────────────
    fn parse_declarations(&mut self, root: Node<'_>) -> (String, String, Option<StructNode>) {
        let mut var_name = String::new();
        let mut var_type = String::new();
        let mut tree: Option<StructNode> = None;

        let mut cursor = root.walk();
        for child in root.children(&mut cursor) {
            if child.kind() != "declaration" {
                continue;
            }
            // Same heuristics as Python:_parse_one_declaration — we keep the
            // FIRST declaration that carries an initializer_list (matches the
            // Python loop, which overwrites and ends up with the last one).
            // To stay faithful, accept overwrites too.
            let cur_type = child
                .child_by_field_name("type")
                .map(|n| self.node_text(n))
                .unwrap_or_default();
            let Some(declarator) = child.child_by_field_name("declarator") else { continue };
            let cur_name = extract_declarator_name(declarator, self.source);
            let init_node = find_descendant(declarator, "initializer_list").or_else(|| {
                declarator
                    .child_by_field_name("value")
                    .filter(|n| n.kind() == "initializer_list")
            });
            let Some(init) = init_node else { continue };

            var_type = cur_type;
            var_name = cur_name;
            tree = Some(self.parse_init_list(init, String::new(), 0));
        }
        (var_name, var_type, tree)
    }

    fn parse_init_list(&mut self, node: Node<'_>, path: String, depth: u32) -> StructNode {
        let line_start = (node.start_position().row + 1) as u32;
        let line_end   = (node.end_position().row   + 1) as u32;
        let section_comment = self.section_comment_for(line_start);

        let path_str = if path.is_empty() { "[root]".to_string() } else { path.clone() };
        let mut sn = StructNode {
            path: path_str,
            depth,
            line_start,
            line_end,
            section_comment,
            values:   Vec::new(),
            children: Vec::new(),
        };

        let mut child_idx: u32 = 0;
        let mut value_idx: u32 = 0;

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            let kind = child.kind();
            match kind {
                "{" | "}" | "," | "comment" => continue,
                "initializer_list" => {
                    let child_path = format!("{path}[{child_idx}]");
                    let sub = self.parse_init_list(child, child_path, depth + 1);
                    sn.children.push(sub);
                    child_idx += 1;
                }
                _ => {
                    let val_text = self.node_text(child);
                    let val_line = (child.start_position().row + 1) as u32;
                    let val_type = classify_value(kind);
                    let comment = self.line_comments.get(&val_line).cloned().unwrap_or_default();
                    let entry = FieldEntry {
                        path: format!("{path}.{value_idx}"),
                        value: val_text,
                        comment,
                        line: val_line,
                        depth,
                        index: value_idx,
                        value_type: val_type,
                    };
                    sn.values.push(entry.clone());
                    self.fields.push(entry);
                    value_idx += 1;
                }
            }
        }
        sn
    }

    /// Mirror of `_get_section_comment`: consecutive comment lines immediately
    /// above `line`, joined with " | ". Also probes one blank line back, like
    /// the Python version does.
    fn section_comment_for(&self, line: u32) -> String {
        if line <= 1 { return String::new(); }
        let mut comments: Vec<String> = Vec::new();
        let mut check = line - 1;
        while check > 0 {
            if let Some(c) = self.line_comments.get(&check) {
                comments.insert(0, c.clone());
                check = check.saturating_sub(1);
            } else {
                break;
            }
        }
        if comments.is_empty() && check > 0 {
            let src_line = self.lines.get((check as usize).saturating_sub(1)).copied().unwrap_or("");
            if src_line.trim().is_empty() {
                let prev = check.saturating_sub(1);
                if prev > 0 {
                    if let Some(c) = self.line_comments.get(&prev) {
                        comments.insert(0, c.clone());
                    }
                }
            }
        }
        comments.join(" | ")
    }
}

fn classify_value(kind: &str) -> String {
    match kind {
        "number_literal"     => "number".into(),
        "true" | "false"     => "bool".into(),
        "identifier"         => "identifier".into(),
        "unary_expression"   => "unary".into(),
        "initializer_list"   => "init_list".into(),
        other                => other.into(),
    }
}

fn extract_declarator_name(node: Node<'_>, source: &str) -> String {
    if node.kind() == "identifier" {
        return node.utf8_text(source.as_bytes()).unwrap_or("").to_owned();
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        let name = extract_declarator_name(child, source);
        if !name.is_empty() {
            return name;
        }
    }
    String::new()
}

fn find_descendant<'a>(node: Node<'a>, kind: &str) -> Option<Node<'a>> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == kind {
            return Some(child);
        }
        if let Some(found) = find_descendant(child, kind) {
            return Some(found);
        }
    }
    None
}

/// Visit every node depth-first, invoking `f` on each.
fn walk(cursor: &mut tree_sitter::TreeCursor, f: &mut dyn FnMut(Node<'_>)) {
    loop {
        f(cursor.node());
        if cursor.goto_first_child() {
            walk(cursor, f);
            cursor.goto_parent();
        }
        if !cursor.goto_next_sibling() {
            break;
        }
    }
}
