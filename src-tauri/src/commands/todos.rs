#[tauri::command]
pub async fn get_todos() -> Result<serde_json::Value, String> {
    Ok(crate::storage::load_todos())
}

#[tauri::command]
pub async fn save_todos(todos: serde_json::Value) -> Result<(), String> {
    crate::storage::save_todos(&todos)
}
