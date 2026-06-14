//! Automation data model + on-disk JSON store + trigger evaluation +
//! executor + scheduler.
//!
//! ### Submodules
//!
//! - `mod.rs` (this file) — owns the `Automation`, `Trigger`, `Action`,
//!   `RunRecord`, `AutomationStore`, `AutomationPatch` types and the
//!   on-disk JSON store at `<app_dir>/automations.json`. Pure data layer.
//! - `trigger.rs` — cron + interval + on-app-start evaluation. No I/O.
//! - `manager.rs` — `AutomationManager`: async owner of the store, dedupe
//!   state, run history. The only place that touches disk.
//! - `executor.rs` — sequential action execution. Maps each `Action` to
//!   the underlying subsystem (todos, email, discord, memory, notifications,
//!   sub-automations). Failures are isolated per-action.
//! - `scheduler.rs` — the tokio interval task that fires due automations.
//!
//! ### On-disk layout
//!
//! `<app_dir>/automations.json` (pretty-printed).
//! Loaded once at startup by `AutomationManager::new()` and persisted after
//! every mutating call. Run history is stored alongside the definitions
//! (capped at `MAX_RUN_HISTORY`).
//!
//! ### Concurrency
//!
//! The manager wraps the in-memory state in a `tokio::Mutex` so async
//! callers (commands, scheduler, executor) can share it safely. Every
//! public mutating method on the manager takes the lock and re-saves the
//! file on success.

pub mod executor;
pub mod manager;
pub mod scheduler;
pub mod trigger;

use crate::storage::get_app_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CURRENT_AUTOMATIONS_VERSION: u32 = 1;

/// Top-level on-disk container.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct AutomationStore {
    pub automations: Vec<Automation>,
    #[serde(default)]
    pub run_history: Vec<RunRecord>,
    #[serde(default = "default_version")]
    pub version: u32,
}

