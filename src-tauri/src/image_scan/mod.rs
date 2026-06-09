//! Image directory scanning + per-image TOML loading.
//!
//! Mirrors hiz's behaviour: each captured frame has a sidecar `.toml` file
//! sharing the same stem (e.g. `IMG_20260318_171433.jpg` + `IMG_20260318_171433.toml`).
//! The TOML carries flat or shallowly-nested `AE_TAG_*` keys that feed every
//! per-image badge / table value in `Isp6sAeVisual`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use image::{metadata::Orientation, DynamicImage, ImageDecoder, ImageEncoder};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const TOML_CACHE_LIMIT: usize = 96;
const TOML_FIELD_CACHE_LIMIT: usize = 512;
const THUMBNAIL_CACHE_LIMIT: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
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

struct CachedToml {
    signature: TomlSignature,
    data:      HashMap<String, String>,
    last_used: AtomicU64,
}

struct CachedTomlFields {
    signature: TomlSignature,
    data:      HashMap<String, String>,
    last_used: AtomicU64,
}

struct CachedThumbnail {
    signature: TomlSignature,
    path:      String,
    last_used: AtomicU64,
}

struct EncodedThumbnail {
    bytes:     Vec<u8>,
    extension: &'static str,
}

static TOML_CACHE: Lazy<DashMap<String, Arc<CachedToml>>> = Lazy::new(DashMap::new);
static TOML_FIELD_CACHE: Lazy<DashMap<String, Arc<CachedTomlFields>>> = Lazy::new(DashMap::new);
static THUMBNAIL_CACHE: Lazy<DashMap<String, Arc<CachedThumbnail>>> = Lazy::new(DashMap::new);
static CACHE_TICK: AtomicU64 = AtomicU64::new(1);
static ACTIVE_IMAGE_DIR: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

/// Scan `dir` for image files (`.jpg`, `.jpeg`, `.png`) that have a sibling
/// `.toml` with the same stem. Sorted alphabetically.
pub fn scan_directory(dir: &Path) -> AppResult<Vec<ImageEntry>> {
    clear_runtime_caches_if_dir_changed(dir);

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

fn clear_runtime_caches_if_dir_changed(dir: &Path) {
    let next_dir = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    let mut active = ACTIVE_IMAGE_DIR.lock();
    if active.as_ref() == Some(&next_dir) {
        return;
    }

    TOML_CACHE.clear();
    TOML_FIELD_CACHE.clear();
    THUMBNAIL_CACHE.clear();
    let _ = fs::remove_dir_all(thumbnail_cache_dir());
    *active = Some(next_dir);
}

fn next_cache_tick() -> u64 {
    CACHE_TICK.fetch_add(1, Ordering::Relaxed)
}

fn prune_cache<T>(
    cache: &DashMap<String, Arc<T>>,
    limit: usize,
    last_used: impl Fn(&T) -> u64,
) {
    if cache.len() <= limit {
        return;
    }

    let mut entries: Vec<(String, u64)> = cache
        .iter()
        .map(|entry| (entry.key().clone(), last_used(entry.value().as_ref())))
        .collect();
    if entries.len() <= limit {
        return;
    }

    entries.sort_by_key(|(_, used)| *used);
    let remove_count = entries.len().saturating_sub(limit);
    for (key, _) in entries.into_iter().take(remove_count) {
        cache.remove(&key);
    }
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
            cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
            return Ok(cached.data.clone());
        }
    }

    let data = parse_image_toml(path)?;
    TOML_CACHE.insert(
        cache_key,
        Arc::new(CachedToml {
            signature,
            data: data.clone(),
            last_used: AtomicU64::new(next_cache_tick()),
        }),
    );
    prune_cache(&TOML_CACHE, TOML_CACHE_LIMIT, |entry| {
        entry.last_used.load(Ordering::Relaxed)
    });
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
    let request_keys: Vec<String> = keys
        .into_iter()
        .filter(|key| !key.is_empty())
        .collect();
    let key_lookup = selected_key_lookup(&request_keys);
    let key_signature = request_keys.join("\u{1f}");
    let mut seen = HashSet::with_capacity(paths.len());
    let mut unique_paths = Vec::with_capacity(paths.len());
    for path in paths {
        if seen.insert(path.clone()) {
            unique_paths.push(path);
        }
    }

    let out = unique_paths
        .par_iter()
        .map(|path| {
            (
                path.clone(),
                load_image_toml_fields_for_batch(path, &key_lookup, &key_signature),
            )
        })
        .collect();
    Ok(out)
}

