//! Tauri command surface for the long-term memory graph.
//!
//! Every command takes the shared `AppState` (which holds the in-memory
//! `Arc<Mutex<MemoryGraph>>`) and converts it into the public Rust types
//! re-exported by `crate::memory_graph`. Errors are surfaced as
//! `Result<T, String>` so the frontend gets a readable string.

use crate::memory_graph::{
    Entity, EntityCategory, EntityPatch, Relation, SearchHit,
};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn memory_list_entities(
    category: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Entity>, String> {
    let g = state.memory_graph.lock().await;
    let cat = match category.as_deref() {
        None | Some("") => None,
        Some(s) => Some(EntityCategory::from_str(s).ok_or_else(|| {
            format!("Invalid category '{}'. Expected: person, project, preference, recurring_task, other.", s)
        })?),
    };
    Ok(g.list(cat))
}

#[tauri::command]
pub async fn memory_get_entity(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Entity>, String> {
    let g = state.memory_graph.lock().await;
    Ok(g.get(&id))
}

#[tauri::command]
pub async fn memory_add_entity(
    category: String,
    key: String,
    value: String,
    aliases: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<Entity, String> {
    let cat = EntityCategory::from_str(&category).ok_or_else(|| {
        format!(
            "Invalid category '{}'. Expected: person, project, preference, recurring_task, other.",
            category
        )
    })?;
    let aliases = aliases.unwrap_or_default();
    let mut g = state.memory_graph.lock().await;
    g.add(cat, key, value, aliases, Some("user".to_string()))
}

#[tauri::command]
pub async fn memory_update_entity(
    id: String,
    patch: EntityPatch,
    state: State<'_, AppState>,
) -> Result<Entity, String> {
    let mut g = state.memory_graph.lock().await;
    g.update(&id, patch)
}

#[tauri::command]
pub async fn memory_delete_entity(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut g = state.memory_graph.lock().await;
    g.delete(&id)
}

#[tauri::command]
pub async fn memory_search(
    query: String,
    k: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchHit>, String> {
    let g = state.memory_graph.lock().await;
    let k = k.unwrap_or(10).max(1) as usize;
    Ok(g.search(&query, k))
}

#[tauri::command]
pub async fn memory_add_relation(
    from_id: String,
    to_id: String,
    label: String,
    state: State<'_, AppState>,
) -> Result<Relation, String> {
    let mut g = state.memory_graph.lock().await;
    g.add_relation(&from_id, &to_id, &label)
}

#[tauri::command]
pub async fn memory_delete_relation(
    from_id: String,
    to_id: String,
    label: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut g = state.memory_graph.lock().await;
    g.delete_relation(&from_id, &to_id, &label)
}

#[tauri::command]
pub async fn memory_list_relations(
    from_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Relation>, String> {
    let g = state.memory_graph.lock().await;
    Ok(g.list_relations(from_id.as_deref()))
}

/// Clear the in-memory `conversation_summary` and persist the change. The
/// frontend calls this when a new chat session starts, NOT on every app
/// launch (see the regression test in `storage.rs`).
#[tauri::command]
pub async fn clear_conversation_summary(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    crate::storage::clear_conversation_summary(&mut config);
    crate::storage::save_config(&config)
}
