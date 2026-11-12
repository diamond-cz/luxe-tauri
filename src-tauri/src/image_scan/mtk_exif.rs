//! Direct decoder for the MTK private JPEG EXIF blocks used by the image table.
//!
//! The decoder intentionally reads JPEG metadata only. It never decodes image
//! pixels, starts a child process, or keeps a directory-sized result in memory.
//! Enum headers are bundled under `resources/mtk_exif/headers/` and embedded by
//! the Rust build so the release package and development build use the same
//! version/signature mapping. Unsupported declarations are reported to the
//! caller so `DebugParser.exe` can be used as the compatibility fallback.

use super::{ImageExifModule, ImageExifTable};
use std::collections::BTreeMap;
use std::fmt::Write as _;

#[path = "mtk_ae_tables.rs"]
mod ae_tables;
#[path = "mtk_headers.rs"]
mod headers;

const APP5_MAGIC: [u8; 4] = [0xfb, 0xfa, 0xf9, 0xf8];
const APP6_MAGIC: [u8; 4] = [0x06, 0xf2, 0xf1, 0xf0];
const APP6_LEGACY_MAGIC: [u8; 4] = [0x05, 0xf2, 0xf1, 0xf0];
const APP7_MAGIC: [u8; 4] = [0xf7, 0xf6, 0xf5, 0xf4];
const MAX_MODULE_SCAN: usize = 0x600000;
const MAX_MODULE_DIAGNOSTICS: usize = 256;
const MAX_DIRECTORY_RECORDS: usize = MAX_MODULE_DIAGNOSTICS - Module::ALL.len();

const AE_SIGNATURE: u32 = 0xe28f_a520;
const AF_SIGNATURE: u32 = 0x3d1a_96da;
const AWB_SIGNATURE: u32 = 0xaad7_f62b;
const STROBE_SIGNATURE: u32 = 0x8091_7e7c;
const ISP_SIGNATURE: u32 = 0xdf19_2ca9;
const SHADING_SIGNATURE: u32 = 0x7df2_166b;
const COMMON_SIGNATURE: u32 = 0x8283_6b27;
const MFNR_SIGNATURE: u32 = 0xefca_adf1;

const LEGACY_AE_SIGNATURE: u32 = 0x3d52_e55b;
const LEGACY_AF_SIGNATURE: u32 = 0xf5e0_3fce;
const LEGACY_AWB_SIGNATURE: u32 = 0x9c6e_a856;
const LEGACY_ISP_SIGNATURE: u32 = 0xa5a5_a85e;
const LEGACY_MFNR_SIGNATURE: u32 = 0x7255_88a0;

const SAMSUNG_AE_SIGNATURE: u32 = 0x2983_7d58;
const SAMSUNG_AWB_SIGNATURE: u32 = 0x0943_e3df;
const SAMSUNG_ISP_SIGNATURE: u32 = 0xa561_21c4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Module {
    Ae,
    Af,
    Awb,
    Isp,
    Strobe,
    Shading,
    Common,
    Mfnr,
    N3d,
    Sensor,
    Swnr,
    Bmdn,
    String,
}

impl Module {
    const ALL: [Self; 13] = [
        Self::Ae,
        Self::Af,
        Self::Awb,
        Self::Isp,
        Self::Strobe,
        Self::Shading,
        Self::Common,
        Self::Mfnr,
        Self::N3d,
        Self::Sensor,
        Self::Swnr,
        Self::Bmdn,
        Self::String,
    ];

    fn section(self) -> &'static str {
        match self {
            Self::Ae => "AE",
            Self::Af => "AF",
            Self::Awb => "AWB",
            Self::Isp => "ISP",
            Self::Strobe => "Strobe",
            Self::Shading => "Shading",
            Self::Common => "Common",
            Self::Mfnr => "MFNR",
            Self::N3d => "N3D",
            Self::Sensor => "Sensor",
            Self::Swnr => "SWNR",
            Self::Bmdn => "BMDN",
            Self::String => "String",
        }
    }

    fn subdir(self) -> &'static str {
        match self {
            Self::Strobe => "STROBE",
            Self::Shading => "SHADING",
            Self::Common => "CMN",
            Self::Mfnr => "MF",
            Self::Sensor => "SENSOR",
            Self::Swnr => "RESVA",
            Self::Bmdn => "RESVB",
            Self::String => "STRING",
            _ => self.section(),
        }
    }

    fn can_decode(self, generation: u8) -> bool {
        !matches!(
            self,
            Self::N3d | Self::Sensor | Self::Swnr | Self::Bmdn | Self::String
        ) && (self != Self::Mfnr || generation == 5)
    }

    fn prefix(self) -> &'static str {
        match self {
            Self::Ae => "AE_TAG",
            Self::Af => "AF_TAG",
            Self::Awb => "AWB_TAG",
            Self::Isp => "ISP",
            Self::Strobe => "FL_T",
            Self::Shading => "SHAD",
            Self::Common => "CMN_TAG",
            Self::Mfnr => "MF_TAG",
            _ => self.subdir(),
        }
    }

    fn magic(self) -> [u8; 4] {
        match self {
            Self::Ae | Self::Af | Self::Strobe | Self::Shading => APP6_MAGIC,
            Self::Awb | Self::Isp => APP7_MAGIC,
            Self::Common
            | Self::Mfnr
            | Self::N3d
            | Self::Sensor
            | Self::Swnr
            | Self::Bmdn
            | Self::String => APP5_MAGIC,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Segment {
    magic: [u8; 4],
    start: usize,
    end: usize,
}

#[derive(Debug, Clone, Copy)]
struct Declaration {
    module: Option<Module>,
    version: u32,
    signature: u32,
    segment: Segment,
    payload: Option<Segment>,
    ambiguous: bool,
    inferred: bool,
}

struct HeaderSpec {
    module: Module,
    version: u32,
    path: &'static str,
    tags: Vec<&'static str>,
}

#[derive(Debug)]
pub(crate) struct DirectExifOutput {
    pub(crate) toml: String,
    pub(crate) needs_fallback: bool,
    pub(crate) ae_tables: Vec<ImageExifTable>,
    pub(crate) modules: Vec<ImageExifModule>,
}

// Only immutable header bytes are embedded globally. Enum vectors belong to
// this inspection and are dropped with it; no whole-catalog parse cache grows
// when a folder contains many versions/signatures.

fn jpeg_segments(data: &[u8]) -> Vec<Segment> {
    if data.len() < 2 || data[0..2] != [0xff, 0xd8] {
        return Vec::new();
    }

    let mut segments = Vec::new();
    let mut pos = 2usize;
    while pos.checked_add(4).is_some_and(|end| end <= data.len()) {
        if data[pos] != 0xff {
            break;
        }
        let marker = data[pos + 1];
        if matches!(marker, 0xd8 | 0xd9 | 0xda) {
            break;
        }
        let length = u16::from_be_bytes([data[pos + 2], data[pos + 3]]) as usize;
        if length < 2 {
            break;
        }
        let end = match pos
            .checked_add(2)
            .and_then(|value| value.checked_add(length))
        {
            Some(end) if end <= data.len() => end,
            _ => break,
        };
        let payload_start = pos + 4;
        if payload_start <= end {
            segments.push(Segment {
                magic: if end - payload_start >= 4 {
                    [
                        data[payload_start],
                        data[payload_start + 1],
                        data[payload_start + 2],
                        data[payload_start + 3],
                    ]
                } else {
                    [0; 4]
                },
                start: payload_start,
                end,
            });
        }
        pos = end;
    }
    segments
}

fn mtk_segments(data: &[u8]) -> Vec<Segment> {
    jpeg_segments(data)
        .into_iter()
        .filter(|segment| {
            segment.end.saturating_sub(segment.start) >= 4
                && matches!(
                    segment.magic,
                    APP5_MAGIC | APP6_MAGIC | APP6_LEGACY_MAGIC | APP7_MAGIC
                )
        })
        .collect()
}

fn format_generation(segments: &[Segment]) -> u8 {
    if segments
        .iter()
        .any(|segment| segment.magic == APP6_LEGACY_MAGIC)
    {
        5
    } else {
        6
    }
}

fn normalized_magic(magic: [u8; 4]) -> [u8; 4] {
    if magic == APP6_LEGACY_MAGIC {
        APP6_MAGIC
    } else {
        magic
    }
}

fn segment_for<'a>(segments: &'a [Segment], magic: [u8; 4]) -> Option<&'a Segment> {
    segments.iter().find(|segment| {
        segment.magic == magic || (magic == APP6_MAGIC && segment.magic == APP6_LEGACY_MAGIC)
    })
}

fn directory_ranges(data: &[u8], segments: &[Segment]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    for segment in segments {
        if segment.start + 8 > segment.end || segment.end > data.len() {
            continue;
        }
        let n_containers = read_u16(data, segment.start + 6).unwrap_or(0) as usize;
        if !(1..64).contains(&n_containers) {
            continue;
        }
        let cont0 = segment.start + 8 + n_containers * 4;
        if cont0 + 4 > segment.end {
            continue;
        }
        let remaining = segment.end - cont0;
        let by_header = read_u32(data, cont0).unwrap_or(0) as usize;
        if (4..=remaining).contains(&by_header) && (by_header - 4) % 32 == 0 {
            // Zero-valued words in the first real module are not additional
            // directory records. Never expand a valid, aligned directory.
            ranges.push((cont0, cont0 + by_header));
            continue;
        }

        let module_count = read_u16(data, segment.start + 4).unwrap_or(0) as usize;
        let by_count = 4 + module_count * 32;
        if (1..64).contains(&module_count) && by_count <= remaining {
            ranges.push((cont0, cont0 + by_count));
            continue;
        }

        // Older APP5 headers may not have either length indicator. This is a
        // bounded compatibility walk, not a license to scan an entire module.
        let record_limit = segment.end.min(cont0 + 4 + 63 * 32);
        let mut pos = cont0 + 4;
        while pos + 32 <= record_limit {
            let signature = read_u32(data, pos).unwrap_or(0);
            if signature == 0
                || matches!(
                    signature,
                    0x0100_0000 | 0x0200_0000 | 0x0300_0000 | 0x0400_0000 | 0x0600_0000
                )
                || (2..8)
                    .any(|index| read_u32(data, pos + index * 4).is_some_and(|value| value != 0))
            {
                break;
            }
            pos += 32;
        }
        ranges.push((cont0, pos));
    }
    ranges
}

