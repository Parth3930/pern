#[tauri::command]
pub async fn get_notes() -> Result<serde_json::Value, String> {
    Ok(crate::storage::load_notes())
}

#[tauri::command]
pub async fn save_notes(notes: serde_json::Value) -> Result<(), String> {
    crate::storage::save_notes(&notes)
}
