//! Bounded, data-only enum loader. No preprocessor/compiler or header code runs.
use std::collections::BTreeMap;

pub(super) const MAX_ENUM_TAGS: usize = 16_384;
const MAX_HEADER_BYTES: usize = 512 * 1024;
const MAX_TOKENS: usize = 65_536;

pub(super) struct HeaderSource {
    pub(super) module: &'static str,
    pub(super) generation: u8,
    pub(super) version: u32,
    pub(super) signature: Option<u32>,
    pub(super) path: &'static str,
    pub(super) text: &'static str,
}

include!(concat!(env!("OUT_DIR"), "/mtk_headers.rs"));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SelectionError {
    Missing,
    Ambiguous,
    Invalid,
}

pub(super) fn select(
    module: &str,
    generation: u8,
    version: u32,
    signature: Option<u32>,
) -> Result<(&'static str, Vec<&'static str>), SelectionError> {
    select_from(HEADER_SOURCES, module, generation, version, signature)
}

fn select_from(
    sources: &[HeaderSource],
    module: &str,
    generation: u8,
    version: u32,
    signature: Option<u32>,
) -> Result<(&'static str, Vec<&'static str>), SelectionError> {
    let candidates: Vec<_> = sources
        .iter()
        .filter(|source| {
            source.module == module && source.generation == generation && source.version == version
        })
        .collect();
    if candidates.is_empty() {
        return Err(SelectionError::Missing);
    }
    // An explicit signature variant takes precedence over its shared header.
    // Without a signature a shared header plus variants is not a unique layout.
    if signature.is_none() && candidates.iter().any(|source| source.signature.is_some()) {
        return Err(SelectionError::Ambiguous);
    }
    let variants: Vec<_> = candidates
        .iter()
        .copied()
        .filter(|source| source.signature.is_some() && source.signature == signature)
        .collect();
    let eligible: Vec<_> = if variants.is_empty() {
        candidates
            .into_iter()
            .filter(|source| source.signature.is_none())
            .collect()
    } else {
        variants
    };
    let preferred: Vec<_> = eligible
        .iter()
        .copied()
        .filter(|source| source.path.ends_with(".h"))
        .collect();
    let preferred = if preferred.is_empty() {
        eligible
    } else {
        preferred
    };
    if preferred.len() != 1 {
        return Err(if preferred.is_empty() {
            SelectionError::Missing
        } else {
            SelectionError::Ambiguous
        });
    }
    let source = preferred[0];
    let tags = load_enum(source.text, signature)?;
    Ok((source.path, tags))
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

#[derive(Clone, Copy)]
struct Frame {
    parent: bool,
    matched: bool,
    seen_else: bool,
}

fn condition(expression: &str, signature: Option<u32>) -> Result<bool, SelectionError> {
    let expression = expression.trim();
    let tail = expression
        .strip_prefix("MTK_EXIF_SIGNATURE")
        .ok_or(SelectionError::Invalid)?
        .trim();
    let (equal, literal) = if let Some(value) = tail.strip_prefix("==") {
        (true, value)
    } else if let Some(value) = tail.strip_prefix("!=") {
        (false, value)
    } else {
        return Err(SelectionError::Invalid);
    };
    let expected = integer(literal.trim())
        .and_then(|value| u32::try_from(value).ok())
        .ok_or(SelectionError::Invalid)?;
    let signature = signature.ok_or(SelectionError::Ambiguous)?;
    Ok((signature == expected) == equal)
}

fn tokens(text: &'static str, signature: Option<u32>) -> Result<Vec<&'static str>, SelectionError> {
    if text.len() > MAX_HEADER_BYTES {
        return Err(SelectionError::Invalid);
    }
    let mut result = Vec::new();
    let mut frames: Vec<Frame> = Vec::new();
    let mut active = true;
    let mut comment = false;
    let mut guard = None;
    let mut awaiting_guard = false;
    for line in text.trim_start_matches('\u{feff}').lines() {
        let trimmed = line.trim();
        if !comment && trimmed.starts_with('#') {
            let directive = trimmed[1..].trim_start();
            let (name, expression) = directive
                .split_once(char::is_whitespace)
                .unwrap_or((directive, ""));
            let expression = expression.split("//").next().unwrap_or("").trim();
            match name {
                "ifndef"
                    if guard.is_none()
                        && frames.is_empty()
                        && result.is_empty()
                        && is_identifier(expression) =>
                {
                    guard = Some(expression);
                    awaiting_guard = true;
                    frames.push(Frame {
                        parent: active,
                        matched: true,
                        seen_else: false,
                    });
                }
                "define" if awaiting_guard && guard == Some(expression) => {
                    awaiting_guard = false;
                }
                "if" if !awaiting_guard && frames.len() < 16 => {
                    let matched = condition(expression, signature)?;
                    frames.push(Frame {
                        parent: active,
                        matched,
                        seen_else: false,
                    });
                    active &= matched;
                }
                "else" if !awaiting_guard && expression.is_empty() => {
                    let frame = frames.last_mut().ok_or(SelectionError::Invalid)?;
                    if frame.seen_else {
                        return Err(SelectionError::Invalid);
                    }
                    frame.seen_else = true;
                    active = frame.parent && !frame.matched;
                }
                "endif" if !awaiting_guard && expression.is_empty() => {
                    active = frames.pop().ok_or(SelectionError::Invalid)?.parent;
                }
                _ => return Err(SelectionError::Invalid),
            }
            continue;
        }
        let bytes = line.as_bytes();
        let mut position = 0;
        while position < bytes.len() {
            if comment {
                if position + 1 < bytes.len() && &bytes[position..position + 2] == b"*/" {
                    comment = false;
                    position += 2;
                } else {
                    position += 1;
                }
                continue;
            }
            if bytes[position].is_ascii_whitespace() {
                position += 1;
                continue;
            }
            if bytes[position..].starts_with(b"//") {
                break;
            }
            if bytes[position..].starts_with(b"/*") {
                comment = true;
                position += 2;
                continue;
            }
            if !active {
                position += 1;
                continue;
            }
            if awaiting_guard || !bytes[position].is_ascii() {
                return Err(SelectionError::Invalid);
            }
            let start = position;
            position += 1;
            if bytes[start].is_ascii_alphanumeric() || bytes[start] == b'_' {
                while position < bytes.len()
                    && (bytes[position].is_ascii_alphanumeric() || bytes[position] == b'_')
                {
                    position += 1;
                }
            } else if matches!(bytes[start], b'<' | b'>')
                && bytes.get(position) == Some(&bytes[start])
            {
                position += 1;
            }
            result.push(&line[start..position]);
            if result.len() > MAX_TOKENS {
                return Err(SelectionError::Invalid);
            }
        }
    }
    if comment || !frames.is_empty() || awaiting_guard {
        return Err(SelectionError::Invalid);
    }
    Ok(result)
}

fn integer(value: &str) -> Option<i64> {
    let value = value.trim_end_matches(['u', 'U', 'l', 'L']);
    if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        i64::from_str_radix(hex, 16).ok()
    } else {
        value.parse().ok()
    }
}

fn precedence(token: &str) -> Option<u8> {
    match token {
        "|" => Some(1),
        "^" => Some(2),
        "&" => Some(3),
        "<<" | ">>" => Some(4),
        "+" | "-" => Some(5),
        "*" => Some(6),
        _ => None,
    }
}

fn expression(
    input: &[&str],
    cursor: &mut usize,
    symbols: &BTreeMap<&str, i64>,
    minimum: u8,
    depth: usize,
) -> Option<i64> {
    if depth > 32 {
        return None;
    }
    let token = *input.get(*cursor)?;
    *cursor += 1;
    let mut left = match token {
        "+" => expression(input, cursor, symbols, 7, depth + 1)?,
        "-" => expression(input, cursor, symbols, 7, depth + 1)?.checked_neg()?,
        "~" => !expression(input, cursor, symbols, 7, depth + 1)?,
        "(" => {
            let value = expression(input, cursor, symbols, 1, depth + 1)?;
            if input.get(*cursor) != Some(&")") {
                return None;
            }
            *cursor += 1;
            value
        }
        _ => integer(token).or_else(|| symbols.get(token).copied())?,
    };
    while let Some(&operator) = input.get(*cursor) {
        let Some(priority) = precedence(operator) else {
            break;
        };
        if priority < minimum {
            break;
        }
        *cursor += 1;
        let right = expression(input, cursor, symbols, priority + 1, depth + 1)?;
        left = match operator {
            "+" => left.checked_add(right)?,
            "-" => left.checked_sub(right)?,
            "*" => left.checked_mul(right)?,
            "|" => left | right,
            "&" => left & right,
            "^" => left ^ right,
            "<<" if (0..64).contains(&right) => {
                i64::try_from(i128::from(left) << right as u32).ok()?
            }
            ">>" if (0..64).contains(&right) => left >> right as u32,
            _ => return None,
        };
    }
    Some(left)
}

pub(super) fn load_enum(
    text: &'static str,
    signature: Option<u32>,
) -> Result<Vec<&'static str>, SelectionError> {
    let input = tokens(text, signature)?;
    let mut cursor = 0;
    let mut symbols = BTreeMap::new();
    let mut names = BTreeMap::new();
    let mut found = false;
    while cursor < input.len() {
        if input[cursor] != "enum" {
            cursor += 1;
            continue;
        }
        found = true;
        cursor += 1;
        if input.get(cursor).is_some_and(|token| is_identifier(token)) {
            cursor += 1;
        }
        if input.get(cursor) != Some(&"{") {
            return Err(SelectionError::Invalid);
        }
        cursor += 1;
        let mut index = 0i64;
        loop {
            let name = *input.get(cursor).ok_or(SelectionError::Invalid)?;
            cursor += 1;
            if name == "}" {
                break;
            }
            if !is_identifier(name) || symbols.contains_key(name) {
                return Err(SelectionError::Invalid);
            }
            if input.get(cursor) == Some(&"=") {
                cursor += 1;
                let end = input[cursor..]
                    .iter()
                    .position(|token| matches!(*token, "," | "}"))
                    .map(|offset| cursor + offset)
                    .ok_or(SelectionError::Invalid)?;
                if end - cursor > 128 {
                    return Err(SelectionError::Invalid);
                }
                index = expression(&input[..end], &mut cursor, &symbols, 1, 0)
                    .ok_or(SelectionError::Invalid)?;
                if cursor != end {
                    return Err(SelectionError::Invalid);
                }
            }
            if !(0..MAX_ENUM_TAGS as i64).contains(&index)
                || names.insert(index as usize, name).is_some()
            {
                return Err(SelectionError::Invalid);
            }
            symbols.insert(name, index);
            index += 1;
            match input.get(cursor) {
                Some(&",") => cursor += 1,
                Some(&"}") => {
                    cursor += 1;
                    break;
                }
                _ => return Err(SelectionError::Invalid),
            }
        }
    }
    if !found {
        return Err(SelectionError::Invalid);
    }
    let mut tags = vec![""; names.last_key_value().map_or(0, |(index, _)| index + 1)];
    for (index, name) in names {
        tags[index] = name;
    }
    Ok(tags)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_embedded_resources_have_bounded_valid_enums() {
        assert!(HEADER_SOURCES.len() > 300 && HEADER_SOURCES.len() <= 512);
        assert!(
            HEADER_SOURCES
                .iter()
                .map(|source| source.text.len())
                .sum::<usize>()
                <= 32 * 1024 * 1024
        );
        // Preserve malformed upstream definitions as evidence, but never decode
        // them by silently shifting/overwriting names. New failures need review.
        let invalid = [
            "AWB/AWB_6_10_9.h",
            "ISP/ISP_6_18_0.h",
            "ISP/ISP_6_18_1.h",
            "ISP/ISP_6_18_2.h",
            "ISP/ISP_6_18_3.h",
            "MF/MF_5_9_1.h",
            "MF/MF_6_9_1.h",
            "N3D/N3D_5_2_0.h",
            "N3D/N3D_6_2_0.h",
            "RESVA/RESVA_5_3_1.h",
            "RESVA/RESVA_6_3_1.h",
            "STROBE/STROBE_5_1_1.h",
            "STROBE/STROBE_6_1_1.h",
        ];
        for source in HEADER_SOURCES {
            if invalid.contains(&source.path) {
                assert_eq!(
                    load_enum(source.text, Some(0)),
                    Err(SelectionError::Invalid),
                    "{}",
                    source.path
                );
                continue;
            }
            let tags = load_enum(source.text, source.signature.or(Some(0)))
                .unwrap_or_else(|error| panic!("{}: {error:?}", source.path));
            assert!(tags.len() <= MAX_ENUM_TAGS);
            if source.text.contains("MTK_EXIF_SIGNATURE") {
                assert!(load_enum(source.text, Some(0xa56121c4)).is_ok());
                assert_eq!(load_enum(source.text, None), Err(SelectionError::Ambiguous));
            }
        }
    }

    fn fixture(path: &'static str, version: u32, signature: Option<u32>) -> HeaderSource {
        HeaderSource {
            module: "AE",
            generation: 6,
            version,
            signature,
            path,
            text: "enum { VERSION, VALUE };",
        }
    }

    #[test]
    fn exact_header_priority_rejects_duplicate_candidates_and_never_picks_a_newer_version() {
        let sources = [
            fixture("AE/AE_6_1_0.ha", 1, None),
            fixture("AE/AE_6_1_0.h", 1, None),
            fixture("AE/AE_6_2_0.h", 2, None),
        ];
        assert_eq!(
            select_from(&sources, "AE", 6, 1, None).unwrap().0,
            "AE/AE_6_1_0.h"
        );
        assert_eq!(
            select_from(&sources, "AE", 6, 3, None),
            Err(SelectionError::Missing)
        );
        assert_eq!(
            select_from(&sources, "AE", 5, 1, None),
            Err(SelectionError::Missing)
        );
        let duplicate = [
            fixture("AE/AE_6_1_0.h", 1, None),
            fixture("AE/AE_6_1_0.h", 1, None),
        ];
        assert_eq!(
            select_from(&duplicate, "AE", 6, 1, None),
            Err(SelectionError::Ambiguous)
        );
        let variant = [
            fixture("AE/AE_6_1_0.h", 1, None),
            fixture("AE/variants/00000001/AE_6_1_0.h", 1, Some(1)),
        ];
        assert_eq!(
            select_from(&variant, "AE", 6, 1, Some(1)).unwrap().0,
            "AE/variants/00000001/AE_6_1_0.h"
        );
        assert_eq!(
            select_from(&variant, "AE", 6, 1, None),
            Err(SelectionError::Ambiguous)
        );
    }

    #[test]
    fn conditionals_comments_guards_and_bounded_arithmetic_are_data_only() {
        let text = "#ifndef EXIF_H\n#define EXIF_H\n/*enum { bad };*/\nenum A { ZERO=0,\n#if MTK_EXIF_SIGNATURE != 0xA56121C4\nONE,\n#else\nSAMSUNG,\n#endif\nTHIRD=(ZERO + 1) << 1, LAST };\n#endif\n";
        assert_eq!(
            load_enum(text, Some(0)),
            Ok(vec!["ZERO", "ONE", "THIRD", "LAST"])
        );
        assert_eq!(
            load_enum(text, Some(0xa56121c4)),
            Ok(vec!["ZERO", "SAMSUNG", "THIRD", "LAST"])
        );
        for bad in [
            "enum A { X=run() };",
            "enum A { X=0, Y=0 };",
            "enum A { X=-1 };",
            "enum A { X=1<<64 };",
            "#include <file>\nenum A { X };",
            "#if OTHER\nenum A { X };\n#endif",
            "enum A { X=0, X=1 };",
            "enum A { X=16384 };",
            "#if MTK_EXIF_SIGNATURE == 1\nenum A { X };",
        ] {
            assert!(load_enum(bad, Some(0)).is_err(), "{bad}");
        }
    }
}