fn module_payload_ranges(
    data: &[u8],
    segment: &Segment,
    directories: &[(usize, usize)],
) -> Vec<(usize, usize)> {
    let count = read_u16(data, segment.start + 6).unwrap_or(0) as usize;
    if !(1..64).contains(&count) || segment.start + 8 + count * 4 > segment.end {
        return Vec::new();
    }
    let Some((directory_start, directory_end)) = directories.iter().find(|(start, end)| {
        *start >= segment.start && *start < segment.end && *end <= segment.end
    }) else {
        return Vec::new();
    };
    if count == 1 {
        // Legacy single-module layouts have no closing offset. Only one
        // directory record can unambiguously own the remaining segment.
        return if *directory_end - *directory_start == 36 {
            vec![(*directory_end, segment.end)]
        } else {
            Vec::new()
        };
    }
    let minimum = *directory_end - segment.start;
    let length = segment.end - segment.start;
    let mut offsets = Vec::with_capacity(count);
    for index in 0..count {
        let Some(offset) =
            read_u32(data, segment.start + 8 + index * 4).map(|value| value as usize)
        else {
            return Vec::new();
        };
        if offset > length
            || (index == 0 && offset < minimum)
            || offsets.last().is_some_and(|previous| offset < *previous)
        {
            return Vec::new();
        }
        offsets.push(offset);
    }
    // Directory record i belongs to payload i. Preserve empty slots instead
    // of shifting every later module onto its predecessor's container.
    offsets
        .windows(2)
        .map(|pair| (segment.start + pair[0], segment.start + pair[1]))
        .collect()
}

fn in_ranges(position: usize, ranges: &[(usize, usize)]) -> bool {
    ranges
        .iter()
        .any(|(start, end)| *start <= position && position < *end)
}

fn module_for_signature(magic: [u8; 4], signature: u32, generation: u8) -> Option<Module> {
    let magic = normalized_magic(magic);
    let module = match (magic, signature) {
        (APP6_MAGIC, AE_SIGNATURE) => Module::Ae,
        (APP6_MAGIC, AF_SIGNATURE) => Module::Af,
        (APP7_MAGIC, AWB_SIGNATURE) => Module::Awb,
        (APP6_MAGIC, STROBE_SIGNATURE) => Module::Strobe,
        (APP7_MAGIC, ISP_SIGNATURE) => Module::Isp,
        (APP6_MAGIC, SHADING_SIGNATURE) => Module::Shading,
        (APP5_MAGIC, COMMON_SIGNATURE) => Module::Common,
        (APP5_MAGIC, MFNR_SIGNATURE) => Module::Mfnr,
        (APP6_MAGIC, LEGACY_AE_SIGNATURE) if generation == 5 => Module::Ae,
        (APP6_MAGIC, LEGACY_AF_SIGNATURE) if generation == 5 => Module::Af,
        (APP7_MAGIC, LEGACY_AWB_SIGNATURE) if generation == 5 => Module::Awb,
        (APP7_MAGIC, LEGACY_ISP_SIGNATURE) if generation == 5 => Module::Isp,
        (APP5_MAGIC, LEGACY_MFNR_SIGNATURE) if generation == 5 => Module::Mfnr,
        (APP6_MAGIC, SAMSUNG_AE_SIGNATURE) if generation == 6 => Module::Ae,
        (APP7_MAGIC, SAMSUNG_AWB_SIGNATURE) if generation == 6 => Module::Awb,
        (APP7_MAGIC, SAMSUNG_ISP_SIGNATURE | 0x31d4_d86c) if generation == 6 => Module::Isp,
        (APP7_MAGIC, 0x6a6d_f6c8) if generation == 6 => Module::Awb,
        (APP6_MAGIC, 0x8017_b393) if generation == 6 => Module::Shading,
        (APP5_MAGIC, 0x4a7d_8bbe) if generation == 6 => Module::Common,
        (APP5_MAGIC, 0xe787_3e3f) if generation == 6 => Module::Mfnr,
        (APP5_MAGIC, 0x084b_ab51) => Module::N3d,
        (APP5_MAGIC, 0xbce8_1af1) if generation == 5 => Module::N3d,
        (APP5_MAGIC, 0xbe62_9b07) => Module::Sensor,
        (APP5_MAGIC, 0x1507_1116) => Module::Swnr,
        (APP5_MAGIC, 0x545a_6206) => Module::Bmdn,
        _ => return None,
    };
    Some(module)
}

fn read_declarations(
    data: &[u8],
    segments: &[Segment],
    ranges: &[(usize, usize)],
    generation: u8,
) -> (Vec<Declaration>, bool) {
    let mut declarations: Vec<Declaration> = Vec::new();
    let mut has_unsupported_module = false;
    for segment in segments {
        let magic = normalized_magic(segment.magic);
        let payloads = module_payload_ranges(data, segment, ranges);
        for (directory_start, directory_end) in ranges {
            if *directory_start < segment.start
                || *directory_start >= segment.end
                || *directory_end > segment.end
            {
                continue;
            }
            let mut pos = *directory_start + 4;
            while pos + 32 <= *directory_end {
                if declarations.len() >= MAX_DIRECTORY_RECORDS {
                    // Bounded Detail payload even for a JPEG with many APP
                    // records. Never label a truncated inspection complete.
                    return (declarations, true);
                }
                let Some(signature) = read_u32(data, pos) else {
                    break;
                };
                let Some(version) = read_u32(data, pos + 4) else {
                    break;
                };
                let index = (pos - *directory_start - 4) / 32;
                let payload = payloads.get(index).map(|&(start, end)| Segment {
                    start,
                    end,
                    ..*segment
                });
                let recognized = module_for_signature(magic, signature, generation);
                let module = recognized
                    .or_else(|| infer_module(data, magic, version, signature, payload, generation));
                let mut ambiguous = false;
                if module.is_some() {
                    for existing in declarations
                        .iter_mut()
                        .filter(|entry| entry.module == module)
                    {
                        existing.ambiguous = true;
                        ambiguous = true;
                    }
                }
                // Retain all records (including unknown/duplicate declarations)
                // so Detail can report what the JPEG actually recorded.
                has_unsupported_module |=
                    ambiguous || module.is_none_or(|module| !module.can_decode(generation));
                declarations.push(Declaration {
                    module,
                    version,
                    signature,
                    segment: *segment,
                    payload,
                    ambiguous,
                    inferred: recognized.is_none() && module.is_some(),
                });
                pos += 32;
            }
        }
    }
    (declarations, has_unsupported_module)
}

fn declaration_for(declarations: &[Declaration], module: Module) -> Option<Declaration> {
    declarations
        .iter()
        .copied()
        .find(|entry| entry.module == Some(module))
}

// A new signature is not an enum identity. Infer only inside its own validated
// range, using a unique generation/version/layout candidate, never a segment-
// wide scan or a highest-version fallback.
fn infer_module(
    data: &[u8],
    magic: [u8; 4],
    version: u32,
    signature: u32,
    payload: Option<Segment>,
    generation: u8,
) -> Option<Module> {
    let payload = payload?;
    if payload.end > data.len() || payload.start.checked_add(16)? > payload.end {
        return None;
    }
    let key = read_u32(data, payload.start)?;
    let value = read_u32(data, payload.start + 4)?;
    let next = read_u32(data, payload.start + 8)?;
    let mut candidates = Vec::new();
    let kv = match (magic, generation, key) {
        (APP6_MAGIC, _, 0x0100_0000) => Some(Module::Ae),
        (APP6_MAGIC, _, 0x0200_0000) => Some(Module::Af),
        (APP6_MAGIC, _, 0x0400_0000) => Some(Module::Strobe),
        (APP6_MAGIC, _, 0x0600_0000) => Some(Module::Shading),
        (APP7_MAGIC, 5, 0x0300_0000) => Some(Module::Awb),
        (APP7_MAGIC, 5, 0x0400_0000) => Some(Module::Isp),
        _ => None,
    };
    if let Some(module) = kv {
        if value == version && next >> 24 == key >> 24 && next & 0xffff != 0 {
            candidates.push(module);
        }
    }
    if magic == APP7_MAGIC && generation == 6 {
        for module in [Module::Awb, Module::Isp] {
            let Ok(header) = resolve_header(module, generation, version, Some(signature), true)
            else {
                continue;
            };
            let label = if module == Module::Awb {
                "AWB_TAG_VERSION"
            } else {
                "IspTagVersion"
            };
            let Some(index) = header.tags.iter().position(|name| *name == label) else {
                continue;
            };
            if header.tags.len() * 4 <= payload.end - payload.start
                && read_u32(data, payload.start + index * 4) == Some(version)
            {
                candidates.push(module);
            }
        }
    }
    if magic == APP5_MAGIC && key == 0x0100_0000 {
        for module in [Module::Common, Module::Mfnr] {
            let Ok(header) = resolve_header(module, generation, version, Some(signature), true)
            else {
                continue;
            };
            let expected = if module == Module::Mfnr {
                version & 0xffff
            } else {
                version
            };
            let prefix = if module == Module::Mfnr { "MF" } else { "CMN_" };
            if value != expected
                || !header
                    .tags
                    .first()
                    .is_some_and(|tag| tag.starts_with(prefix))
            {
                continue;
            }
            let indices: std::collections::BTreeSet<_> = (payload.start
                ..payload.end.saturating_sub(7))
                .step_by(8)
                .filter_map(|position| {
                    let key = read_u32(data, position)?;
                    let index = (key & 0xffffff) as usize;
                    (key >> 24 == 1 && header.tags.get(index).is_some_and(|tag| !tag.is_empty()))
                        .then_some(index)
                })
                .collect();
            if indices.len() >= 2 {
                candidates.push(module);
            }
        }
    }
    (candidates.len() == 1).then(|| candidates[0])
}

fn find_kv_block(
    data: &[u8],
    segment: &Segment,
    marker: u8,
    ranges: &[(usize, usize)],
) -> Option<usize> {
    let key0 = u32::from(marker) << 24;
    let end = segment
        .end
        .min(data.len())
        .min(segment.start.saturating_add(MAX_MODULE_SCAN));
    for position in segment.start..end.saturating_sub(15) {
        if in_ranges(position, ranges) || read_u32(data, position) != Some(key0) {
            continue;
        }
        let Some(next_key) = read_u32(data, position + 8) else {
            continue;
        };
        if next_key >> 24 == u32::from(marker) && next_key & 0x00ff_ffff == 1 {
            return Some(position);
        }
    }
    None
}

