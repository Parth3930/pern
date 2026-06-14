//! Async-friendly owner of the automation store + run history.
//!
//! Wraps `AutomationStore` in a `tokio::Mutex` so commands, the scheduler,
//! and the executor can share state. The manager is the only place that
//! touches the on-disk JSON file.
//!
//! Idempotency: the manager records the last-seen trigger window per
//! automation. `should_fire` returns `true` exactly once per new window.

use crate::automations::trigger::evaluate_trigger_window;
use crate::automations::{
    Automation, AutomationPatch, AutomationStore, RunRecord,
};
use crate::state::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::Mutex;

pub const AUTOMATION_FIRED_EVENT: &str = "automation_fired";
pub const MAX_RUN_HISTORY: usize = 200;

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Debug)]
pub struct AutomationManager {
    store: Mutex<AutomationStore>,
    /// Last-seen trigger window per automation id. Used to dedupe ticks.
    last_window: Mutex<HashMap<String, i64>>,
    /// Recorded process start time (unix seconds). Used as the
    /// `OnAppStart` window so the scheduler only fires once.
    start_time_unix: i64,
}

impl AutomationManager {
    pub fn new() -> Self {
        let start_time_unix = now_unix_secs();
        Self {
            store: Mutex::new(AutomationStore::load()),
            last_window: Mutex::new(HashMap::new()),
            start_time_unix,
        }
    }

    pub fn start_time_unix(&self) -> i64 {
        self.start_time_unix
    }

    pub async fn list(&self) -> Vec<Automation> {
        self.store.lock().await.automations.clone()
    }

    pub async fn get(&self, automation_id: &str) -> Option<Automation> {
        self.store
            .lock()
            .await
            .automations
            .iter()
            .find(|a| a.id == automation_id)
            .cloned()
    }

    pub async fn create(
        &self,
        name: String,
        trigger: crate::automations::Trigger,
        actions: Vec<crate::automations::Action>,
    ) -> Result<Automation, String> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("Automation name cannot be empty".to_string());
        }
        if actions.is_empty() {
            return Err("Automation must have at least one action".to_string());
        }
        let auto = Automation::new(name, trigger, actions);
        {
            let mut store = self.store.lock().await;
            store.automations.push(auto.clone());
            store.save()?;
        }
        Ok(auto)
    }

    pub async fn update(
        &self,
        id: &str,
        patch: AutomationPatch,
    ) -> Result<Automation, String> {
        // Take the lock once and resolve the target index.
        let mut store = self.store.lock().await;
        let target_idx = store
            .automations
            .iter()
            .position(|a| a.id == id)
            .ok_or_else(|| format!("Automation '{}' not found", id))?;
        let mut updated = store.automations[target_idx].clone();
        if let Some(name) = patch.name {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                return Err("Automation name cannot be empty".to_string());
            }
            updated.name = trimmed.to_string();
        }
        if let Some(enabled) = patch.enabled {
            updated.enabled = enabled;
        }
        if let Some(trigger) = patch.trigger {
            updated.trigger = trigger;
        }
        if let Some(actions) = patch.actions {
            if actions.is_empty() {
                return Err("Automation must have at least one action".to_string());
            }
            updated.actions = actions;
        }
        updated.updated_at = now_unix_secs();
        store.automations[target_idx] = updated.clone();
        store.save()?;
        drop(store);
        // Reset dedupe window for this automation so an update re-evaluates
        // cleanly on the next tick.
        self.last_window.lock().await.remove(id);
        Ok(updated)
    }

    pub async fn delete(&self, id: &str) -> Result<(), String> {
        let mut store = self.store.lock().await;
        let before = store.automations.len();
        store.automations.retain(|a| a.id != id);
        if store.automations.len() == before {
            return Err(format!("Automation '{}' not found", id));
        }
        store.save()?;
        drop(store);
        self.last_window.lock().await.remove(id);
        Ok(())
    }

    /// Returns the new run record. `trigger_run` does NOT dedupe — callers
    /// (commands vs scheduler) have different dedupe semantics. The command
    /// wants an immediate run; the scheduler is gated by `should_fire`.
    pub async fn trigger_run(
        &self,
        automation_id: &str,
        state: Arc<AppState>,
        app_handle: Option<AppHandle>,
    ) -> Result<RunRecord, String> {
        let automation = self
            .get(automation_id)
            .await
            .ok_or_else(|| format!("Automation '{}' not found", automation_id))?;
        let record = crate::automations::executor::run_automation(
            &automation,
            state,
            self,
            app_handle.clone(),
        )
        .await;
        {
            let mut store = self.store.lock().await;
            store.run_history.push(record.clone());
            if store.run_history.len() > MAX_RUN_HISTORY {
                let drop_n = store.run_history.len() - MAX_RUN_HISTORY;
                store.run_history.drain(..drop_n);
            }
            let _ = store.save();
        }
        if let Some(handle) = app_handle {
            let _ = handle.emit(AUTOMATION_FIRED_EVENT, &record);
        }
        Ok(record)
    }

    pub async fn run_history(
        &self,
        automation_id: &str,
        limit: Option<u32>,
    ) -> Vec<RunRecord> {
        let store = self.store.lock().await;
        let mut out: Vec<RunRecord> = store
            .run_history
            .iter()
            .rev()
            .filter(|r| r.automation_id == automation_id)
            .cloned()
            .collect();
        let limit = limit.unwrap_or(20).max(1) as usize;
        out.truncate(limit);
        out
    }

    /// Persist a run record produced by the scheduler path. No event emit —
    /// the scheduler emits its own event after the run completes.
    pub async fn record_run(&self, record: RunRecord) -> Result<(), String> {
        let mut store = self.store.lock().await;
        store.run_history.push(record);
        if store.run_history.len() > MAX_RUN_HISTORY {
            let drop_n = store.run_history.len() - MAX_RUN_HISTORY;
            store.run_history.drain(..drop_n);
        }
        store.save()
    }

    /// Returns `true` exactly once per trigger window. The manager records
    /// the window it has already returned for, so the next call for the same
    /// window returns `false`.
    pub async fn should_fire(&self, automation: &Automation, now_unix: i64) -> bool {
        if !automation.enabled {
            return false;
        }
        let window = match evaluate_trigger_window(
            &automation.trigger,
            now_unix,
            self.start_time_unix,
        ) {
            Some(w) => w,
            None => return false,
        };
        let mut last = self.last_window.lock().await;
        if last.get(&automation.id).copied() == Some(window) {
            return false;
        }
        last.insert(automation.id.clone(), window);
        true
    }
}