fn load_image_toml_fields_for_batch(
    path: &str,
    key_lookup: &HashMap<String, String>,
    key_signature: &str,
) -> HashMap<String, String> {
    match load_image_toml_fields(Path::new(path), key_lookup, key_signature) {
        Ok(data) => data,
        Err(err) => {
            tracing::warn!(%path, %err, "image TOML field batch item failed");
            HashMap::new()
        }
    }
}

fn load_image_toml_fields(
    path: &Path,
    key_lookup: &HashMap<String, String>,
    key_signature: &str,
) -> AppResult<HashMap<String, String>> {
    if key_lookup.is_empty() {
        return Ok(HashMap::new());
    }

    let path_key = path.to_string_lossy().into_owned();
    let cache_key = format!("{path_key}\0{key_signature}");
    let signature = toml_signature(path)?;

    if let Some(cached) = TOML_FIELD_CACHE.get(&cache_key) {
        if cached.signature == signature {
            cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
            return Ok(cached.data.clone());
        }
    }

    let data = parse_image_toml_fields(path, key_lookup)?;
    TOML_FIELD_CACHE.insert(
        cache_key,
        Arc::new(CachedTomlFields {
            signature,
            data: data.clone(),
            last_used: AtomicU64::new(next_cache_tick()),
        }),
    );
    prune_cache(&TOML_FIELD_CACHE, TOML_FIELD_CACHE_LIMIT, |entry| {
        entry.last_used.load(Ordering::Relaxed)
    });
    Ok(data)
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
            if cached.signature == signature && (cached.path.is_empty() || Path::new(&cached.path).exists()) {
                cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
                return Ok(cached.path.clone());
            }
        }
    }

    if let Some(cached) = THUMBNAIL_CACHE.get(&cache_key) {
        if cached.signature == signature && (cached.path.is_empty() || Path::new(&cached.path).exists()) {
            cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
            return Ok(cached.path.clone());
        }
    }

    let Some(encoded) = (if fast_only {
        embedded_thumbnail_data_url_from_jpeg_file(path, size)
            .or_else(|| platform_thumbnail_data_url(path, size))
    } else {
        Some(generate_image_thumbnail(path, size)?)
    }) else {
        THUMBNAIL_CACHE.insert(
            cache_key,
            Arc::new(CachedThumbnail {
                signature,
                path: String::new(),
                last_used: AtomicU64::new(next_cache_tick()),
            }),
        );
        prune_cache(&THUMBNAIL_CACHE, THUMBNAIL_CACHE_LIMIT, |entry| {
            entry.last_used.load(Ordering::Relaxed)
        });
        return Ok(String::new());
    };

    let thumb_path = write_thumbnail_cache_file(path, size, fast_only, &signature, encoded)?;
    THUMBNAIL_CACHE.insert(
        cache_key,
        Arc::new(CachedThumbnail {
            signature,
            path: thumb_path.clone(),
            last_used: AtomicU64::new(next_cache_tick()),
        }),
    );
    prune_cache(&THUMBNAIL_CACHE, THUMBNAIL_CACHE_LIMIT, |entry| {
        entry.last_used.load(Ordering::Relaxed)
    });
    Ok(thumb_path)
}

fn write_thumbnail_cache_file(
    path: &Path,
    size: u32,
    fast_only: bool,
    signature: &TomlSignature,
    encoded: EncodedThumbnail,
) -> AppResult<String> {
    let dir = thumbnail_cache_dir();
    fs::create_dir_all(&dir)?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    size.hash(&mut hasher);
    fast_only.hash(&mut hasher);
    signature.len.hash(&mut hasher);
    signature_modified_key(signature).hash(&mut hasher);
    encoded.extension.hash(&mut hasher);

    let file_path = dir.join(format!("{:016x}.{}", hasher.finish(), encoded.extension));
    if !file_path.exists() {
        fs::write(&file_path, encoded.bytes)?;
    }
    Ok(file_path.to_string_lossy().into_owned())
}

fn thumbnail_cache_dir() -> PathBuf {
    std::env::temp_dir().join("luxe-tauri").join("image-thumbnails")
}