fn peek_kv_version(
    data: &[u8],
    segments: &[Segment],
    ranges: &[(usize, usize)],
    magic: [u8; 4],
    marker: u8,
) -> Option<u32> {
    let segment = segment_for(segments, magic)?;
    let position = find_kv_block(data, segment, marker, ranges)?;
    read_u32(data, position + 4)
}

fn peek_sparse_version(
    data: &[u8],
    segments: &[Segment],
    ranges: &[(usize, usize)],
    magic: [u8; 4],
    marker: u8,
) -> Option<u32> {
    let segment = segment_for(segments, magic)?;
    let key0 = u32::from(marker) << 24;
    for position in segment.start..segment.end.min(data.len()).saturating_sub(7) {
        if !in_ranges(position, ranges) && read_u32(data, position) == Some(key0) {
            return read_u32(data, position + 4);
        }
    }
    None
}

fn version_for(
    module: Module,
    declaration: Option<Declaration>,
    data: &[u8],
    segments: &[Segment],
    ranges: &[(usize, usize)],
) -> Option<u32> {
    if let Some(declaration) = declaration {
        return Some(declaration.version);
    }
    match module {
        Module::Ae => peek_kv_version(data, segments, ranges, APP6_MAGIC, 0x01),
        Module::Af => None,
        Module::Strobe => peek_kv_version(data, segments, ranges, APP6_MAGIC, 0x04),
        Module::Shading => peek_kv_version(data, segments, ranges, APP6_MAGIC, 0x06),
        Module::Common => peek_sparse_version(data, segments, ranges, APP5_MAGIC, 0x01),
        Module::Mfnr => None,
        Module::Awb | Module::Isp => None,
        _ => None,
    }
}

fn resolve_header(
    module: Module,
    generation: u8,
    version: u32,
    signature: Option<u32>,
    inferred: bool,
) -> Result<HeaderSpec, headers::SelectionError> {
    if !inferred
        && signature.is_some_and(|signature| {
            module_for_signature(module.magic(), signature, generation) != Some(module)
        })
    {
        return Err(headers::SelectionError::Missing);
    }
    let (path, tags) = headers::select(module.subdir(), generation, version, signature)?;
    Ok(HeaderSpec {
        module,
        version,
        path,
        tags,
    })
}

#[cfg(test)]
fn header_for(
    module: Module,
    generation: u8,
    version: u32,
    signature: Option<u32>,
) -> Option<HeaderSpec> {
    resolve_header(module, generation, version, signature, false).ok()
}

fn enum_name(header: &HeaderSpec, index: usize, prefix: &str) -> String {
    header
        .tags
        .get(index)
        .filter(|name| !name.is_empty())
        .copied()
        .map(str::to_string)
        .unwrap_or_else(|| format!("{prefix}_{index}"))
}

fn signed_value(value: u32) -> i64 {
    i64::from(value as i32)
}

fn read_kv_fragment(
    data: &[u8],
    start: usize,
    marker: u8,
    limit: usize,
) -> (BTreeMap<u32, u32>, usize) {
    let mut values = BTreeMap::new();
    let mut position = start;
    let mut previous = None;
    while position + 8 <= limit {
        let Some(key) = read_u32(data, position) else {
            break;
        };
        if key >> 24 != u32::from(marker) {
            break;
        }
        let index = key & 0x00ff_ffff;
        if index >= 5000 || previous.is_some_and(|value| index != value + 1) {
            break;
        }
        let Some(value) = read_u32(data, position + 4) else {
            break;
        };
        values.insert(index, value);
        previous = Some(index);
        position += 8;
    }
    (values, position)
}

fn find_next_kv_fragment(data: &[u8], after: usize, marker: u8, limit: usize) -> Option<usize> {
    for offset in (0..5000).step_by(4) {
        let position = after.checked_add(offset)?;
        if position + 12 > limit {
            break;
        }
        let key = read_u32(data, position)?;
        if key == u32::from(marker) << 24 {
            return None; // A new index-0 module header is not a continuation.
        }
        let next_key = read_u32(data, position + 8)?;
        if key >> 24 == u32::from(marker)
            && key & 0x00ff_ffff < 5000
            && next_key >> 24 == u32::from(marker)
            && next_key & 0x00ff_ffff == (key & 0x00ff_ffff) + 1
        {
            return Some(position);
        }
    }
    None
}

fn decode_kv_block(
    data: &[u8],
    segment: &Segment,
    ranges: &[(usize, usize)],
    header: &HeaderSpec,
    marker: u8,
) -> Option<Vec<(String, i64)>> {
    let start = find_kv_block(data, segment, marker, ranges)?;
    let tail = Segment {
        start: start + 8,
        ..*segment
    };
    if read_u32(data, start + 4) != Some(header.version)
        || find_kv_block(data, &tail, marker, ranges).is_some()
    {
        // Conflicting/duplicated data blocks cannot be flattened safely under
        // one enum, regardless of whether the directory exposed that conflict.
        return None;
    }
    let limit = segment.end.min(data.len());
    let mut values = BTreeMap::new();
    let mut position = start;
    let mut span_end = start;

    for _ in 0..2000 {
        let (fragment, end) = read_kv_fragment(data, position, marker, limit);
        if fragment.is_empty() {
            break;
        }
        values.extend(fragment);
        span_end = span_end.max(end);
        let Some(next) = find_next_kv_fragment(data, end, marker, limit) else {
            break;
        };
        position = next;
    }

    let second_pass_end = span_end.min(limit.saturating_sub(7));
    for position in (start..second_pass_end).step_by(8) {
        let Some(key) = read_u32(data, position) else {
            break;
        };
        if key >> 24 != u32::from(marker) {
            continue;
        }
        let index = key & 0x00ff_ffff;
        if index >= header.tags.len() as u32 || values.contains_key(&index) {
            continue;
        }
        if let Some(value) = read_u32(data, position + 4) {
            values.insert(index, value);
        }
    }

    Some(
        values
            .into_iter()
            .map(|(index, value)| {
                (
                    enum_name(header, index as usize, header.module.prefix()),
                    signed_value(value),
                )
            })
            .collect(),
    )
}

fn decode_sparse_kv(
    data: &[u8],
    segment: &Segment,
    ranges: &[(usize, usize)],
    header: &HeaderSpec,
    marker: u8,
    version: Option<u32>,
) -> Vec<(String, i64)> {
    let key0 = u32::from(marker) << 24;
    let limit = segment.end.min(data.len());
    let mut block = None;
    for position in segment.start..limit.saturating_sub(7) {
        let Some(key) = read_u32(data, position) else {
            break;
        };
        let Some(value) = read_u32(data, position + 4) else {
            break;
        };
        if key == key0
            && !in_ranges(position, ranges)
            && version.map_or(true, |expected| expected == value)
        {
            block = Some(position);
            break;
        }
    }
    let Some(block) = block else {
        return Vec::new();
    };

    let max_index = header.tags.len().saturating_sub(1) as u32;
    let mut values = BTreeMap::new();
    let mut position = block;
    while position + 8 <= limit {
        let Some(key) = read_u32(data, position) else {
            break;
        };
        let Some(value) = read_u32(data, position + 4) else {
            break;
        };
        if position > block && key == key0 {
            break;
        }
        if key == 0 {
            position += 8;
            continue;
        }
        if key >> 24 != u32::from(marker) {
            break;
        }
        let index = key & 0x00ff_ffff;
        if index <= max_index {
            values.entry(index).or_insert(value);
        }
        position += 8;
    }

    values
        .into_iter()
        .map(|(index, value)| {
            (
                enum_name(header, index as usize, header.module.prefix()),
                signed_value(value),
            )
        })
        .collect()
}

fn decode_array_block(
    data: &[u8],
    segment: &Segment,
    ranges: &[(usize, usize)],
    header: &HeaderSpec,
    version: u32,
) -> Option<Vec<(String, i64)>> {
    let limit = segment.end.min(data.len());
    let required_bytes = header.tags.len().checked_mul(4)?;
    if segment.start > limit
        || required_bytes > limit - segment.start
        || in_ranges(segment.start, ranges)
    {
        return None;
    }
    let version_name = if header.module == Module::Awb {
        "AWB_TAG_VERSION"
    } else {
        "IspTagVersion"
    };
    let index = header.tags.iter().position(|name| *name == version_name)?;
    if read_u32(data, segment.start + index * 4) != Some(version) {
        return None;
    }
    // Directory ownership replaces fixed-version gain/UniqueKey heuristics:
    // later headers may move those fields without changing their array shape.
    header
        .tags
        .iter()
        .enumerate()
        .filter(|(_, name)| !name.is_empty())
        .map(|(index, name)| {
            read_u32(data, segment.start + index * 4)
                .map(|value| (name.to_string(), signed_value(value)))
        })
        .collect()
}

fn decode_awb_block(
    data: &[u8],
    segment: &Segment,
    ranges: &[(usize, usize)],
    header: &HeaderSpec,
    version: u32,
) -> Option<Vec<(String, i64)>> {
    decode_array_block(data, segment, ranges, header, version)
}

fn decode_af_block(
    data: &[u8],
    segment: &Segment,
    ranges: &[(usize, usize)],
    header: &HeaderSpec,
    version: u32,
) -> Vec<(String, i64)> {
    let limit = segment.end.min(data.len());
    let mut base = None;
    // The version and first key alone are not an AF record: the value must
    // also be present before the module can count as successfully decoded.
    for position in segment.start..limit.saturating_sub(11) {
        if !in_ranges(position, ranges)
            && read_u32(data, position) == Some(version)
            && read_u32(data, position + 4) == Some(0x0280_0001)
        {
            base = Some(position);
            break;
        }
    }
    let Some(base) = base else {
        return Vec::new();
    };
    let mut values = Vec::new();
    values.push((enum_name(header, 0, "AF_TAG"), signed_value(version)));
    let mut position = base + 4;
    while position + 8 <= limit {
        let Some(key) = read_u32(data, position) else {
            break;
        };
        if key >> 24 != 0x02 {
            break;
        }
        let index = (key & 0x0000_ffff) as usize;
        let Some(value) = read_u32(data, position + 4) else {
            break;
        };
        values.push((enum_name(header, index, "AF_TAG"), signed_value(value)));
        position += 8;
    }
    values
}