fn default_version() -> u32 {
    CURRENT_AUTOMATIONS_VERSION
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Automation {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub trigger: Trigger,
    pub actions: Vec<Action>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Trigger {
    /// Standard 5-field cron expression: `minute hour day-of-month month day-of-week`.
    /// Use `*` for "every". We only support the standard 5-field form (no
    /// seconds, no year, no special L/W/# extensions). Parsing is permissive —
    /// unknown fields are clamped to "*" so a malformed expression never panics.
    Cron { expr: String },
    /// Fire every N minutes (>= 1). The window is `(now / N) * N` Unix-seconds.
    Interval { minutes: u32 },
    /// Fire once on app startup. The "window" is the start-time of the
    /// process, recorded in `AutomationManager::start_time_unix` so the
    /// scheduler only fires it on the first matching tick.
    OnAppStart,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    AddTodo { text: String, time: Option<String> },
    SendEmail { to: String, subject: String, body: String },
    DiscordSendDm { user_id: String, message: String },
    DiscordSendChannel {
        channel_id: String,
        message: String,
    },
    RememberFact {
        category: String,
        key: String,
        value: String,
    },
    RecallFact { query: String, k: Option<u32> },
    /// Local OS notification. Falls back to a log line when the
    /// `tauri-plugin-notification` crate is not present in the build (see
    /// `crate::notifications`).
    SendNotification { title: String, body: String },
    /// Compose — fire another automation by id. Cycles are detected at run-time
    /// by the executor and rejected.
    RunAutomation { id: String },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunRecord {
    pub id: String,
    pub automation_id: String,
    pub started_at: i64,
    pub finished_at: i64,
    pub ok: bool,
    pub results: Vec<ActionResult>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActionResult {
    /// Stable identifier of the action slot within the automation — index-based
    /// because the `Action` enum is not `Hash`. The executor stamps these so
    /// the UI can highlight "which step failed".
    pub index: usize,
    pub ok: bool,
    pub message: String,
}

/// Partial update for an existing automation. Any field that is `None` is
/// left untouched. `trigger` / `actions` are full-replace fields.
#[derive(Debug, Default, Deserialize, Clone)]
pub struct AutomationPatch {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub trigger: Option<Trigger>,
    pub actions: Option<Vec<Action>>,
}

pub fn get_automations_path() -> PathBuf {
    let mut p = get_app_dir();
    p.push("automations.json");
    p
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn now_nanos() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

pub fn generate_automation_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = now_nanos();
    format!("a_{:x}_{:x}", ts, n)
}

pub fn generate_run_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = now_nanos();
    format!("r_{:x}_{:x}", ts, n)
}

impl AutomationStore {
    pub fn new() -> Self {
        Self {
            automations: Vec::new(),
            run_history: Vec::new(),
            version: CURRENT_AUTOMATIONS_VERSION,
        }
    }

    /// Load the store from disk. Returns an empty store if the file does not
    /// exist or is corrupt (corrupt files are backed up to `*.json.bak`).
    pub fn load() -> Self {
        let path = get_automations_path();
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                match serde_json::from_str::<AutomationStore>(&content) {
                    Ok(mut s) => {
                        s.migrate();
                        return s;
                    }
                    Err(e) => {
                        eprintln!(
                            "[AUTOMATIONS] Error deserializing automations.json: {}. Backing up and starting fresh.",
                            e
                        );
                        let mut backup = path.clone();
                        backup.set_extension("json.bak");
                        let _ = fs::write(&backup, &content);
                    }
                }
            }
        }
        Self::new()
    }

    /// Persist the store to disk, creating the app dir if needed.
    pub fn save(&self) -> Result<(), String> {
        let path = get_automations_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    fn migrate(&mut self) {
        if self.version < CURRENT_AUTOMATIONS_VERSION {
            // Reserved for future schema migrations. The v1 -> v1 path is a no-op.
            self.version = CURRENT_AUTOMATIONS_VERSION;
        }
    }
}

impl Automation {
    pub fn new(name: String, trigger: Trigger, actions: Vec<Action>) -> Self {
        let now = now_unix();
        Self {
            id: generate_automation_id(),
            name,
            enabled: true,
            trigger,
            actions,
            created_at: now,
            updated_at: now,
        }
    }
}

impl RunRecord {
    pub fn new(automation_id: String) -> Self {
        Self {
            id: generate_run_id(),
            automation_id,
            started_at: now_unix(),
            finished_at: 0,
            ok: true,
            results: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automation_id_is_unique() {
        let a = generate_automation_id();
        let b = generate_automation_id();
        assert_ne!(a, b);
        assert!(a.starts_with("a_"));
        assert!(b.starts_with("a_"));
    }

    #[test]
    fn automation_new_stamps_timestamps() {
        let a = Automation::new(
            "morning".to_string(),
            Trigger::Interval { minutes: 60 },
            vec![],
        );
        assert!(a.created_at > 0);
        assert_eq!(a.created_at, a.updated_at);
        assert!(a.enabled);
    }

    #[test]
    fn store_round_trips_via_serde() {
        let mut store = AutomationStore::new();
        store.automations.push(Automation::new(
            "n".to_string(),
            Trigger::OnAppStart,
            vec![Action::SendNotification {
                title: "hi".to_string(),
                body: "hello".to_string(),
            }],
        ));
        let s = serde_json::to_string(&store).unwrap();
        let back: AutomationStore = serde_json::from_str(&s).unwrap();
        assert_eq!(back.automations.len(), 1);
        assert_eq!(back.automations[0].name, "n");
        assert!(back.automations[0].enabled);
    }

    #[test]
    fn action_serializes_with_type_tag() {
        let a = Action::AddTodo {
            text: "drink water".to_string(),
            time: None,
        };
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(v["type"], "add_todo");
        assert_eq!(v["text"], "drink water");
        assert!(v["time"].is_null());
    }

    #[test]
    fn trigger_serializes_with_type_tag() {
        let t = Trigger::Cron {
            expr: "0 9 * * *".to_string(),
        };
        let v = serde_json::to_value(&t).unwrap();
        assert_eq!(v["type"], "cron");
        assert_eq!(v["expr"], "0 9 * * *");
    }

    #[test]
    fn run_record_starts_with_no_finish() {
        let r = RunRecord::new("a_1".to_string());
        assert_eq!(r.automation_id, "a_1");
        assert!(r.finished_at == 0);
        assert!(r.ok);
        assert!(r.results.is_empty());
    }

    #[test]
    fn automation_patch_defaults_are_empty() {
        let p = AutomationPatch::default();
        assert!(p.name.is_none());
        assert!(p.enabled.is_none());
        assert!(p.trigger.is_none());
        assert!(p.actions.is_none());
    }

    #[test]
    fn enabled_field_round_trips_via_serde() {
        // Defaulted true when missing.
        let json = r#"{
            "id": "a_1",
            "name": "x",
            "trigger": { "type": "on_app_start" },
            "actions": [],
            "created_at": 0,
            "updated_at": 0
        }"#;
        let a: Automation = serde_json::from_str(json).unwrap();
        assert!(a.enabled);
    }
}