fn signature_modified_key(signature: &TomlSignature) -> u128 {
    signature
        .modified
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn generate_image_thumbnail(path: &Path, size: u32) -> AppResult<EncodedThumbnail> {
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

fn embedded_thumbnail_data_url_from_jpeg_file(path: &Path, size: u32) -> Option<EncodedThumbnail> {
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

fn embedded_thumbnail_data_url(
    exif: &[u8],
    orientation: Orientation,
    size: u32,
) -> Option<EncodedThumbnail> {
    let jpeg = extract_exif_jpeg_thumbnail(exif)?;
    if orientation == Orientation::NoTransforms {
        return Some(EncodedThumbnail {
            bytes: jpeg.to_vec(),
            extension: "jpg",
        });
    }

    let mut img = image::load_from_memory(jpeg).ok()?;
    img.apply_orientation(orientation);
    encode_png_thumbnail_data_url(img, size).ok()
}

fn encode_png_thumbnail_data_url(img: DynamicImage, size: u32) -> AppResult<EncodedThumbnail> {
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
    Ok(EncodedThumbnail {
        bytes,
        extension: "png",
    })
}

#[cfg(target_os = "windows")]
fn platform_thumbnail_data_url(path: &Path, size: u32) -> Option<EncodedThumbnail> {
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
) -> Option<EncodedThumbnail> {
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
fn platform_thumbnail_data_url(_path: &Path, _size: u32) -> Option<EncodedThumbnail> {
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

fn selected_key_lookup(keys: &[String]) -> HashMap<String, String> {
    let mut lookup = HashMap::with_capacity(keys.len() * 2);
    for key in keys {
        lookup.entry(key.to_ascii_lowercase()).or_insert_with(|| key.clone());
    }
    lookup
}

fn parse_image_toml_fields(
    path: &Path,
    key_lookup: &HashMap<String, String>,
) -> AppResult<HashMap<String, String>> {
    let text = fs::read_to_string(path)?;
    if let Some(out) = fast_parse_image_toml_fields(&text, key_lookup) {
        return Ok(out);
    }

    let root: toml::Value = toml::from_str(&text)?;
    let mut out: HashMap<String, String> = HashMap::with_capacity(key_lookup.len());
    walk_selected(&root, "", key_lookup, &mut out);
    Ok(out)
}

fn fast_parse_image_toml_fields(
    text: &str,
    key_lookup: &HashMap<String, String>,
) -> Option<HashMap<String, String>> {
    let mut out = HashMap::with_capacity(key_lookup.len());
    let mut section: Vec<String> = Vec::new();

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with("[[") {
            return None;
        }

        if line.starts_with('[') {
            let closing = find_unquoted_char(line, ']')?;
            let trailing = strip_inline_comment(line.get(closing + 1..).unwrap_or(""))?;
            if !trailing.trim().is_empty() {
                return None;
            }
            section = parse_toml_key_path(line.get(1..closing)?.trim())?;
            continue;
        }

        let Some(eq_pos) = find_unquoted_char(line, '=') else {
            continue;
        };
        let key_path = parse_toml_key_path(line.get(..eq_pos)?.trim())?;
        let raw_value = strip_inline_comment(line.get(eq_pos + 1..).unwrap_or(""))?;
        let full_path = compose_toml_path(&section, &key_path);
        if !is_selected_toml_path(&full_path, key_lookup) {
            if value_needs_full_toml_context(raw_value.trim()) {
                return None;
            }
            continue;
        }

        let value = parse_simple_toml_value(raw_value.trim())?;
        insert_selected_value(&full_path, value, key_lookup, &mut out);
    }

    Some(out)
}

fn compose_toml_path(section: &[String], key_path: &[String]) -> String {
    if section.is_empty() {
        return key_path.join(".");
    }

    let mut parts = Vec::with_capacity(section.len() + key_path.len());
    parts.extend(section.iter().cloned());
    parts.extend(key_path.iter().cloned());
    parts.join(".")
}

fn is_selected_toml_path(full_path: &str, key_lookup: &HashMap<String, String>) -> bool {
    if key_lookup.contains_key(&full_path.to_ascii_lowercase()) {
        return true;
    }
    full_path
        .rsplit('.')
        .next()
        .map(|leaf| key_lookup.contains_key(&leaf.to_ascii_lowercase()))
        .unwrap_or(false)
}

fn value_needs_full_toml_context(raw: &str) -> bool {
    let raw = raw.trim();
    raw.starts_with("\"\"\"")
        || raw.starts_with("'''")
        || (raw.starts_with('[') && !raw.ends_with(']'))
        || (raw.starts_with('{') && !raw.ends_with('}'))
}

fn find_unquoted_char(text: &str, needle: char) -> Option<usize> {
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for (index, ch) in text.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }

        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == needle => return Some(index),
            None => {}
        }
    }

    None
}

fn strip_inline_comment(text: &str) -> Option<&str> {
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for (index, ch) in text.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }

        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == '#' => return text.get(..index),
            None => {}
        }
    }

    if quote.is_some() {
        return None;
    }
    Some(text)
}