fn add_section(
    sections: &mut Vec<(String, Vec<(String, i64)>)>,
    module: Module,
    values: Vec<(String, i64)>,
) {
    if !values.is_empty() {
        sections.push((module.section().to_string(), values));
    }
}

fn render_toml(sections: &[(String, Vec<(String, i64)>)]) -> String {
    let mut output = String::new();
    for (section, values) in sections {
        let mut grouped: BTreeMap<&str, Vec<i64>> = BTreeMap::new();
        for (key, value) in values {
            grouped.entry(key.as_str()).or_default().push(*value);
        }
        if grouped.is_empty() {
            continue;
        }
        let _ = writeln!(output, "[{section}]");
        for (key, values) in grouped {
            if values.len() == 1 {
                let _ = writeln!(output, "{key} = {}", values[0]);
            } else {
                let joined = values
                    .iter()
                    .map(i64::to_string)
                    .collect::<Vec<_>>()
                    .join(", ");
                let _ = writeln!(output, "{key} = [{joined}]");
            }
        }
        output.push('\n');
    }
    output
}

/// Preserve the export contract: diagnostics/statistics alone are not decoded
/// enum fields and cannot turn an unsupported image into a complete sidecar.
pub(crate) fn decode_to_toml(data: &[u8]) -> Result<DirectExifOutput, String> {
    decode_to_toml_with_progress(data, |_, _| {})
}

pub(crate) fn decode_to_toml_with_progress(
    data: &[u8],
    on_progress: impl FnMut(usize, usize),
) -> Result<DirectExifOutput, String> {
    let output = inspect_exif_with_progress(data, on_progress)?;
    if !output
        .modules
        .iter()
        .any(|module| module.parse_status == "decoded")
    {
        return Err("no supported MTK private EXIF tags".into());
    }
    Ok(output)
}

fn declaration_diagnostic(
    module: Option<Module>,
    declaration: Option<Declaration>,
    version: Option<u32>,
) -> ImageExifModule {
    ImageExifModule {
        module: module.map_or("Unknown", Module::section).to_string(),
        header: None,
        status: if declaration.is_some_and(|entry| entry.ambiguous) {
            "ambiguous"
        } else if version.is_some() {
            "unknown"
        } else {
            "unrecorded"
        }
        .into(),
        version: version.map(|value| format!("0x{value:08X}")),
        signature: declaration.map(|entry| format!("0x{:08X}", entry.signature)),
        identity_source: match declaration {
            Some(entry) if !entry.inferred => "directory",
            Some(_) => "directory_layout",
            None if version.is_some() => "payload",
            None => "unrecorded",
        }
        .into(),
        decoded_fields: 0,
        parse_status: "unavailable".into(),
    }
}

/// Inspect only this JPEG. Unknown/missing/ambiguous modules remain visible to
/// Detail even when there is nothing eligible for named decoding or export.
/// Module diagnostics are deliberately separate from the original TOML.
#[cfg(test)]
pub(crate) fn inspect_exif(data: &[u8]) -> Result<DirectExifOutput, String> {
    inspect_exif_with_progress(data, |_, _| {})
}

// Fixed work units: the thirteen module inspections, statistics, and rendering.
// A unit advances only after real work, never from an elapsed-time estimate.
pub(crate) const INSPECTION_STEPS: usize = Module::ALL.len() + 2;