impl Default for AutomationManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automations::Trigger;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now_unix() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }

    /// Idempotency dedupe: calling `should_fire` twice in the same trigger
    /// window must return `true` the first time and `false` the second
    /// time, even if both calls happen within the same minute.
    #[tokio::test]
    async fn should_fire_dedupes_within_same_window() {
        let mgr = AutomationManager::new();
        let auto = Automation::new(
            "test".to_string(),
            Trigger::Interval { minutes: 5 },
            vec![],
        );
        // Pin to a known window: take the floor of `now` to a 5-minute
        // boundary so the test is deterministic across runs.
        let t_floor = (now_unix() / 300) * 300;
        let t = t_floor + 60; // 1 minute into the window
        assert!(mgr.should_fire(&auto, t).await);
        // Same window (t_floor..t_floor+300) — should NOT fire again.
        assert!(!mgr.should_fire(&auto, t + 30).await);
        assert!(!mgr.should_fire(&auto, t + 239).await);
    }

    /// Idempotency dedupe: a *new* window must fire again. The test advances
    /// the instant past one full interval to ensure the window key changes.
    #[tokio::test]
    async fn should_fire_advances_to_new_window() {
        let mgr = AutomationManager::new();
        let auto = Automation::new(
            "test".to_string(),
            Trigger::Interval { minutes: 5 },
            vec![],
        );
        let t_floor = (now_unix() / 300) * 300;
        let t = t_floor + 60;
        assert!(mgr.should_fire(&auto, t).await);
        // Jump forward by 10 minutes — the +600s call lands in
        // `t_floor + 660` = `t_floor / 300 + 2.2` → window index 2. New
        // window — should fire.
        assert!(mgr.should_fire(&auto, t + 600).await);
        // Same window as the +600s call (still inside the second window) —
        // must not fire.
        assert!(!mgr.should_fire(&auto, t + 700).await);
    }

    /// Disabled automations never fire, regardless of window.
    #[tokio::test]
    async fn should_fire_respects_disabled_flag() {
        let mgr = AutomationManager::new();
        let mut auto = Automation::new(
            "test".to_string(),
            Trigger::Interval { minutes: 5 },
            vec![],
        );
        auto.enabled = false;
        assert!(!mgr.should_fire(&auto, now_unix()).await);
    }

    /// `OnAppStart` is windowless in the wall-clock sense — its window is
    /// the recorded process start time. Two distinct `now` values inside
    /// the same process both share the same window, so the dedupe works.
    #[tokio::test]
    async fn on_app_start_fires_once() {
        let mgr = AutomationManager::new();
        let start = mgr.start_time_unix();
        let auto = Automation::new(
            "boot".to_string(),
            Trigger::OnAppStart,
            vec![],
        );
        // `start` is the process start time — we test from any later instant.
        let probe = start + 1;
        assert!(mgr.should_fire(&auto, probe).await);
        // Same window (start) — no second fire.
        assert!(!mgr.should_fire(&auto, probe + 60).await);
    }
}