fn parse_toml_key_path(raw: &str) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut part_start = 0;
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for (index, ch) in raw.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }

        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == '.' => {
                parts.push(parse_toml_key_part(raw.get(part_start..index)?.trim())?);
                part_start = index + ch.len_utf8();
            }
            None => {}
        }
    }

    if quote.is_some() {
        return None;
    }
    parts.push(parse_toml_key_part(raw.get(part_start..)?.trim())?);
    Some(parts)
}

fn parse_toml_key_part(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }

    if (raw.starts_with('"') && raw.ends_with('"')) || (raw.starts_with('\'') && raw.ends_with('\'')) {
        return Some(raw.get(1..raw.len().checked_sub(1)?)?.to_string());
    }

    Some(raw.to_string())
}

fn parse_simple_toml_value(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with("\"\"\"") || raw.starts_with("'''") {
        return None;
    }

    if raw.starts_with('"') {
        return parse_basic_toml_string(raw);
    }
    if raw.starts_with('\'') {
        return parse_literal_toml_string(raw);
    }
    if raw.starts_with('[') {
        return parse_simple_toml_array(raw);
    }
    if raw.starts_with('{') {
        return None;
    }
    if raw.eq_ignore_ascii_case("true") {
        return Some("true".to_string());
    }
    if raw.eq_ignore_ascii_case("false") {
        return Some("false".to_string());
    }

    Some(normalise_toml_number_or_raw(raw))
}

fn parse_basic_toml_string(raw: &str) -> Option<String> {
    if !raw.ends_with('"') || raw.len() < 2 {
        return None;
    }

    let inner = raw.get(1..raw.len().checked_sub(1)?)?;
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }

        let escaped = chars.next()?;
        match escaped {
            'b' => out.push('\u{0008}'),
            't' => out.push('\t'),
            'n' => out.push('\n'),
            'f' => out.push('\u{000C}'),
            'r' => out.push('\r'),
            '"' => out.push('"'),
            '\\' => out.push('\\'),
            'u' | 'U' => return None,
            _ => return None,
        }
    }
    Some(out)
}

fn parse_literal_toml_string(raw: &str) -> Option<String> {
    if !raw.ends_with('\'') || raw.len() < 2 {
        return None;
    }
    Some(raw.get(1..raw.len().checked_sub(1)?)?.to_string())
}

fn parse_simple_toml_array(raw: &str) -> Option<String> {
    if !raw.ends_with(']') {
        return None;
    }

    let inner = raw.get(1..raw.len().checked_sub(1)?)?;
    if inner.trim().is_empty() {
        return Some(String::new());
    }

    let mut items = Vec::new();
    let mut start = 0;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, ch) in inner.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }

        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == '[' || ch == '{' => return None,
            None if ch == ',' => {
                items.push(parse_simple_toml_value(inner.get(start..index)?.trim())?);
                start = index + ch.len_utf8();
            }
            None => {}
        }
    }

    if quote.is_some() {
        return None;
    }
    items.push(parse_simple_toml_value(inner.get(start..)?.trim())?);
    Some(items.join(", "))
}

fn normalise_toml_number_or_raw(raw: &str) -> String {
    let compact = raw.replace('_', "");
    if let Ok(value) = compact.parse::<i64>() {
        return value.to_string();
    }
    if let Ok(value) = compact.parse::<f64>() {
        if value.is_finite() && value.fract() == 0.0 {
            return format!("{value:.0}");
        }
        if value.is_finite() {
            return format!("{value}");
        }
        return compact;
    }
    raw.to_string()
}

fn walk_selected(
    v: &toml::Value,
    prefix: &str,
    key_lookup: &HashMap<String, String>,
    out: &mut HashMap<String, String>,
) {
    match v {
        toml::Value::Table(t) => {
            for (k, child) in t.iter() {
                let full = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                walk_selected(child, &full, key_lookup, out);
            }
        }
        toml::Value::Array(a) => {
            let joined: Vec<String> = a.iter().map(stringify).collect();
            insert_selected_value(prefix, joined.join(", "), key_lookup, out);
        }
        _ => {
            insert_selected_value(prefix, stringify(v), key_lookup, out);
        }
    }
}

fn insert_selected_value(
    full_path: &str,
    value: String,
    key_lookup: &HashMap<String, String>,
    out: &mut HashMap<String, String>,
) {
    if full_path.is_empty() {
        return;
    }

    if let Some(key) = key_lookup.get(&full_path.to_ascii_lowercase()) {
        out.entry(key.clone()).or_insert_with(|| value.clone());
    }
    if let Some(leaf) = full_path.rsplit('.').next() {
        if let Some(key) = key_lookup.get(&leaf.to_ascii_lowercase()) {
            out.entry(key.clone()).or_insert(value);
        }
    }
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
