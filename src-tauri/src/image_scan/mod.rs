//! Image directory scanning + per-image TOML loading.
//!
//! Mirrors hiz's behaviour: each captured frame has a sidecar `.toml` file
//! sharing the same stem (e.g. `IMG_20260318_171433.jpg` + `IMG_20260318_171433.toml`).
//! The TOML carries flat or shallowly-nested `AE_TAG_*` keys that feed every
//! per-image badge / table value in `Isp6sAeVisual`.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use base64::Engine;
use dashmap::DashMap;
use image::{metadata::Orientation, DynamicImage, ImageDecoder, ImageEncoder};
use once_cell::sync::Lazy;
use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct ImageEntry {
    /// Stem (no extension).
    pub name:      String,
    pub jpg_path:  String,
    pub toml_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TomlSignature {
    len:      u64,
    modified: Option<SystemTime>,
}

#[derive(Debug, Clone)]
struct CachedToml {
    signature: TomlSignature,
    data:      HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct CachedThumbnail {
    signature: TomlSignature,
    data_url:  String,
}

static TOML_CACHE: Lazy<DashMap<String, Arc<CachedToml>>> = Lazy::new(DashMap::new);
static THUMBNAIL_CACHE: Lazy<DashMap<String, Arc<CachedThumbnail>>> = Lazy::new(DashMap::new);

/// Scan `dir` for image files (`.jpg`, `.jpeg`, `.png`) that have a sibling
/// `.toml` with the same stem. Sorted alphabetically.
pub fn scan_directory(dir: &Path) -> AppResult<Vec<ImageEntry>> {
    let mut images: Vec<(String, PathBuf)> = Vec::new();
    let mut tomls: HashMap<String, PathBuf> = HashMap::new();

    for entry in fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_file() { continue; }

        let p = entry.path();
        let Some(ext) = p.extension().and_then(|s| s.to_str()) else { continue };
        let Some(stem) = p.file_stem().and_then(|s| s.to_str()) else { continue };

        match ext.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" | "png" => images.push((stem.to_string(), p)),
            "toml" => {
                tomls.entry(stem.to_string()).or_insert(p);
            }
            _ => {}
        }
    }

    let mut entries = Vec::new();
    for (stem, jpg_path) in images {
        let Some(toml_path) = tomls.get(&stem) else { continue };
        entries.push(ImageEntry {
            name:      stem,
            jpg_path:  jpg_path.to_string_lossy().into_owned(),
            toml_path: toml_path.to_string_lossy().into_owned(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Load a single image TOML and flatten it into a key → value map.
///
/// Flattening rules (mirrors hiz `_flatten_toml_items`):
/// - For every nested map node, walk recursively and record leaves.
/// - For every leaf, record BOTH the dotted path AND the bare leaf name —
///   that way `AE_TAG_FOO` resolves whether the TOML places it at top level
///   or under a section like `[hw_status]`.
/// - Arrays are joined with ", " (so the value is a single string just like
///   the Python flattener returns).
pub fn load_image_toml(path: &Path) -> AppResult<HashMap<String, String>> {
    let cache_key = path.to_string_lossy().into_owned();
    let signature = toml_signature(path)?;

    if let Some(cached) = TOML_CACHE.get(&cache_key) {
        if cached.signature == signature {
            return Ok(cached.data.clone());
        }
    }

    let data = parse_image_toml(path)?;
    TOML_CACHE.insert(
        cache_key,
        Arc::new(CachedToml {
            signature,
            data: data.clone(),
        }),
    );
    Ok(data)
}

pub fn load_image_toml_batch(paths: Vec<String>) -> AppResult<HashMap<String, HashMap<String, String>>> {
    let mut out = HashMap::with_capacity(paths.len());

    for path in paths {
        if out.contains_key(&path) {
            continue;
        }

        match load_image_toml(Path::new(&path)) {
            Ok(data) => {
                out.insert(path, data);
            }
            Err(err) => {
                tracing::warn!(%path, %err, "image TOML batch item failed");
                out.insert(path, HashMap::new());
            }
        }
    }

    Ok(out)
}

pub fn load_image_toml_fields_batch(
    paths: Vec<String>,
    keys: Vec<String>,
) -> AppResult<HashMap<String, HashMap<String, String>>> {
    let key_aliases: Vec<(String, String)> = keys
        .into_iter()
        .filter(|key| !key.is_empty())
        .map(|key| {
            let lower = key.to_ascii_lowercase();
            (key, lower)
        })
        .collect();
    let mut out = HashMap::with_capacity(paths.len());

    for path in paths {
        if out.contains_key(&path) {
            continue;
        }

        match load_image_toml(Path::new(&path)) {
            Ok(data) => {
                let mut selected = HashMap::with_capacity(key_aliases.len());
                for (key, lower) in &key_aliases {
                    if let Some(value) = data.get(key).or_else(|| data.get(lower)) {
                        selected.insert(key.clone(), value.clone());
                    }
                }
                out.insert(path, selected);
            }
            Err(err) => {
                tracing::warn!(%path, %err, "image TOML field batch item failed");
                out.insert(path, HashMap::new());
            }
        }
    }

    Ok(out)
}

pub fn load_image_thumbnail_batch(
    paths: Vec<String>,
    size: u32,
    fast_only: bool,
) -> AppResult<HashMap<String, String>> {
    let size = size.clamp(16, 128);
    let mut out = HashMap::with_capacity(paths.len());

    for path in paths {
        if out.contains_key(&path) {
            continue;
        }

        match load_image_thumbnail(Path::new(&path), size, fast_only) {
            Ok(data_url) => {
                out.insert(path, data_url);
            }
            Err(err) => {
                tracing::warn!(%path, %err, "image thumbnail batch item failed");
                out.insert(path, String::new());
            }
        }
    }

    Ok(out)
}

fn toml_signature(path: &Path) -> AppResult<TomlSignature> {
    let meta = fs::metadata(path)?;
    Ok(TomlSignature {
        len:      meta.len(),
        modified: meta.modified().ok(),
    })
}

fn load_image_thumbnail(path: &Path, size: u32, fast_only: bool) -> AppResult<String> {
    let cache_key = format!(
        "{}\0{size}\0{}",
        if fast_only { "fast" } else { "full" },
        path.to_string_lossy(),
    );
    let full_cache_key = format!("full\0{size}\0{}", path.to_string_lossy());
    let signature = toml_signature(path)?;

    if fast_only {
        if let Some(cached) = THUMBNAIL_CACHE.get(&full_cache_key) {
            if cached.signature == signature {
                return Ok(cached.data_url.clone());
            }
        }
    }

    if let Some(cached) = THUMBNAIL_CACHE.get(&cache_key) {
        if cached.signature == signature {
            return Ok(cached.data_url.clone());
        }
    }

    let data_url = if fast_only {
        embedded_thumbnail_data_url_from_jpeg_file(path, size)
            .or_else(|| platform_thumbnail_data_url(path, size))
            .unwrap_or_default()
    } else {
        generate_image_thumbnail(path, size)?
    };
    THUMBNAIL_CACHE.insert(
        cache_key,
        Arc::new(CachedThumbnail {
            signature,
            data_url: data_url.clone(),
        }),
    );
    Ok(data_url)
}

fn generate_image_thumbnail(path: &Path, size: u32) -> AppResult<String> {
    if let Some(data_url) = embedded_thumbnail_data_url_from_jpeg_file(path, size) {
        return Ok(data_url);
    }
    if let Some(data_url) = platform_thumbnail_data_url(path, size) {
        return Ok(data_url);
    }

    let reader = image::ImageReader::open(path)?;
    let mut decoder = reader
        .with_guessed_format()?
        .into_decoder()
        .map_err(|err| AppError::Other(format!("thumbnail decode error: {err}")))?;
    let exif = decoder
        .exif_metadata()
        .map_err(|err| AppError::Other(format!("thumbnail EXIF read error: {err}")))?;
    let orientation = decoder
        .orientation()
        .map_err(|err| AppError::Other(format!("thumbnail orientation error: {err}")))?;
    if let Some(exif) = exif.as_deref() {
        if let Some(data_url) = embedded_thumbnail_data_url(exif, orientation, size) {
            return Ok(data_url);
        }
    }

    let mut img = DynamicImage::from_decoder(decoder)
        .map_err(|err| AppError::Other(format!("thumbnail decode error: {err}")))?;
    img.apply_orientation(orientation);
    encode_png_thumbnail_data_url(img, size)
}

fn embedded_thumbnail_data_url_from_jpeg_file(path: &Path, size: u32) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut soi = [0; 2];
    file.read_exact(&mut soi).ok()?;
    if soi != [0xFF, 0xD8] {
        return None;
    }

    loop {
        let marker = read_jpeg_marker(&mut file)?;
        match marker {
            // Start of Scan / End of Image: metadata segments are over.
            0xDA | 0xD9 => return None,
            // Restart markers and TEM have no payload length.
            0x01 | 0xD0..=0xD7 => continue,
            _ => {
                let len = read_be_u16(&mut file)? as usize;
                if len < 2 {
                    return None;
                }
                let payload_len = len - 2;

                if marker == 0xE1 {
                    let mut payload = vec![0; payload_len];
                    file.read_exact(&mut payload).ok()?;
                    if !payload.starts_with(b"Exif\0\0") {
                        continue;
                    }
                    let orientation = exif_orientation(&payload);
                    if let Some(data_url) = embedded_thumbnail_data_url(&payload, orientation, size) {
                        return Some(data_url);
                    }
                } else {
                    file.seek(SeekFrom::Current(payload_len as i64)).ok()?;
                }
            }
        }
    }
}

fn read_jpeg_marker(file: &mut fs::File) -> Option<u8> {
    let mut byte = [0; 1];

    loop {
        file.read_exact(&mut byte).ok()?;
        if byte[0] == 0xFF {
            break;
        }
    }

    loop {
        file.read_exact(&mut byte).ok()?;
        match byte[0] {
            0xFF => continue,
            0x00 => return None,
            marker => return Some(marker),
        }
    }
}

fn read_be_u16(file: &mut fs::File) -> Option<u16> {
    let mut bytes = [0; 2];
    file.read_exact(&mut bytes).ok()?;
    Some(u16::from_be_bytes(bytes))
}

fn exif_orientation(exif: &[u8]) -> Orientation {
    let tiff = exif.strip_prefix(b"Exif\0\0").unwrap_or(exif);
    Orientation::from_exif_chunk(tiff).unwrap_or(Orientation::NoTransforms)
}

fn embedded_thumbnail_data_url(exif: &[u8], orientation: Orientation, size: u32) -> Option<String> {
    let jpeg = extract_exif_jpeg_thumbnail(exif)?;
    if orientation == Orientation::NoTransforms {
        let encoded = base64::engine::general_purpose::STANDARD.encode(jpeg);
        return Some(format!("data:image/jpeg;base64,{encoded}"));
    }

    let mut img = image::load_from_memory(jpeg).ok()?;
    img.apply_orientation(orientation);
    encode_png_thumbnail_data_url(img, size).ok()
}

fn encode_png_thumbnail_data_url(img: DynamicImage, size: u32) -> AppResult<String> {
    let thumb = img.thumbnail(size, size).to_rgba8();
    let mut bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut bytes);
    encoder
        .write_image(
            thumb.as_raw(),
            thumb.width(),
            thumb.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|err| AppError::Other(format!("thumbnail encode error: {err}")))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{encoded}"))
}

#[cfg(target_os = "windows")]
fn platform_thumbnail_data_url(path: &Path, size: u32) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, SIZE};
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, HGDIOBJ,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, IBindCtx, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        SHCreateItemFromParsingName, IShellItemImageFactory, SIIGBF_BIGGERSIZEOK,
        SIIGBF_RESIZETOFIT,
    };

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninit = hr.is_ok();
        if !hr.is_ok() && hr != RPC_E_CHANGED_MODE {
            return None;
        }

        let wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let factory: IShellItemImageFactory = match SHCreateItemFromParsingName::<_, _, IShellItemImageFactory>(
            PCWSTR(wide.as_ptr()),
            None::<&IBindCtx>,
        ) {
            Ok(factory) => factory,
            Err(_) => {
                if should_uninit {
                    CoUninitialize();
                }
                return None;
            }
        };

        let hbitmap = match factory.GetImage(
            SIZE {
                cx: size as i32,
                cy: size as i32,
            },
            SIIGBF_RESIZETOFIT | SIIGBF_BIGGERSIZEOK,
        ) {
            Ok(hbitmap) => hbitmap,
            Err(_) => {
                if should_uninit {
                    CoUninitialize();
                }
                return None;
            }
        };

        let data_url = hbitmap_to_png_data_url(hbitmap, size);
        let _ = DeleteObject(HGDIOBJ(hbitmap.0));
        if should_uninit {
            CoUninitialize();
        }
        data_url
    }
}

