//! Background tokio task that wakes every 30 seconds, evaluates triggers,
//! fires due automations, writes run records, and emits `automation_fired`.
//!
//! Idempotency: the manager dedupes by `(automation_id, trigger_window)` —
//! see `AutomationManager::should_fire`. The scheduler never decides
//! idempotency on its own; it just iterates and asks the manager.
//!
//! Android caveat: the loop will drift if the OS sleeps the process. The
//! scheduler is best-effort; this is explicitly accepted in the spec.

use crate::automations::manager::{AutomationManager, AUTOMATION_FIRED_EVENT};
use crate::automations::executor::run_automation;
use crate::automations::Automation;
use crate::state::AppState;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Emitter;

pub const SCHEDULER_TICK_SECS: u64 = 30;

/// Spawn the scheduler loop. Returns immediately. The task lives for the
/// lifetime of the process; it does not panic on transient errors.
pub fn spawn(
    manager: Arc<AutomationManager>,
    state: Arc<AppState>,
    app_handle: AppHandle,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(SCHEDULER_TICK_SECS)).await;
            let now_unix = now_unix_secs();
            let due = {
                let automations = manager.list().await;
                let mut out: Vec<Automation> = Vec::new();
                for a in automations {
                    if manager.should_fire(&a, now_unix).await {
                        out.push(a);
                    }
                }
                out
            };
            for auto in due {
                let record =
                    run_automation(&auto, state.clone(), manager.as_ref(), Some(app_handle.clone()))
                        .await;
                if let Err(e) = manager.record_run(record.clone()).await {
                    eprintln!(
                        "[AUTOMATIONS] Failed to persist run record for '{}': {}",
                        auto.id, e
                    );
                }
                let _ = app_handle.emit(AUTOMATION_FIRED_EVENT, &record);
                if !record.ok {
                    eprintln!(
                        "[AUTOMATIONS] Automation '{}' ({}) finished with failures",
                        auto.name, auto.id
                    );
                } else {
                    println!(
                        "[AUTOMATIONS] Fired '{}' ({} actions)",
                        auto.name,
                        record.results.len()
                    );
                }
            }
        }
    });
}

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
