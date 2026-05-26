use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::config::Isp6sSchema;
use crate::cpp_parser::{
    card_source::{resolve, CardSourceHit, CardSourceSpec},
    path_query::{self, ValuesAtPath},
    search::{self, SectionInfo},
    types::{FieldEntry, ParseResult, StructNode},
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

fn resolve_path(p: &str) -> PathBuf {
    PathBuf::from(p)
}

#[tauri::command]
pub async fn parse_cpp_file(
    state: State<'_, AppState>,
    path:  String,
) -> AppResult<ParseResult> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok((*parsed).clone())
}

#[tauri::command]
pub async fn cpp_get_fields_at_path(
    state: State<'_, AppState>,
    path:  String,
    query: String,
) -> AppResult<Vec<FieldEntry>> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok(path_query::get_fields_at_path(&parsed, &query)
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn cpp_get_values_at_path(
    state: State<'_, AppState>,
    path:  String,
    query: String,
    key:   Option<u8>,
) -> AppResult<ValuesAtPath> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok(path_query::get_values_at_path(&parsed, &query, key.unwrap_or(0)))
}

#[tauri::command]
pub async fn cpp_get_node_at_path(
    state: State<'_, AppState>,
    path:  String,
    query: String,
) -> AppResult<Option<StructNode>> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok(path_query::get_node_at_path(&parsed, &query).cloned())
}

#[tauri::command]
pub async fn cpp_search_by_comment(
    state: State<'_, AppState>,
    path:    String,
    pattern: String,
    case_sensitive: Option<bool>,
) -> AppResult<Vec<FieldEntry>> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok(search::search_by_comment(&parsed, &pattern, case_sensitive.unwrap_or(false))
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn cpp_search_by_value(
    state: State<'_, AppState>,
    path:  String,
    value: String,
) -> AppResult<Vec<FieldEntry>> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok(search::search_by_value(&parsed, &value).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn cpp_get_fields_by_line(
    state: State<'_, AppState>,
    path:  String,
    line:  u32,
) -> AppResult<Vec<FieldEntry>> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok(search::get_fields_by_line(&parsed, line).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn cpp_get_fields_in_range(
    state: State<'_, AppState>,
    path:  String,
    start: u32,
    end:   u32,
) -> AppResult<Vec<FieldEntry>> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok(search::get_fields_in_range(&parsed, start, end).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn cpp_get_section_names(
    state: State<'_, AppState>,
    path:  String,
) -> AppResult<Vec<SectionInfo>> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok(search::get_section_names(&parsed))
}

#[tauri::command]
pub async fn cpp_clear_cache(state: State<'_, AppState>) -> AppResult<()> {
    state.cpp_parser.clear();
    Ok(())
}

#[tauri::command]
pub fn get_isp6s_schema(app: AppHandle) -> AppResult<Isp6sSchema> {
    let p = resolve_isp6s_path(&app)?;
    Isp6sSchema::load(&p)
}

#[tauri::command]
pub async fn cpp_resolve_card_source(
    state: State<'_, AppState>,
    path:  String,
    spec:  CardSourceSpec,
) -> AppResult<CardSourceHit> {
    let cache = Arc::clone(&state.cpp_parser);
    let p = resolve_path(&path);
    let p2 = p.clone();
    let parsed = tauri::async_runtime::spawn_blocking(move || cache.get(&p2))
        .await
        .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    let spec_owned = spec;
    let p3 = p.clone();
    let hit = tauri::async_runtime::spawn_blocking(move || {
        resolve(&p3, &parsed, &spec_owned)
    })
    .await
    .map_err(|err| AppError::Other(format!("join error: {err}")))??;
    Ok(hit)
}

fn resolve_isp6s_path(app: &AppHandle) -> AppResult<PathBuf> {
    if let Ok(base) = app.path().resource_dir() {
        let p = base.join("resources").join("Isp6s.toml");
        if p.is_file() { return Ok(p); }
        let p = base.join("Isp6s.toml");
        if p.is_file() { return Ok(p); }
    }
    // Dev fallback — relative to CARGO_MANIFEST_DIR
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("Isp6s.toml");
    if dev.is_file() { return Ok(dev); }
    Err(AppError::NotFound("Isp6s.toml".into()))
}