#[cfg(target_os = "windows")]
unsafe fn hbitmap_to_png_data_url(
    hbitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    size: u32,
) -> Option<String> {
    use std::mem::size_of;

    use windows::Win32::Graphics::Gdi::{
        GetDC, GetDIBits, GetObjectW, ReleaseDC, BI_RGB, BITMAP, BITMAPINFO, DIB_RGB_COLORS,
        HGDIOBJ,
    };

    let mut bitmap = BITMAP::default();
    let got = GetObjectW(
        HGDIOBJ(hbitmap.0),
        size_of::<BITMAP>() as i32,
        Some((&mut bitmap as *mut BITMAP).cast()),
    );
    if got == 0 || bitmap.bmWidth <= 0 || bitmap.bmHeight == 0 {
        return None;
    }

    let width = bitmap.bmWidth as usize;
    let height = bitmap.bmHeight.unsigned_abs() as usize;
    let mut info = BITMAPINFO::default();
    info.bmiHeader.biSize = size_of::<windows::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32;
    info.bmiHeader.biWidth = width as i32;
    info.bmiHeader.biHeight = -(height as i32);
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB.0;

    let hdc = GetDC(None);
    if hdc.0.is_null() {
        return None;
    }

    let mut pixels = vec![0u8; width.checked_mul(height)?.checked_mul(4)?];
    let lines = GetDIBits(
        hdc,
        hbitmap,
        0,
        height as u32,
        Some(pixels.as_mut_ptr().cast()),
        &mut info,
        DIB_RGB_COLORS,
    );
    let _ = ReleaseDC(None, hdc);
    if lines == 0 {
        return None;
    }

    let all_alpha_zero = pixels.chunks_exact(4).all(|px| px[3] == 0);
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
        if all_alpha_zero {
            px[3] = 255;
        }
    }

    let img = image::RgbaImage::from_raw(width as u32, height as u32, pixels)?;
    encode_png_thumbnail_data_url(DynamicImage::ImageRgba8(img), size).ok()
}

