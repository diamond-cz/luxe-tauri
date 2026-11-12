//! The three measured AE statistics layouts. Their bounds differ from enum
//! payloads: type 8 may cross slots, type 10 must stay inside one valid slot.
use std::collections::{BTreeMap, BTreeSet};

use super::{
    module_payload_ranges, normalized_magic, read_u16, read_u32, word_matches, ImageExifTable,
    Segment, APP6_MAGIC,
};

const GRID_SHAPES: [(&str, usize, usize); 7] = [
    ("5x5_LE", 5, 5),
    ("5x5_SE", 5, 5),
    ("15x15_LE", 15, 15),
    ("15x15_SE", 15, 15),
    ("15x15_R", 15, 15),
    ("15x15_G", 15, 15),
    ("15x15_B", 15, 15),
];
const GRID_VALUES: usize = 1175;
const TYPE8_BYTES: usize = GRID_VALUES * 2 + 3 * 1024 * 3;
const TYPE10_BYTES: usize = 16 + 4 * 256 * 2 + 3 * 256 * 4;
const MAX_CANDIDATES: usize = 128;

fn table(name: &str, rows: usize, columns: usize, values: Vec<i64>) -> ImageExifTable {
    ImageExifTable {
        name: name.into(),
        rows,
        columns,
        values,
    }
}

fn u24(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset.checked_add(3)?)?;
    Some(u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16))
}

fn varied(data: &[u8], offset: usize, count: usize) -> bool {
    let mut distinct = [0u16; 8];
    let mut used = 0;
    for index in 0..count {
        let Some(value) = read_u16(data, offset + index * 2) else {
            return false;
        };
        if !distinct[..used].contains(&value) {
            distinct[used] = value;
            used += 1;
            if used == distinct.len() {
                return true;
            }
        }
    }
    false
}

fn valid_type8(data: &[u8], start: usize, limit: usize) -> bool {
    if start.checked_add(TYPE8_BYTES).is_none_or(|end| end > limit)
        || !varied(data, start, 25)
        || !varied(data, start + 100, 225)
    {
        return false;
    }
    let full_y_start = start + GRID_VALUES * 2 + 1024 * 3;
    let full_rgb_start = full_y_start + 1024 * 3;
    let y: u64 = (0..1024)
        .map(|index| u64::from(u24(data, full_y_start + index * 3).unwrap_or(0)))
        .sum();
    let rgb: u64 = (0..1024)
        .map(|index| u64::from(u24(data, full_rgb_start + index * 3).unwrap_or(0)))
        .sum();
    y > 0 && rgb == 3 * y
}

fn type8_tables(data: &[u8], start: usize) -> Vec<ImageExifTable> {
    let mut cursor = start;
    let mut tables = Vec::with_capacity(10);
    for (name, rows, columns) in GRID_SHAPES {
        let values = (0..rows * columns)
            .map(|index| i64::from(read_u16(data, cursor + index * 2).unwrap()))
            .collect();
        tables.push(table(name, rows, columns, values));
        cursor += rows * columns * 2;
    }
    for name in ["Central_Y", "Full_Y", "Full_RGB"] {
        let values = (0..1024)
            .map(|index| i64::from(u24(data, cursor + index * 3).unwrap()))
            .collect();
        tables.push(table(name, 64, 16, values));
        cursor += 1024 * 3;
    }
    tables
}

fn decode_type8(data: &[u8], segments: &[Segment]) -> (Vec<ImageExifTable>, bool) {
    let mut incomplete = false;
    let mut candidates = 0;
    // Remember at most the first 129 alternative-size candidates. A second
    // full byte scan is unnecessary; candidate 129 already exhausts the old
    // shared 128-candidate budget if none of the earlier ones is valid.
    let mut alternatives = Vec::new();
    for segment in segments
        .iter()
        .filter(|segment| normalized_magic(segment.magic) == APP6_MAGIC)
    {
        let limit = segment.end.min(data.len());
        for position in word_matches(data, segment.start, limit, 8, 8) {
            let size = read_u32(data, position + 4).unwrap_or(0) as usize;
            let start = position + 8;
            if size != TYPE8_BYTES + 10 {
                if (TYPE8_BYTES..=segment.end - segment.start).contains(&size)
                    && alternatives.len() <= MAX_CANDIDATES
                {
                    alternatives.push((start, limit));
                }
                continue;
            }
            candidates += 1;
            if candidates > MAX_CANDIDATES {
                return (Vec::new(), true);
            }
            // Validate the actual 11566-byte table; two record trailer bytes
            // are optional, and slot boundaries intentionally do not apply.
            if !valid_type8(data, start, limit) {
                incomplete = true;
                continue;
            }
            return (type8_tables(data, start), incomplete);
        }
    }
    for (start, limit) in alternatives {
        candidates += 1;
        if candidates > MAX_CANDIDATES {
            return (Vec::new(), true);
        }
        if !valid_type8(data, start, limit) {
            incomplete = true;
            continue;
        }
        return (type8_tables(data, start), incomplete);
    }
    (Vec::new(), incomplete)
}