pub(crate) fn inspect_exif_with_progress(
    data: &[u8],
    mut on_progress: impl FnMut(usize, usize),
) -> Result<DirectExifOutput, String> {
    let segments = mtk_segments(data);
    if segments.is_empty() {
        return Err("not an MTK JPEG".into());
    }
    let generation = format_generation(&segments);
    let ranges = directory_ranges(data, &segments);
    let (declarations, has_unsupported_module) =
        read_declarations(data, &segments, &ranges, generation);
    let mut sections = Vec::new();
    let mut modules = Vec::with_capacity(Module::ALL.len() + declarations.len());
    let mut needs_fallback = has_unsupported_module;
    let mut ae_enum = Vec::new();

    for (completed, module) in Module::ALL.into_iter().enumerate() {
        on_progress(completed, INSPECTION_STEPS);
        let declaration = declaration_for(&declarations, module);
        let mut version_ranges = ranges.clone();
        version_ranges.extend(
            declarations
                .iter()
                .filter(|entry| entry.module != Some(module))
                .filter_map(|entry| entry.payload.map(|payload| (payload.start, payload.end))),
        );
        let version = version_for(module, declaration, data, &segments, &version_ranges);
        let mut diagnostic = declaration_diagnostic(Some(module), declaration, version);
        if declaration.is_some_and(|entry| entry.ambiguous) {
            needs_fallback = true;
            modules.push(diagnostic);
            continue;
        }
        let Some(version) = version else {
            needs_fallback |= declaration.is_some();
            modules.push(diagnostic);
            continue;
        };
        let expected = format!(
            "{0}/{0}_{generation}_{1}_{2}.h",
            module.subdir(),
            version & 0xffff,
            version >> 16
        );
        let header = match resolve_header(
            module,
            generation,
            version,
            declaration.map(|entry| entry.signature),
            declaration.is_some_and(|entry| entry.inferred),
        ) {
            Ok(header) => header,
            Err(error) => {
                diagnostic.status = match error {
                    headers::SelectionError::Missing => "missing_header",
                    headers::SelectionError::Ambiguous => "ambiguous",
                    headers::SelectionError::Invalid => "invalid_header",
                }
                .into();
                diagnostic.header =
                    (error != headers::SelectionError::Ambiguous).then_some(expected);
                diagnostic.parse_status = "unsupported".into();
                needs_fallback = true;
                modules.push(diagnostic);
                continue;
            }
        };
        diagnostic.status = "matched".into();
        diagnostic.header = Some(header.path.to_string());
        if !module.can_decode(generation) || header.tags.is_empty() {
            diagnostic.parse_status = if matches!(
                module,
                Module::N3d | Module::Sensor | Module::Swnr | Module::Bmdn
            ) {
                "version_only"
            } else {
                "unsupported"
            }
            .into();
            needs_fallback = true;
            modules.push(diagnostic);
            continue;
        }
        if module == Module::Ae {
            ae_enum = header.tags.clone();
        }
        let Some(segment) = declaration
            .as_ref()
            .map(|entry| &entry.segment)
            .or_else(|| segment_for(&segments, module.magic()))
        else {
            needs_fallback = true;
            modules.push(diagnostic);
            continue;
        };
        let owned = declaration.and_then(|entry| entry.payload);
        let kv_segment = owned
            .as_ref()
            .filter(|_| declaration.is_some_and(|entry| entry.inferred))
            .unwrap_or(segment);
        let values = match module {
            Module::Ae => decode_kv_block(data, kv_segment, &ranges, &header, 0x01),
            Module::Af => {
                owned.map(|payload| decode_af_block(data, &payload, &ranges, &header, version))
            }
            Module::Awb if generation == 5 => {
                decode_kv_block(data, kv_segment, &ranges, &header, 0x03)
            }
            Module::Awb => owned
                .and_then(|payload| decode_awb_block(data, &payload, &ranges, &header, version)),
            Module::Isp if generation == 5 => {
                decode_kv_block(data, kv_segment, &ranges, &header, 0x04)
            }
            Module::Isp => owned
                .and_then(|payload| decode_array_block(data, &payload, &ranges, &header, version)),
            Module::Strobe => decode_kv_block(data, kv_segment, &ranges, &header, 0x04),
            Module::Shading => decode_kv_block(data, kv_segment, &ranges, &header, 0x06),
            Module::Common | Module::Mfnr => {
                let sparse = if declaration.is_some() {
                    owned
                } else {
                    Some(*segment)
                };
                let expected_version = if module == Module::Mfnr {
                    version & 0xffff
                } else {
                    version
                };
                sparse.map(|payload| {
                    decode_sparse_kv(
                        data,
                        &payload,
                        &ranges,
                        &header,
                        0x01,
                        Some(expected_version),
                    )
                })
            }
            _ => None,
        };
        match values {
            Some(values) if values.len() > 1 => {
                diagnostic.decoded_fields = values.len();
                diagnostic.parse_status = "decoded".into();
                add_section(&mut sections, module, values);
            }
            Some(values) => {
                diagnostic.decoded_fields = values.len();
                diagnostic.parse_status = if values.is_empty() {
                    "empty"
                } else {
                    "version_only"
                }
                .into();
                needs_fallback = true;
            }
            None => {
                diagnostic.parse_status = if owned.is_some() {
                    "empty"
                } else {
                    "unavailable"
                }
                .into();
                needs_fallback = true;
            }
        }
        modules.push(diagnostic);
    }
    for (index, declaration) in declarations.iter().enumerate() {
        // Known modules already have a primary row. Preserve remaining duplicate
        // rows and all unknown records instead of hiding their identities.
        if declaration.module.is_some()
            && declarations[..index]
                .iter()
                .all(|other| other.module != declaration.module)
        {
            continue;
        }
        let mut diagnostic = declaration_diagnostic(
            declaration.module,
            Some(*declaration),
            Some(declaration.version),
        );
        if declaration.module.is_none() {
            diagnostic.status = "unknown".into();
            diagnostic.parse_status = "unsupported".into();
        }
        modules.push(diagnostic);
    }

    on_progress(Module::ALL.len(), INSPECTION_STEPS);
    let ae_values = sections
        .iter()
        .find(|(name, _)| name == "AE")
        .map_or(&[][..], |(_, values)| values.as_slice());
    let (ae_tables, incomplete_statistics) =
        ae_tables::decode(data, &segments, &ranges, generation, ae_values, &ae_enum);
    needs_fallback |= incomplete_statistics;
    on_progress(Module::ALL.len() + 1, INSPECTION_STEPS);

    // Keep the compact gain/ISO summary available to the existing EXIF card,
    // without copying the AE tag array into a second large object.
    if let Some((_, ae_values)) = sections.iter().find(|(name, _)| name == "AE") {
        let values: BTreeMap<&str, i64> = ae_values
            .iter()
            .map(|(key, value)| (key.as_str(), *value))
            .collect();
        let fields = [
            ("shutter_us", "AE_TAG_PRV_SHUTTER_TIME"),
            ("sensor_gain", "AE_TAG_PRV_SENSOR_GAIN"),
            ("isp_gain", "AE_TAG_PRV_ISP_GAIN"),
            ("iso", "AE_TAG_PRV_ISO_REAL"),
            ("fps", "AE_TAG_PRV_FRAME_RATE"),
        ];
        let display: Vec<_> = fields
            .into_iter()
            .filter_map(|(name, key)| values.get(key).map(|value| (name.to_string(), *value)))
            .collect();
        if !display.is_empty() {
            sections.push(("AE_DISPLAY".into(), display));
        }
    }

    let mut toml = render_toml(&sections);
    for table in &ae_tables {
        let _ = writeln!(toml, "[AE_Table.{:?}]", table.name);
        let _ = writeln!(toml, "rows = {}\ncolumns = {}", table.rows, table.columns);
        let joined = table
            .values
            .iter()
            .map(i64::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        let _ = writeln!(toml, "values = [{joined}]\n");
    }
    needs_fallback |= !modules
        .iter()
        .any(|module| module.parse_status == "decoded");
    on_progress(INSPECTION_STEPS, INSPECTION_STEPS);
    Ok(DirectExifOutput {
        toml,
        needs_fallback,
        ae_tables,
        modules,
    })
}

fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset.checked_add(2)?)?;
    Some(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

#[cfg(test)]
mod tests {
    use super::{decode_to_toml, AE_SIGNATURE, APP6_MAGIC};

    fn synthetic_ae_jpeg(value: u32) -> Vec<u8> {
        let directory_len = 4 + 32;
        let mut payload = Vec::new();
        payload.extend_from_slice(&APP6_MAGIC);
        payload.extend_from_slice(&0u16.to_le_bytes());
        payload.extend_from_slice(&1u16.to_le_bytes());
        payload.extend_from_slice(&(directory_len as u32).to_le_bytes());
        payload.extend_from_slice(&(directory_len as u32).to_le_bytes());
        payload.extend_from_slice(&AE_SIGNATURE.to_le_bytes());
        payload.extend_from_slice(&11u32.to_le_bytes());
        payload.extend_from_slice(&[0u8; 24]);
        payload.extend_from_slice(&0x0100_0000u32.to_le_bytes());
        payload.extend_from_slice(&11u32.to_le_bytes());
        payload.extend_from_slice(&0x0100_0001u32.to_le_bytes());
        payload.extend_from_slice(&value.to_le_bytes());

        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe6];
        jpeg.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        jpeg.extend_from_slice(&payload);
        jpeg.extend_from_slice(&[0xff, 0xd9]);
        jpeg
    }

    #[test]
    fn direct_decoder_selects_image_declared_enum_and_writes_toml() {
        let output = decode_to_toml(&synthetic_ae_jpeg(123)).unwrap();
        assert!(!output.needs_fallback);
        assert!(output.toml.contains("AE_TAG_DEBUG_VER = 11"));
        assert!(output.toml.contains("AE_TAG_ALGO_VER = 123"));
    }

    #[test]
    fn non_mtk_jpeg_is_left_for_the_fallback_parser() {
        let error = decode_to_toml(b"\xff\xd8\xff\xd9").unwrap_err();
        assert_eq!(error, "not an MTK JPEG");
    }

    fn with_module(magic: [u8; 4], signature: u32, version: u32, words: &[u32]) -> Vec<u8> {
        let mut payload = magic.to_vec();
        payload.extend_from_slice(&0u16.to_le_bytes());
        payload.extend_from_slice(&1u16.to_le_bytes());
        payload.extend_from_slice(&36u32.to_le_bytes());
        payload.extend_from_slice(&36u32.to_le_bytes());
        payload.extend_from_slice(&signature.to_le_bytes());
        payload.extend_from_slice(&version.to_le_bytes());
        payload.extend_from_slice(&[0u8; 24]);
        for word in words {
            payload.extend_from_slice(&word.to_le_bytes());
        }
        let marker = if magic == super::APP5_MAGIC {
            0xe5
        } else if magic == super::APP7_MAGIC {
            0xe7
        } else {
            0xe6
        };
        let mut jpeg = vec![0xff, 0xd8, 0xff, marker];
        jpeg.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        jpeg.extend_from_slice(&payload);
        jpeg.extend_from_slice(&[0xff, 0xd9]);
        jpeg
    }

    #[test]
    fn legacy_ae_uses_its_own_header_family() {
        let jpeg = with_module(
            super::APP6_LEGACY_MAGIC,
            super::LEGACY_AE_SIGNATURE,
            0x000e_0007,
            &[0x0100_0000, 0x000e_0007, 0x0100_0001, 42],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        assert!(output.toml.contains("AE_TAG_AE_MODE = 42"));
        assert!(!output.toml.contains("AE_TAG_ALGO_VER"));
    }

    #[test]
    fn wrong_segment_and_missing_exact_version_do_not_invent_names() {
        let words = [0x0100_0000, 11, 0x0100_0001, 42];
        assert!(decode_to_toml(&with_module(super::APP5_MAGIC, AE_SIGNATURE, 11, &words)).is_err());
        assert!(decode_to_toml(&with_module(
            APP6_MAGIC,
            AE_SIGNATURE,
            999,
            &[0x0100_0000, 999, 0x0100_0001, 42]
        ))
        .is_err());
        assert!(
            decode_to_toml(&with_module(APP6_MAGIC, AE_SIGNATURE, 11, &[])).is_err(),
            "a directory alone is not a decoded tag block"
        );
    }

    #[test]
    fn isp_same_version_variants_are_selected_by_signature() {
        let base = super::header_for(
            super::Module::Isp,
            6,
            0x0002_000a,
            Some(super::ISP_SIGNATURE),
        )
        .unwrap();
        let samsung = super::header_for(
            super::Module::Isp,
            6,
            0x0002_000a,
            Some(super::SAMSUNG_ISP_SIGNATURE),
        )
        .unwrap();
        assert!(base.tags.contains(&"SensorRawBit"));
        assert!(!samsung.tags.contains(&"SensorRawBit"));
        assert_eq!(base.tags.len(), samsung.tags.len() + 2);
        assert!(super::header_for(super::Module::Isp, 6, 0x0002_000a, None).is_none());
        assert!(super::header_for(super::Module::Isp, 6, 0x0002_000a, Some(0xdead_beef)).is_none());
    }

    #[test]
    fn isp_array_exposes_the_tonemap_lce_keywords() {
        let header = super::header_for(
            super::Module::Isp,
            6,
            0x0002_000a,
            Some(super::ISP_SIGNATURE),
        )
        .unwrap();
        let mut words = vec![0; header.tags.len()];
        words[0] = 0x0002_000a;
        let lv = header
            .tags
            .iter()
            .position(|tag| *tag == "SW_LCE_LV")
            .unwrap();
        let target = header
            .tags
            .iter()
            .position(|tag| *tag == "SW_LCE_FinalTarget")
            .unwrap();
        words[lv] = 123;
        words[target] = 456;
        let jpeg = with_module(super::APP7_MAGIC, super::ISP_SIGNATURE, 0x0002_000a, &words);
        let output = decode_to_toml(&jpeg).unwrap();
        assert!(output.toml.contains("SW_LCE_LV = 123"));
        assert!(output.toml.contains("SW_LCE_FinalTarget = 456"));
    }

    #[test]
    fn af_repeated_indices_keep_all_values_in_order() {
        let jpeg = with_module(
            APP6_MAGIC,
            super::AF_SIGNATURE,
            8,
            &[
                0x0200_0000,
                8,
                0x0280_0001,
                10,
                0x0280_0001,
                11,
                0x0280_0002,
                12,
            ],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        assert!(output.toml.contains("VER_CORE = [10, 11]"));
        assert!(output.toml.contains("VER_IP = 12"));
    }

    fn words_bytes(words: &[u32]) -> Vec<u8> {
        words.iter().flat_map(|word| word.to_le_bytes()).collect()
    }

    fn with_layout(magic: [u8; 4], declarations: &[(u32, u32)], blocks: &[Vec<u8>]) -> Vec<u8> {
        let count = blocks.len() + 1;
        let directory_len = 4 + declarations.len() * 32;
        let mut payload = magic.to_vec();
        payload.extend_from_slice(&(declarations.len() as u16).to_le_bytes());
        payload.extend_from_slice(&(count as u16).to_le_bytes());
        let mut offset = 8 + count * 4 + directory_len;
        payload.extend_from_slice(&(offset as u32).to_le_bytes());
        for block in blocks {
            offset += block.len();
            payload.extend_from_slice(&(offset as u32).to_le_bytes());
        }
        payload.extend_from_slice(&(directory_len as u32).to_le_bytes());
        for (signature, version) in declarations {
            payload.extend_from_slice(&signature.to_le_bytes());
            payload.extend_from_slice(&version.to_le_bytes());
            payload.extend_from_slice(&[0; 24]);
        }
        for block in blocks {
            payload.extend_from_slice(block);
        }
        assert!(payload.len() + 2 <= u16::MAX as usize);
        let marker = if magic == super::APP7_MAGIC {
            0xe7
        } else if magic == super::APP5_MAGIC {
            0xe5
        } else {
            0xe6
        };
        let mut jpeg = vec![0xff, 0xd8, 0xff, marker];
        jpeg.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        jpeg.extend_from_slice(&payload);
        jpeg.extend_from_slice(&[0xff, 0xd9]);
        jpeg
    }

    fn append_segment(mut jpeg: Vec<u8>, other: &[u8]) -> Vec<u8> {
        jpeg.truncate(jpeg.len() - 2);
        jpeg.extend_from_slice(&other[2..]);
        jpeg
    }

    fn isp_words() -> Vec<u32> {
        let header = super::header_for(
            super::Module::Isp,
            6,
            0x0002_000a,
            Some(super::ISP_SIGNATURE),
        )
        .unwrap();
        let mut words = vec![0; header.tags.len()];
        words[0] = 0x0002_000a;
        words
    }

    fn awb_words() -> Vec<u32> {
        let header = super::header_for(
            super::Module::Awb,
            6,
            0x0040_000a,
            Some(super::AWB_SIGNATURE),
        )
        .unwrap();
        let mut words = vec![0; header.tags.len()];
        words[0] = 0x0040_000a;
        words[8..11].fill(1024);
        words
    }

    #[test]
    fn valid_directory_length_does_not_swallow_a_zero_filled_array() {
        for container_count in [2, 8] {
            let mut blocks = vec![words_bytes(&isp_words())];
            blocks.extend((0..container_count - 2).map(|_| vec![0; 8]));
            let jpeg = with_layout(
                super::APP7_MAGIC,
                &[(super::ISP_SIGNATURE, 0x0002_000a)],
                &blocks,
            );
            let segments = super::mtk_segments(&jpeg);
            let ranges = super::directory_ranges(&jpeg, &segments);
            let directory_start = segments[0].start + 8 + container_count * 4;
            assert_eq!(ranges, vec![(directory_start, directory_start + 36)]);
            let output = decode_to_toml(&jpeg).unwrap();
            assert!(!output.needs_fallback);
            assert!(output.toml.contains("SW_LCE_LV = 0"));
        }
    }

    #[test]
    fn invalid_directory_word_can_use_a_bounded_module_count() {
        let mut jpeg = with_layout(
            super::APP7_MAGIC,
            &[(super::ISP_SIGNATURE, 0x0002_000a)],
            &[words_bytes(&isp_words())],
        );
        // APP7 start 6 + fixed header 8 + two offsets 8 = directory start 22.
        jpeg[22..26].copy_from_slice(&0u32.to_le_bytes());
        let output = decode_to_toml(&jpeg).unwrap();
        assert!(!output.needs_fallback);
        assert!(output.toml.contains("SW_LCE_LV = 0"));
    }

    #[test]
    fn truncated_arrays_remain_partial_even_with_valid_ae_and_following_padding() {
        for (signature, version, is_awb) in [
            (super::ISP_SIGNATURE, 0x0002_000a, false),
            (super::AWB_SIGNATURE, 0x0040_000a, true),
        ] {
            let mut words = vec![0; 12];
            words[0] = version;
            if is_awb {
                words[8..11].fill(1024);
            }
            for following_bytes in [0, 10_000] {
                let mut blocks = vec![words_bytes(&words)];
                if following_bytes > 0 {
                    blocks.push(vec![0; following_bytes]);
                }
                let array = with_layout(super::APP7_MAGIC, &[(signature, version)], &blocks);
                let jpeg = append_segment(synthetic_ae_jpeg(123), &array);
                let output = decode_to_toml(&jpeg).unwrap();
                assert!(output.needs_fallback);
                assert!(output.toml.contains("AE_TAG_ALGO_VER = 123"));
                assert!(!output.toml.contains("[AWB]"));
                assert!(!output.toml.contains("[ISP]"));
            }
        }
    }

    #[test]
    fn a_complete_awb_array_still_decodes() {
        let words = awb_words();
        let jpeg = with_layout(
            super::APP7_MAGIC,
            &[(super::AWB_SIGNATURE, words[0])],
            &[words_bytes(&words)],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        assert!(!output.needs_fallback);
        assert!(output.toml.contains("AWB_TAG_VERSION = 4194314"));
    }

    #[test]
    fn truncated_isp_cannot_borrow_an_embedded_version_in_a_complete_awb() {
        let mut awb = awb_words();
        let isp = isp_words();
        let isp_header =
            super::header_for(super::Module::Isp, 6, isp[0], Some(super::ISP_SIGNATURE)).unwrap();
        let lv = isp_header
            .tags
            .iter()
            .position(|tag| *tag == "SW_LCE_LV")
            .unwrap();
        // AWB_TAG_INFO_0/1 are ordinary values, even if they resemble an ISP
        // header. Enough AWB data follows to satisfy the entire ISP enum.
        awb[24] = isp[0];
        awb[25] = 0;
        awb[24 + lv] = 999;
        assert!(awb.len() - 24 >= isp.len());
        let jpeg = with_layout(
            super::APP7_MAGIC,
            &[
                (super::ISP_SIGNATURE, isp[0]),
                (super::AWB_SIGNATURE, awb[0]),
            ],
            &[words_bytes(&isp[..12]), words_bytes(&awb)],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        assert!(output.needs_fallback);
        assert!(output.toml.contains("AWB_TAG_INFO_0 = 131082"));
        assert!(!output.toml.contains("[ISP]"));
        assert!(!output.toml.contains("SW_LCE_LV"));
    }

    #[test]
    fn truncated_awb_cannot_borrow_a_complete_array_inside_the_isp_payload() {
        let awb = awb_words();
        let mut isp = isp_words();
        isp.resize(isp.len().max(24 + awb.len()), 0);
        isp[24..24 + awb.len()].copy_from_slice(&awb);
        let jpeg = with_layout(
            super::APP7_MAGIC,
            &[
                (super::AWB_SIGNATURE, awb[0]),
                (super::ISP_SIGNATURE, isp[0]),
            ],
            &[words_bytes(&awb[..12]), words_bytes(&isp)],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        assert!(output.needs_fallback);
        assert!(output.toml.contains("[ISP]"));
        assert!(!output.toml.contains("[AWB]"));
    }

    #[test]
    fn an_empty_payload_does_not_shift_later_declaration_indices() {
        let isp = isp_words();
        let jpeg = with_layout(
            super::APP7_MAGIC,
            &[
                (super::AWB_SIGNATURE, 0x0040_000a),
                (super::ISP_SIGNATURE, isp[0]),
            ],
            &[Vec::new(), words_bytes(&isp)],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        assert!(output.needs_fallback);
        assert!(output.toml.contains("SW_LCE_LV = 0"));
        assert!(!output.toml.contains("[AWB]"));
    }

    #[test]
    fn invalid_payload_offsets_do_not_enable_a_segment_wide_array_search() {
        let isp = isp_words();
        let mut array = with_layout(
            super::APP7_MAGIC,
            &[(super::ISP_SIGNATURE, isp[0])],
            &[words_bytes(&isp)],
        );
        // The start offset points into the directory, so no payload ownership
        // can be established even though a complete ISP array follows it.
        array[14..18].copy_from_slice(&0u32.to_le_bytes());
        let output = decode_to_toml(&append_segment(synthetic_ae_jpeg(123), &array)).unwrap();
        assert!(output.needs_fallback);
        assert!(output.toml.contains("AE_TAG_ALGO_VER = 123"));
        assert!(!output.toml.contains("[ISP]"));
    }

    #[test]
    fn array_declarations_use_their_own_app_segment() {
        let awb = awb_words();
        let isp = isp_words();
        let awb_jpeg = with_layout(
            super::APP7_MAGIC,
            &[(super::AWB_SIGNATURE, awb[0])],
            &[words_bytes(&awb)],
        );
        let isp_jpeg = with_layout(
            super::APP7_MAGIC,
            &[(super::ISP_SIGNATURE, isp[0])],
            &[words_bytes(&isp)],
        );
        let output = decode_to_toml(&append_segment(awb_jpeg, &isp_jpeg)).unwrap();
        assert!(!output.needs_fallback);
        assert!(output.toml.contains("[AWB]"));
        assert!(output.toml.contains("SW_LCE_LV = 0"));
    }

    #[test]
    fn empty_declared_af_common_and_mfnr_modules_keep_fallback_eligibility() {
        for (magic, signature, version, legacy, section) in [
            (APP6_MAGIC, super::AF_SIGNATURE, 8, false, "AF"),
            (
                super::APP5_MAGIC,
                super::COMMON_SIGNATURE,
                0x0004_0001,
                false,
                "Common",
            ),
            (
                super::APP5_MAGIC,
                super::COMMON_SIGNATURE,
                0x0004_0001,
                true,
                "Common",
            ),
            (
                super::APP5_MAGIC,
                super::LEGACY_MFNR_SIGNATURE,
                12,
                true,
                "MFNR",
            ),
        ] {
            let ae = if legacy {
                with_module(
                    super::APP6_LEGACY_MAGIC,
                    super::LEGACY_AE_SIGNATURE,
                    0x000e_0007,
                    &[0x0100_0000, 0x000e_0007, 0x0100_0001, 123],
                )
            } else {
                synthetic_ae_jpeg(123)
            };
            let empty = with_layout(magic, &[(signature, version)], &[Vec::new()]);
            let output = decode_to_toml(&append_segment(ae, &empty)).unwrap();
            assert!(
                output.needs_fallback,
                "{section} must remain eligible for DP"
            );
            assert!(output.toml.contains("[AE]"));
            assert!(!output.toml.contains(&format!("[{section}]")));
        }
    }

    #[test]
    fn an_af_version_and_key_without_the_first_value_are_not_decoded_fields() {
        let af = with_layout(
            APP6_MAGIC,
            &[(super::AF_SIGNATURE, 8)],
            &[words_bytes(&[0x0200_0000, 8, 0x0280_0001])],
        );
        let output = decode_to_toml(&append_segment(synthetic_ae_jpeg(123), &af)).unwrap();
        assert!(output.needs_fallback);
        assert!(output.toml.contains("AE_TAG_ALGO_VER = 123"));
        assert!(!output.toml.contains("[AF]"));
    }

    #[test]
    fn an_unknown_app7_declaration_preserves_fallback_eligibility() {
        let unknown = with_layout(
            super::APP7_MAGIC,
            &[(0x1122_3344, 0x0002_000a)],
            &[vec![0; 48]],
        );
        let output = decode_to_toml(&append_segment(synthetic_ae_jpeg(123), &unknown)).unwrap();
        assert!(output.needs_fallback);
        assert!(output.toml.contains("AE_TAG_ALGO_VER = 123"));
        assert!(!output.toml.contains("[ISP]"));
    }

    #[test]
    fn conflicting_module_declarations_do_not_mix_enums_and_values() {
        let ae = with_layout(
            APP6_MAGIC,
            &[
                (AE_SIGNATURE, 11),
                (super::SAMSUNG_AE_SIGNATURE, 0x000b_0009),
            ],
            &[
                words_bytes(&[0x0100_0000, 11, 0x0100_0001, 123]),
                words_bytes(&[0x0100_0000, 0x000b_0009, 0x0100_0001, 456]),
            ],
        );
        assert!(decode_to_toml(&ae).is_err());
        let isp = with_layout(
            super::APP7_MAGIC,
            &[(super::ISP_SIGNATURE, 0x0002_000a)],
            &[words_bytes(&isp_words())],
        );
        let output = decode_to_toml(&append_segment(ae, &isp)).unwrap();
        assert!(output.needs_fallback);
        assert!(output.toml.contains("[ISP]"));
        assert!(!output.toml.contains("[AE]"));
        assert!(!output.toml.contains("AE_TAG_ALGO_VER"));
    }

    #[test]
    fn a_second_index_zero_block_is_not_a_kv_continuation() {
        for second_version in [11, 0x000b_0009] {
            let jpeg = with_layout(
                APP6_MAGIC,
                &[(AE_SIGNATURE, 11)],
                &[
                    words_bytes(&[0x0100_0000, 11, 0x0100_0001, 123]),
                    words_bytes(&[0x0100_0000, second_version, 0x0100_0001, 456]),
                ],
            );
            assert!(decode_to_toml(&jpeg).is_err());
        }
    }

    #[test]
    fn catalog_uses_other_exact_versions_without_substituting_newer_enums() {
        let jpeg = with_module(
            APP6_MAGIC,
            AE_SIGNATURE,
            8,
            &[0x0100_0000, 8, 0x0100_0001, 77],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        assert!(output.toml.contains("AE_TAG_AE_MODE = 77"));
        assert!(!output.toml.contains("AE_TAG_ALGO_VER"));
        let ae = output
            .modules
            .iter()
            .find(|module| module.module == "AE")
            .unwrap();
        assert_eq!(ae.header.as_deref(), Some("AE/AE_6_8_0.h"));
        assert_eq!(ae.parse_status, "decoded");
        assert_eq!(ae.identity_source, "directory");
        let unknown = with_module(
            APP6_MAGIC,
            AE_SIGNATURE,
            999,
            &[0x0100_0000, 999, 0x0100_0001, 77],
        );
        let inspected = super::inspect_exif(&unknown).unwrap();
        let ae = inspected
            .modules
            .iter()
            .find(|module| module.module == "AE")
            .unwrap();
        assert_eq!(ae.status, "missing_header");
        assert_eq!(ae.header.as_deref(), Some("AE/AE_6_999_0.h"));
        assert_eq!(ae.version.as_deref(), Some("0x000003E7"));
        assert!(inspected.toml.is_empty());
        assert!(inspected.needs_fallback);
        assert!(decode_to_toml(&unknown).is_err());
    }

    #[test]
    fn shared_conditional_isp_layout_agrees_with_the_preserved_signature_variant() {
        let (_, base) =
            super::headers::select("ISP", 6, 0x0002_000a, Some(super::ISP_SIGNATURE)).unwrap();
        let (_, samsung) =
            super::headers::select("ISP", 6, 0x0002_000a, Some(super::SAMSUNG_ISP_SIGNATURE))
                .unwrap();
        let shared = super::headers::load_enum(
            include_str!("../../resources/mtk_exif/headers/ISP/ISP_6_10_2.h"),
            Some(super::SAMSUNG_ISP_SIGNATURE),
        )
        .unwrap();
        assert_eq!(shared, samsung);
        assert_eq!(base.len(), 1649);
        assert_eq!(samsung.len(), 1647);
        for signature in [
            super::ISP_SIGNATURE,
            super::SAMSUNG_ISP_SIGNATURE,
            0x31d4_d86c,
        ] {
            let header =
                super::header_for(super::Module::Isp, 6, 0x0002_000a, Some(signature)).unwrap();
            let mut words = vec![0; header.tags.len()];
            words[0] = 0x0002_000a;
            let position = header
                .tags
                .iter()
                .position(|name| *name == "SW_LCE_LV")
                .unwrap();
            words[position] = 321;
            let output = decode_to_toml(&with_layout(
                super::APP7_MAGIC,
                &[(signature, words[0])],
                &[words_bytes(&words)],
            ))
            .unwrap();
            assert!(output.toml.contains("SW_LCE_LV = 321"));
        }
    }

    #[test]
    fn diagnostics_keep_unknown_duplicate_and_header_only_declarations() {
        let duplicate = with_layout(
            APP6_MAGIC,
            &[(AE_SIGNATURE, 11), (AE_SIGNATURE, 11)],
            &[
                words_bytes(&[0x0100_0000, 11, 0x0100_0001, 1]),
                words_bytes(&[0x0100_0000, 11, 0x0100_0001, 2]),
            ],
        );
        let output = super::inspect_exif(&duplicate).unwrap();
        let ae: Vec<_> = output
            .modules
            .iter()
            .filter(|module| module.module == "AE")
            .collect();
        assert_eq!(ae.len(), 2);
        assert!(ae
            .iter()
            .all(|module| module.status == "ambiguous" && module.decoded_fields == 0));
        assert!(output.needs_fallback && output.toml.is_empty());
        let unknown = with_layout(
            super::APP7_MAGIC,
            &[(0x1122_3344, 0xabcd_0123)],
            &[vec![0; 48]],
        );
        let output = super::inspect_exif(&unknown).unwrap();
        let row = output
            .modules
            .iter()
            .find(|module| module.module == "Unknown")
            .unwrap();
        assert_eq!(row.signature.as_deref(), Some("0x11223344"));
        assert_eq!(row.version.as_deref(), Some("0xABCD0123"));
        assert_eq!(row.status, "unknown");
        assert_eq!(row.identity_source, "directory");
        assert_eq!(row.parse_status, "unsupported");
        assert!(output
            .modules
            .iter()
            .any(|module| module.module == "String" && module.status == "unrecorded"));
        let header_only = with_module(APP6_MAGIC, AE_SIGNATURE, 11, &[]);
        let output = super::inspect_exif(&header_only).unwrap();
        let ae = output
            .modules
            .iter()
            .find(|module| module.module == "AE")
            .unwrap();
        assert_eq!(ae.status, "matched");
        assert_ne!(ae.parse_status, "decoded");
        assert!(output.needs_fallback);
        assert!(decode_to_toml(&header_only).is_err());
    }

    #[test]
    fn diagnostic_budget_includes_unrecorded_rows_and_truncation_stays_partial() {
        let declarations = vec![(0x1122_3344, 999); 40];
        let blocks = vec![Vec::new(); 40];
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xd9];
        for _ in 0..8 {
            jpeg = append_segment(
                jpeg,
                &with_layout(super::APP7_MAGIC, &declarations, &blocks),
            );
        }
        let output = super::inspect_exif(&jpeg).unwrap();
        assert_eq!(output.modules.len(), super::MAX_MODULE_DIAGNOSTICS);
        assert!(output.needs_fallback);
        assert!(decode_to_toml(&jpeg).is_err());
        let sensor = with_layout(
            super::APP5_MAGIC,
            &[(0xbe62_9b07, 0)],
            &[words_bytes(&[0, 1, 2, 3])],
        );
        let output = super::inspect_exif(&sensor).unwrap();
        let sensor = output
            .modules
            .iter()
            .find(|module| module.module == "Sensor")
            .unwrap();
        assert_eq!(sensor.status, "matched");
        assert_eq!(sensor.parse_status, "version_only");
        assert_eq!(sensor.decoded_fields, 0);
        assert!(output.needs_fallback);
    }

    #[test]
    fn a_new_signature_needs_a_unique_owned_layout() {
        let jpeg = with_layout(
            APP6_MAGIC,
            &[(0x1234_5678, 8)],
            &[words_bytes(&[0x0100_0000, 8, 0x0100_0001, 99])],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        let ae = output
            .modules
            .iter()
            .find(|module| module.module == "AE")
            .unwrap();
        assert_eq!(ae.identity_source, "directory_layout");
        assert_eq!(ae.signature.as_deref(), Some("0x12345678"));
        assert!(output.toml.contains("AE_TAG_AE_MODE = 99"));
        let version = 0x0002_000a;
        let (_, awb) = super::headers::select("AWB", 6, version, Some(0x1234_5678)).unwrap();
        let (_, isp) = super::headers::select("ISP", 6, version, Some(0x1234_5678)).unwrap();
        let mut words = vec![0; awb.len().max(isp.len())];
        words[0] = version;
        let jpeg = with_layout(
            super::APP7_MAGIC,
            &[(0x1234_5678, version)],
            &[words_bytes(&words)],
        );
        let output = super::inspect_exif(&jpeg).unwrap();
        assert!(output
            .modules
            .iter()
            .any(|module| module.module == "Unknown"));
        assert!(!output
            .modules
            .iter()
            .any(|module| module.parse_status == "decoded"));
        assert!(decode_to_toml(&jpeg).is_err());
    }

    #[test]
    fn matched_header_is_not_proof_of_a_supported_binary_decoder() {
        let jpeg = with_layout(
            super::APP5_MAGIC,
            &[(super::MFNR_SIGNATURE, 0)],
            &[words_bytes(&[0x0100_0000, 0, 0x0100_0001, 5])],
        );
        let output = super::inspect_exif(&jpeg).unwrap();
        let mfnr = output
            .modules
            .iter()
            .find(|module| module.module == "MFNR")
            .unwrap();
        assert_eq!(mfnr.status, "matched");
        assert_eq!(mfnr.version.as_deref(), Some("0x00000000"));
        assert_eq!(mfnr.parse_status, "unsupported");
        assert!(output.needs_fallback && output.toml.is_empty());
        let broken = with_layout(
            super::APP7_MAGIC,
            &[(super::AWB_SIGNATURE, 0x0009_000a)],
            &[vec![0; 48]],
        );
        let output = super::inspect_exif(&broken).unwrap();
        let awb = output
            .modules
            .iter()
            .find(|module| module.module == "AWB")
            .unwrap();
        assert_eq!(awb.status, "invalid_header");
        assert_eq!(awb.parse_status, "unsupported");
        assert!(decode_to_toml(&broken).is_err());
    }

    #[test]
    fn payload_versions_and_version_only_sections_have_distinct_diagnostics() {
        let jpeg = with_layout(
            APP6_MAGIC,
            &[],
            &[words_bytes(&[0x0100_0000, 11, 0x0100_0001, 7])],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        let ae = output
            .modules
            .iter()
            .find(|module| module.module == "AE")
            .unwrap();
        assert_eq!(ae.identity_source, "payload");
        assert!(ae.signature.is_none());
        let jpeg = with_layout(
            super::APP5_MAGIC,
            &[(super::COMMON_SIGNATURE, 0x0004_0001)],
            &[words_bytes(&[0x0100_0000, 0x0004_0001])],
        );
        let output = super::inspect_exif(&jpeg).unwrap();
        let common = output
            .modules
            .iter()
            .find(|module| module.module == "Common")
            .unwrap();
        assert_eq!(common.parse_status, "version_only");
        assert_eq!(common.decoded_fields, 1);
        assert!(output.toml.is_empty());
        assert!(decode_to_toml(&jpeg).is_err());
        let zero_signature = with_layout(super::APP7_MAGIC, &[(0, 999)], &[Vec::new()]);
        let output = super::inspect_exif(&zero_signature).unwrap();
        assert!(output
            .modules
            .iter()
            .any(|module| module.module == "Unknown"
                && module.signature.as_deref() == Some("0x00000000")));
    }

    fn type8_statistics() -> Vec<u8> {
        let mut record = words_bytes(&[8, 11576]);
        for count in [25, 25, 225, 225, 225, 225, 225] {
            for value in 0..count {
                record.extend_from_slice(&(value as u16 + 1).to_le_bytes());
            }
        }
        for histogram in 0..3 {
            for bin in 0..1024 {
                let value: u32 = if bin == 0 {
                    [0x010203, 0x010203, 3 * 0x010203][histogram]
                } else {
                    0
                };
                record.extend_from_slice(&value.to_le_bytes()[..3]);
            }
        }
        record.extend_from_slice(&[0; 2]);
        assert_eq!(record.len(), 11576);
        record
    }

    fn type10_statistics() -> Vec<u8> {
        let mut record = words_bytes(&[0x0001_000a, 5136]);
        for value in [64u16, 48, 8, 6] {
            record.extend_from_slice(&value.to_le_bytes());
        }
        for channel in 0..4 {
            for index in 0..256 {
                let value = if index < 48 {
                    channel * 1000 + index
                } else {
                    0xffff
                } as u16;
                record.extend_from_slice(&value.to_le_bytes());
            }
        }
        for histogram in 0..3 {
            for index in 0..256 {
                record
                    .extend_from_slice(&(0xf000_0000u32 + histogram * 1000 + index).to_le_bytes());
            }
        }
        assert_eq!(record.len(), 5136);
        record
    }

    #[test]
    fn type8_statistics_cross_slots_but_keep_shape_and_unsigned_u24_values() {
        let record = type8_statistics();
        let jpeg = with_layout(
            APP6_MAGIC,
            &[],
            &[record[..40].to_vec(), record[40..].to_vec()],
        );
        let output = super::inspect_exif(&jpeg).unwrap();
        assert_eq!(output.ae_tables.len(), 10);
        assert_eq!(
            output
                .ae_tables
                .iter()
                .map(|table| table.values.len())
                .sum::<usize>(),
            4247
        );
        let grid = &output.ae_tables[0];
        assert_eq!((&*grid.name, grid.rows, grid.columns), ("5x5_LE", 5, 5));
        assert_eq!(grid.values[24], 25);
        let histogram = output
            .ae_tables
            .iter()
            .find(|table| table.name == "Full_RGB")
            .unwrap();
        assert_eq!(
            (histogram.rows, histogram.columns, histogram.values[0]),
            (64, 16, 3 * 0x010203)
        );
        assert!(
            output.needs_fallback,
            "statistics alone are not named EXIF coverage"
        );
        assert!(decode_to_toml(&jpeg).is_err());
        let parsed: toml::Value = toml::from_str(&output.toml).unwrap();
        assert_eq!(parsed["AE_Table"]["5x5_LE"]["rows"].as_integer(), Some(5));
        assert_eq!(
            parsed["AE_Table"]["Full_RGB"]["values"]
                .as_array()
                .unwrap()
                .len(),
            1024
        );
        assert!(!output.toml.contains("__luxe_exif"));
        // The 11566-byte table ends before two optional record trailer bytes.
        let mut no_trailer = record;
        no_trailer.truncate(no_trailer.len() - 2);
        assert_eq!(
            super::inspect_exif(&with_layout(APP6_MAGIC, &[], &[no_trailer]))
                .unwrap()
                .ae_tables
                .len(),
            10
        );
    }

    #[test]
    fn type8_statistics_reject_truncation_constant_grids_and_bad_histogram_invariants() {
        let record = type8_statistics();
        let mut truncated = record.clone();
        truncated.truncate(record.len() - 3);
        let mut constant = record.clone();
        constant[8..58].fill(0);
        let mut bad_histogram = record.clone();
        bad_histogram[8 + 2350 + 6144] ^= 1;
        for invalid in [truncated, constant, bad_histogram] {
            let jpeg = with_layout(APP6_MAGIC, &[], &[invalid]);
            let output = super::inspect_exif(&jpeg).unwrap();
            assert!(output.ae_tables.is_empty());
            assert!(output.needs_fallback);
        }
        let left = with_layout(APP6_MAGIC, &[], &[record[..5000].to_vec()]);
        let right = with_layout(super::APP7_MAGIC, &[], &[record[5000..].to_vec()]);
        assert!(super::inspect_exif(&append_segment(left, &right))
            .unwrap()
            .ae_tables
            .is_empty());
    }

    #[test]
    fn type8_prefers_the_measured_record_size_over_other_valid_candidates() {
        let mut alternative = type8_statistics();
        alternative[4..8].copy_from_slice(&11578u32.to_le_bytes());
        alternative[8..10].copy_from_slice(&999u16.to_le_bytes());
        alternative.extend_from_slice(&[0; 2]);
        alternative.extend_from_slice(&type8_statistics());
        let output = super::inspect_exif(&with_layout(APP6_MAGIC, &[], &[alternative])).unwrap();
        assert_eq!(output.ae_tables[0].values[0], 1);
    }

    #[test]
    fn type10_statistics_use_padded_capacities_and_unsigned_u32_histograms() {
        let ae = words_bytes(&[0x0100_0000, 11, 0x0100_0001, 123]);
        let jpeg = with_layout(
            APP6_MAGIC,
            &[(AE_SIGNATURE, 11)],
            &[ae, type10_statistics()],
        );
        let output = decode_to_toml(&jpeg).unwrap();
        assert_eq!(output.ae_tables.len(), 7);
        assert_eq!(
            output
                .ae_tables
                .iter()
                .map(|table| table.values.len())
                .sum::<usize>(),
            960
        );
        assert_eq!(output.ae_tables[0].name, "8_6_LE_Y");
        assert_eq!(
            (output.ae_tables[0].rows, output.ae_tables[0].columns),
            (6, 8)
        );
        assert_eq!(output.ae_tables[0].values[47], 3047);
        assert_eq!(output.ae_tables[4].values[255], 0xf000_0000 + 255);
        assert!(!output.needs_fallback);
    }

    #[test]
    fn type10_statistics_never_cross_slots_or_use_unvalidated_offsets() {
        let record = type10_statistics();
        for blocks in [
            vec![record[..3000].to_vec()],
            vec![record[..3000].to_vec(), record[3000..].to_vec()],
        ] {
            let output = super::inspect_exif(&with_layout(APP6_MAGIC, &[], &blocks)).unwrap();
            assert!(output.ae_tables.is_empty());
        }
        let mut jpeg = with_layout(APP6_MAGIC, &[], &[record.clone()]);
        jpeg[14..18].copy_from_slice(&0u32.to_le_bytes());
        assert!(super::inspect_exif(&jpeg).unwrap().ae_tables.is_empty());
        let mut unknown_revision = record.clone();
        unknown_revision[..4].copy_from_slice(&0x0002_000au32.to_le_bytes());
        let mut wrong_shape = record;
        wrong_shape[12..14].copy_from_slice(&16u16.to_le_bytes());
        let ae = words_bytes(&[0x0100_0000, 11, 0x0100_0001, 123]);
        for invalid in [wrong_shape[..8].to_vec(), wrong_shape, unknown_revision] {
            let jpeg = with_layout(APP6_MAGIC, &[(AE_SIGNATURE, 11)], &[ae.clone(), invalid]);
            let output = decode_to_toml(&jpeg).unwrap();
            assert!(output.ae_tables.is_empty());
            assert!(
                output.needs_fallback,
                "valid AE must not hide a truncated or unknown statistics layout"
            );
        }
    }

    fn legacy_statistics(missing: Option<&str>) -> Vec<u8> {
        let header = super::header_for(
            super::Module::Ae,
            5,
            0x000e_0007,
            Some(super::LEGACY_AE_SIGNATURE),
        )
        .unwrap();
        let mut words = Vec::new();
        for (index, name) in header.tags.iter().enumerate() {
            if name.is_empty() || missing == Some(*name) {
                continue;
            }
            let value = if index == 0 {
                0x000e_0007
            } else if name.starts_with("AE_TAG_STATRGBY15_WIN") {
                0x8122_3344
            } else {
                index as u32
            };
            words.push(0x0100_0000 | index as u32);
            words.push(value);
        }
        with_module(
            super::APP6_LEGACY_MAGIC,
            super::LEGACY_AE_SIGNATURE,
            0x000e_0007,
            &words,
        )
    }

    #[test]
    fn generation5_statistics_unpack_rgby_and_zero_only_undeclared_histogram_bins() {
        let output = decode_to_toml(&legacy_statistics(None)).unwrap();
        assert_eq!(output.ae_tables.len(), 10);
        assert_eq!(
            output
                .ae_tables
                .iter()
                .map(|table| table.values.len())
                .sum::<usize>(),
            1662
        );
        for (name, value) in [
            ("15x15 Y", 0x44),
            ("15x15 R", 0x81),
            ("15x15 G", 0x22),
            ("15x15 B", 0x33),
        ] {
            assert!(output
                .ae_tables
                .iter()
                .find(|table| table.name == name)
                .unwrap()
                .values
                .iter()
                .all(|cell| *cell == value));
        }
        let histogram = output
            .ae_tables
            .iter()
            .find(|table| table.name == "HIST 0")
            .unwrap();
        assert_eq!(histogram.values[20], 0);
        assert!(histogram.values[40] > 0);
        assert!(!output.needs_fallback);
        for missing in [
            "AE_TAG_STAT_WIN00",
            "AE_TAG_STATRGBY15_WIN0000",
            "AE_TAG_OVERCNT_WIN0000",
            "AE_TAG_HIST0_INFO_BIN_40",
        ] {
            let output = decode_to_toml(&legacy_statistics(Some(missing))).unwrap();
            assert!(
                output.ae_tables.is_empty(),
                "{missing} is declared but missing"
            );
            assert!(output.needs_fallback);
        }
    }
}