#[cfg(not(target_os = "windows"))]
fn platform_thumbnail_data_url(_path: &Path, _size: u32) -> Option<String> {
    None
}

#[derive(Clone, Copy)]
enum TiffEndian {
    Big,
    Little,
}

fn extract_exif_jpeg_thumbnail(exif: &[u8]) -> Option<&[u8]> {
    let tiff = exif.strip_prefix(b"Exif\0\0").unwrap_or(exif);
    if tiff.len() < 8 {
        return None;
    }

    let endian = match &tiff[0..2] {
        b"II" => TiffEndian::Little,
        b"MM" => TiffEndian::Big,
        _ => return None,
    };
    if read_tiff_u16(tiff, 2, endian)? != 42 {
        return None;
    }

    let ifd0_offset = read_tiff_u32(tiff, 4, endian)? as usize;
    let ifd1_offset = next_ifd_offset(tiff, ifd0_offset, endian)? as usize;
    if ifd1_offset == 0 {
        return None;
    }

    let entries = read_tiff_u16(tiff, ifd1_offset, endian)? as usize;
    let entries_start = ifd1_offset.checked_add(2)?;
    let entries_bytes = entries.checked_mul(12)?;
    entries_start.checked_add(entries_bytes)?;

    let mut jpeg_offset: Option<usize> = None;
    let mut jpeg_len: Option<usize> = None;

    for index in 0..entries {
        let entry = entries_start.checked_add(index.checked_mul(12)?)?;
        let tag = read_tiff_u16(tiff, entry, endian)?;
        let value = read_tiff_u32(tiff, entry + 8, endian)? as usize;
        match tag {
            0x0201 => jpeg_offset = Some(value),
            0x0202 => jpeg_len = Some(value),
            _ => {}
        }
    }

    let start = jpeg_offset?;
    let len = jpeg_len?;
    let end = start.checked_add(len)?;
    let jpeg = tiff.get(start..end)?;
    if jpeg.starts_with(&[0xFF, 0xD8]) && jpeg.ends_with(&[0xFF, 0xD9]) {
        Some(jpeg)
    } else {
        None
    }
}

