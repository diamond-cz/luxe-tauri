use crate::error::AppResult;

#[tauri::command]
pub fn read_text_file(path: String) -> AppResult<String> {
    Ok(std::fs::read_to_string(&path)?)
}