fn decode_type10(
    data: &[u8],
    segments: &[Segment],
    directories: &[(usize, usize)],
) -> (Vec<ImageExifTable>, bool) {
    let mut incomplete = false;
    for segment in segments
        .iter()
        .filter(|segment| normalized_magic(segment.magic) == APP6_MAGIC)
    {
        for (start, end) in module_payload_ranges(data, segment, directories) {
            if start + 4 > end {
                continue;
            }
            let record_type = read_u32(data, start).unwrap_or(0);
            if record_type & 0xffff != 10 {
                continue;
            }
            if record_type != 0x0001_000a || start + 16 > end {
                incomplete = true;
                continue;
            }
            if [
                read_u16(data, start + 8),
                read_u16(data, start + 10),
                read_u16(data, start + 12),
                read_u16(data, start + 14),
            ] != [Some(64), Some(48), Some(8), Some(6)]
            {
                incomplete = true;
                continue;
            }
            if read_u32(data, start + 4).map(|value| value as usize) != Some(end - start)
                || end > data.len()
                || start + TYPE10_BYTES > end
            {
                incomplete = true;
                continue;
            }
            let mut tables = Vec::with_capacity(7);
            for (name, channel) in [
                ("8_6_LE_Y", 3),
                ("8_6_LE_R", 0),
                ("8_6_LE_G", 1),
                ("8_6_LE_B", 2),
            ] {
                let offset = start + 16 + channel * 256 * 2;
                let values = (0..48)
                    .map(|index| i64::from(read_u16(data, offset + index * 2).unwrap()))
                    .collect();
                tables.push(table(name, 6, 8, values));
            }
            let hist_start = start + 16 + 4 * 256 * 2;
            for (index, name) in ["LE_RGB_MAX", "LE_Y", "SE_Y"].into_iter().enumerate() {
                let values = (0..256)
                    .map(|bin| {
                        i64::from(read_u32(data, hist_start + index * 1024 + bin * 4).unwrap())
                    })
                    .collect();
                tables.push(table(name, 16, 16, values));
            }
            return (tables, incomplete);
        }
    }
    (Vec::new(), incomplete)
}

fn decode_legacy(values: &[(String, i64)], tags: &[&str]) -> (Vec<ImageExifTable>, bool) {
    let values: BTreeMap<&str, i64> = values
        .iter()
        .map(|(name, value)| (name.as_str(), *value))
        .collect();
    let declared: BTreeSet<&str> = tags.iter().copied().collect();
    let present = values.keys().any(|key| {
        key.starts_with("AE_TAG_STAT_WIN")
            || key.starts_with("AE_TAG_STATRGBY15_WIN")
            || key.starts_with("AE_TAG_OVERCNT_WIN")
            || key.starts_with("AE_TAG_HIST")
    });
    if !present {
        return (Vec::new(), false);
    }
    let decode = || -> Option<Vec<ImageExifTable>> {
        let mut result = Vec::with_capacity(10);
        let mut grid = Vec::with_capacity(25);
        for row in 0..5 {
            for column in 0..5 {
                grid.push(*values.get(format!("AE_TAG_STAT_WIN{row}{column}").as_str())?);
            }
        }
        result.push(table("5x5", 5, 5, grid));
        for (channel, shift) in [("Y", 0), ("R", 24), ("G", 16), ("B", 8)] {
            let mut grid = Vec::with_capacity(225);
            for row in 0..15 {
                for column in 0..15 {
                    let value = *values
                        .get(format!("AE_TAG_STATRGBY15_WIN{row:02}{column:02}").as_str())?
                        as u32;
                    grid.push(i64::from((value >> shift) & 0xff));
                }
            }
            result.push(table(&format!("15x15 {channel}"), 15, 15, grid));
        }
        let mut grid = Vec::with_capacity(225);
        for row in 0..15 {
            for column in 0..15 {
                grid.push(*values.get(format!("AE_TAG_OVERCNT_WIN{row:02}{column:02}").as_str())?);
            }
        }
        result.push(table("15x15 OverCnt", 15, 15, grid));
        for histogram in 0..4 {
            let mut bins = Vec::with_capacity(128);
            for index in 0..128 {
                let name = format!("AE_TAG_HIST{histogram}_INFO_BIN_{index}");
                bins.push(if declared.contains(name.as_str()) {
                    *values.get(name.as_str())?
                } else {
                    0
                });
            }
            result.push(table(&format!("HIST {histogram}"), 8, 16, bins));
        }
        Some(result)
    };
    match decode() {
        Some(tables) => (tables, false),
        None => (Vec::new(), true),
    }
}

pub(super) fn decode(
    data: &[u8],
    segments: &[Segment],
    directories: &[(usize, usize)],
    generation: u8,
    ae_values: &[(String, i64)],
    ae_enum: &[&str],
) -> (Vec<ImageExifTable>, bool) {
    if generation == 5 {
        return decode_legacy(ae_values, ae_enum);
    }
    let (tables, incomplete_v10) = decode_type10(data, segments, directories);
    if !tables.is_empty() {
        return (tables, incomplete_v10);
    }
    let (tables, incomplete_v8) = decode_type8(data, segments);
    (tables, incomplete_v10 || incomplete_v8)
}
