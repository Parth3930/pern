//! Tauri command surface for the automation system.
//!
//! Every command takes the shared `AppState` and converts the in-memory
//! `Arc<AutomationManager>` into the public types re-exported by
//! `crate::automations`. Errors are surfaced as `Result<T, String>`.

use crate::automations::{Action, Automation, AutomationPatch, RunRecord, Trigger};
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn list_automations(
    state: State<'_, AppState>,
) -> Result<Vec<Automation>, String> {
    Ok(state.automation_manager.list().await)
}

#[tauri::command]
pub async fn get_automation(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Automation>, String> {
    Ok(state.automation_manager.get(&id).await)
}

#[tauri::command]
pub async fn create_automation(
    name: String,
    trigger: Trigger,
    actions: Vec<Action>,
    state: State<'_, AppState>,
) -> Result<Automation, String> {
    state
        .automation_manager
        .create(name, trigger, actions)
        .await
}

#[tauri::command]
pub async fn update_automation(
    id: String,
    patch: AutomationPatch,
    state: State<'_, AppState>,
) -> Result<Automation, String> {
    state.automation_manager.update(&id, patch).await
}

#[tauri::command]
pub async fn delete_automation(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.automation_manager.delete(&id).await
}

#[tauri::command]
pub async fn run_automation_now(
    id: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<RunRecord, String> {
    let mgr: Arc<_> = state.automation_manager.clone();
    let app_state: Arc<AppState> = Arc::new(state.inner().clone());
    mgr.trigger_run(&id, app_state, Some(app_handle)).await
}

#[tauri::command]
pub async fn get_run_history(
    automation_id: String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<RunRecord>, String> {
    Ok(state
        .automation_manager
        .run_history(&automation_id, limit)
        .await)
}
