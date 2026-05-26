//! Resolve `[card_source.<CardName>]` from Isp6s.toml into concrete
//! `(line_ranges, jump_line)` instructions for the source code preview view.
//!
//! Mirrors the Python lookup pattern used by `Isp6sAebasicVisual._jump_to_source_for_card`:
//! - `keywords`     — substring or `re:<pattern>` regex on the raw source lines
//! - `paths`        — tree-sitter dotted paths, resolved via cpp_parser
//! - `line_ranges`  — hard-coded `[[start, end], ...]`
//!
//! Common options: `context` ∈ {"block","line", <int>}, `jump_to` ∈ {"first","min"},
//! `highlight` ∈ {"ranges","union"}.

use std::path::Path;

use regex::Regex;
use serde::{Deserialize, Serialize};

use super::path_query;
use super::types::ParseResult;
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardSourceSpec {
    #[serde(default)] pub keywords:    Vec<String>,
    #[serde(default)] pub paths:       Vec<String>,
    #[serde(default)] pub line_ranges: Vec<[u32; 2]>,
    /// "block" | "line" | <int>  (default "block")
    #[serde(default = "default_context")]
    pub context:   toml::Value,
    /// "first" | "min"  (default "first")
    #[serde(default = "default_jump_to")]
    pub jump_to:   String,
    /// "ranges" | "union" (default "ranges")
    #[serde(default = "default_highlight")]
    pub highlight: String,
}

impl Default for CardSourceSpec {
    fn default() -> Self {
        Self {
            keywords:    Vec::new(),
            paths:       Vec::new(),
            line_ranges: Vec::new(),
            context:     default_context(),
            jump_to:     default_jump_to(),
            highlight:   default_highlight(),
        }
    }
}

fn default_context()   -> toml::Value { toml::Value::String("block".into()) }
fn default_jump_to()   -> String      { "first".into() }
fn default_highlight() -> String      { "ranges".into() }

#[derive(Debug, Clone, Serialize)]
pub struct CardSourceHit {
    /// One or many (start, end) — 1-indexed inclusive line ranges.
    pub ranges:        Vec<[u32; 2]>,
    /// The line to scroll to (1-indexed).
    pub jump_line:     u32,
    /// "ranges" (highlight each range separately) or "union" (merge into one).
    pub highlight:     String,
}

/// Resolve the spec against the parsed AE.cpp + on-disk source.
pub fn resolve(
    cpp_path:  &Path,
    parsed:    &ParseResult,
    spec:      &CardSourceSpec,
) -> AppResult<CardSourceHit> {
    let source = std::fs::read_to_string(cpp_path)?;
    let lines: Vec<&str> = source.lines().collect();

    let mut ranges: Vec<[u32; 2]> = Vec::new();

    // ── ① keywords ─────────────────────────────────────────────
    if !spec.keywords.is_empty() {
        let ctx_kind = ContextKind::parse(&spec.context);
        for kw in &spec.keywords {
            let hits = scan_lines(&lines, kw);
            for hit_line in hits {
                let r = expand_context(&lines, hit_line, &ctx_kind);
                push_unique(&mut ranges, r);
            }
        }
    }

    // ── ② paths ────────────────────────────────────────────────
    for p in &spec.paths {
        let fields = path_query::get_fields_at_path(parsed, p);
        if fields.is_empty() {
            continue;
        }
        // Group by contiguous line span so each call site becomes one range.
        let mut ln: Vec<u32> = fields.iter().map(|f| f.line).collect();
        ln.sort_unstable();
        ln.dedup();
        if ln.is_empty() { continue; }
        // For paths we always span from min..=max as one block.
        let r = [*ln.first().unwrap(), *ln.last().unwrap()];
        push_unique(&mut ranges, r);
    }

    // ── ③ line_ranges (verbatim) ───────────────────────────────
    for r in &spec.line_ranges {
        push_unique(&mut ranges, *r);
    }

    if ranges.is_empty() {
        ranges.push([1, 1]);
    }
    ranges.sort_by_key(|r| r[0]);

    // ── jump_to ────────────────────────────────────────────────
    let jump_line = match spec.jump_to.as_str() {
        "min" => ranges.iter().map(|r| r[0]).min().unwrap_or(1),
        _     => ranges[0][0], // "first"
    };

    // ── highlight policy ──────────────────────────────────────
    let final_ranges = match spec.highlight.as_str() {
        "union" => merge_overlapping(ranges.clone()),
        _       => ranges, // "ranges"
    };

    Ok(CardSourceHit {
        ranges:    final_ranges,
        jump_line,
        highlight: spec.highlight.clone(),
    })
}