fn next_ifd_offset(tiff: &[u8], ifd_offset: usize, endian: TiffEndian) -> Option<u32> {
    let entries = read_tiff_u16(tiff, ifd_offset, endian)? as usize;
    let next_offset_pos = ifd_offset
        .checked_add(2)?
        .checked_add(entries.checked_mul(12)?)?;
    read_tiff_u32(tiff, next_offset_pos, endian)
}

fn read_tiff_u16(buf: &[u8], offset: usize, endian: TiffEndian) -> Option<u16> {
    let bytes = buf.get(offset..offset.checked_add(2)?)?;
    Some(match endian {
        TiffEndian::Big => u16::from_be_bytes([bytes[0], bytes[1]]),
        TiffEndian::Little => u16::from_le_bytes([bytes[0], bytes[1]]),
    })
}

fn read_tiff_u32(buf: &[u8], offset: usize, endian: TiffEndian) -> Option<u32> {
    let bytes = buf.get(offset..offset.checked_add(4)?)?;
    Some(match endian {
        TiffEndian::Big => u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        TiffEndian::Little => u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
    })
}

fn parse_image_toml(path: &Path) -> AppResult<HashMap<String, String>> {
    let text = fs::read_to_string(path)?;
    let root: toml::Value = toml::from_str(&text)?;
    let mut out: HashMap<String, String> = HashMap::new();
    walk(&root, "", &mut out);
    Ok(out)
}