#[derive(Debug, Clone)]
enum ContextKind {
    Line,
    Block,           // expand to surrounding {...} braces (best-effort)
    Span(u32),       // n lines forward
}
impl ContextKind {
    fn parse(v: &toml::Value) -> Self {
        match v {
            toml::Value::String(s) if s == "line"  => ContextKind::Line,
            toml::Value::String(s) if s == "block" => ContextKind::Block,
            toml::Value::Integer(n) if *n > 0      => ContextKind::Span(*n as u32),
            _                                      => ContextKind::Block,
        }
    }
}

fn scan_lines(lines: &[&str], keyword: &str) -> Vec<u32> {
    let mut hits = Vec::new();
    if let Some(pat) = keyword.strip_prefix("re:") {
        if let Ok(re) = Regex::new(pat) {
            for (i, line) in lines.iter().enumerate() {
                if re.is_match(line) {
                    hits.push((i + 1) as u32);
                }
            }
        }
    } else {
        for (i, line) in lines.iter().enumerate() {
            if line.contains(keyword) {
                hits.push((i + 1) as u32);
            }
        }
    }
    hits
}

fn expand_context(lines: &[&str], hit_line: u32, kind: &ContextKind) -> [u32; 2] {
    match kind {
        ContextKind::Line => [hit_line, hit_line],
        ContextKind::Span(n) => {
            let end = (hit_line + n - 1).min(lines.len() as u32);
            [hit_line, end]
        }
        ContextKind::Block => {
            // Walk forward + backward looking for the enclosing {/} pair.
            let total = lines.len() as u32;
            let start = find_block_start(lines, hit_line).unwrap_or(hit_line);
            let end   = find_block_end(lines,   hit_line).unwrap_or(hit_line);
            [start.max(1), end.min(total)]
        }
    }
}

/// Walk backward counting balanced `{` / `}` until we find the opening `{`
/// that contains the hit line.
fn find_block_start(lines: &[&str], hit_line: u32) -> Option<u32> {
    let mut depth: i32 = 0;
    let start_idx = (hit_line as usize).saturating_sub(1);
    for (offset, line) in lines[..=start_idx].iter().enumerate().rev() {
        for ch in line.chars().rev() {
            match ch {
                '}' => depth += 1,
                '{' => {
                    if depth == 0 {
                        return Some((offset + 1) as u32);
                    }
                    depth -= 1;
                }
                _ => {}
            }
        }
    }
    None
}

fn find_block_end(lines: &[&str], hit_line: u32) -> Option<u32> {
    let mut depth: i32 = 0;
    let start_idx = (hit_line as usize).saturating_sub(1);
    for (offset, line) in lines.iter().enumerate().skip(start_idx) {
        for ch in line.chars() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    if depth == 0 {
                        return Some((offset + 1) as u32);
                    }
                    depth -= 1;
                }
                _ => {}
            }
        }
    }
    None
}

fn push_unique(ranges: &mut Vec<[u32; 2]>, r: [u32; 2]) {
    if !ranges.iter().any(|x| x == &r) {
        ranges.push(r);
    }
}

fn merge_overlapping(mut ranges: Vec<[u32; 2]>) -> Vec<[u32; 2]> {
    ranges.sort_by_key(|r| r[0]);
    let mut merged: Vec<[u32; 2]> = Vec::new();
    for r in ranges {
        if let Some(last) = merged.last_mut() {
            if r[0] <= last[1] + 1 {
                last[1] = last[1].max(r[1]);
                continue;
            }
        }
        merged.push(r);
    }
    merged
}