fn walk(v: &toml::Value, prefix: &str, out: &mut HashMap<String, String>) {
    match v {
        toml::Value::Table(t) => {
            for (k, child) in t.iter() {
                let full = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                walk(child, &full, out);
            }
        }
        toml::Value::Array(a) => {
            // Hiz joins arrays with ", " in the flat representation.
            let joined: Vec<String> = a.iter().map(stringify).collect();
            let s = joined.join(", ");
            insert_with_aliases(out, prefix, s);
        }
        _ => {
            insert_with_aliases(out, prefix, stringify(v));
        }
    }
}

fn insert_with_aliases(out: &mut HashMap<String, String>, full_path: &str, value: String) {
    if full_path.is_empty() {
        return;
    }
    out.insert(full_path.to_string(), value.clone());
    out.entry(full_path.to_ascii_lowercase()).or_insert(value.clone());
    // Also store the bare leaf name so `AE_TAG_*` lookups work regardless of
    // the section it lives under.
    if let Some(leaf) = full_path.rsplit('.').next() {
        if leaf != full_path {
            out.entry(leaf.to_string()).or_insert(value.clone());
            out.entry(leaf.to_ascii_lowercase()).or_insert(value);
        }
    }
}

fn stringify(v: &toml::Value) -> String {
    match v {
        toml::Value::String(s)   => s.clone(),
        toml::Value::Integer(i)  => i.to_string(),
        toml::Value::Float(f)    => {
            // Avoid the scientific notation that toml's Display can produce.
            if f.fract() == 0.0 { format!("{f:.0}") } else { format!("{f}") }
        }
        toml::Value::Boolean(b)  => b.to_string(),
        toml::Value::Datetime(d) => d.to_string(),
        toml::Value::Array(_) | toml::Value::Table(_) => String::new(),
    }
}
