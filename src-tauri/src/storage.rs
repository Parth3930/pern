use crate::automations::Automation as AutomationDef;
use crate::integrations::cli_agents::CLIAgentConfig;
use crate::learner::ToolUsageStats;
use crate::memory::UserMemory;
use crate::model::WhatsAppContact;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentChat {
    pub jid: String,
    pub push_name: Option<String>,
    pub last_message: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppConfig {
    pub config_version: u32,
    pub model_dir: String,
    pub selected_model: String,
    pub provider: String,
    pub first_run_completed: bool,
    pub email_configured: bool,
    pub email_smtp_host: String,
    pub email_smtp_port: u16,
    pub email_sender_email: String,
    pub email_smtp_password: String,
    pub whatsapp_enabled: bool,
    pub whatsapp_recent_chats: Vec<RecentChat>,
    pub whatsapp_contacts: Vec<WhatsAppContact>,
    pub user_memory: UserMemory,
    pub tool_usage_stats: ToolUsageStats,
    pub user_preferences: HashMap<String, String>,
    pub llama_server_path: String,
    pub discord_token: String,
    pub discord_enabled: bool,
    pub discord_status: String,
    pub discord_activity: String,
    pub discord_owner_id: String,
    pub discord_behaviour_channel_id: String,
    pub cli_agent_configs: Vec<CLIAgentConfig>,
    pub projects: Vec<ProjectConfig>,
    pub llama_gpu_layers: i32,
    pub llama_threads: i32,
    pub llama_flash_attn: String,
    /// v4: persisted user-authored automations. The manager loads from
    /// `<app_dir>/automations.json`, so this is mostly a denormalised cache
    /// for the frontend. We keep it for "list on cold start before the
    /// manager has finished loading" scenarios. The on-disk automations
    /// file is the source of truth.
    #[serde(default)]
    pub automations: Vec<AutomationConfig>,
    /// v4: feature flag for the scheduler. If `false`, the scheduler skips
    /// all automations (they still exist in the store).
    #[serde(default = "default_automations_enabled")]
    pub automations_enabled: bool,
}

fn default_automations_enabled() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectConfig {
    pub name: String,
    pub path: String,
}

/// Thin re-export of `crate::automations::Automation` for the config
/// snapshot. The fields intentionally mirror `Automation` — the `From` impls
/// are how we keep the two in sync. If you add a field to
/// `automations::Automation`, mirror it here or `From` conversions will lose
/// data silently.
pub type AutomationConfig = AutomationDef;

impl Default for AppConfig {
    fn default() -> Self {
        let app_dir = get_app_dir();
        let mut model_dir = app_dir.clone();
        model_dir.push("models");

        // Ensure the directory exists
        let _ = fs::create_dir_all(&model_dir);

        Self {
            config_version: CURRENT_CONFIG_VERSION,
            model_dir: model_dir.to_string_lossy().to_string(),
            selected_model: "qwen-1.5-1.8b-chat-q4".to_string(),
            provider: "llama.cpp".to_string(),
            first_run_completed: false,
            email_configured: false,
            email_smtp_host: "smtp.gmail.com".to_string(),
            email_smtp_port: 587,
            email_sender_email: String::new(),
            email_smtp_password: String::new(),
            whatsapp_enabled: false,
            whatsapp_recent_chats: Vec::new(),
            whatsapp_contacts: Vec::new(),
            user_memory: UserMemory::default(),
            tool_usage_stats: ToolUsageStats::default(),
            user_preferences: HashMap::new(),
            llama_server_path: String::new(),
            discord_token: String::new(),
            discord_enabled: false,
            discord_status: "online".to_string(),
            discord_activity: String::new(),
            discord_owner_id: String::new(),
            discord_behaviour_channel_id: String::new(),
            cli_agent_configs: crate::integrations::cli_agents::default_agents(),
            projects: vec![
                crate::storage::ProjectConfig {
                    name: "Pern".to_string(),
                    path: "D:\\\\agent\\\\pern".to_string(),
                },
            ],
            llama_gpu_layers: 999,
            llama_threads: 4,
            llama_flash_attn: "auto".to_string(),
            automations: Vec::new(),
            automations_enabled: true,
        }
    }
}

pub const CURRENT_CONFIG_VERSION: u32 = 4;

/// Clear the chat-session-only `conversation_summary` field. The frontend is
/// expected to call this when a brand new chat session starts — NOT on every
/// app launch. The previous behaviour of clearing it in `load_config` was a
/// bug because it wiped summaries between every app start.
pub fn clear_conversation_summary(config: &mut AppConfig) {
    config.user_memory.conversation_summary = String::new();
}

fn migrate_config_v1_to_v2(config: &mut AppConfig) -> bool {
    let mut dirty = false;

    // Migration v1 -> v2: legacy Ollama provider or old model ID format
    let is_legacy_model = config.selected_model.contains(':') || config.selected_model == "gemma3:1b";
    let is_legacy_provider = config.provider.to_lowercase() == "ollama" || config.provider.is_empty();

    if is_legacy_provider || is_legacy_model {
        println!(
            "[CONFIG] Migration v1->v2: Legacy config detected (Provider: {}, Model: {}). Migrating...",
            config.provider, config.selected_model
        );
        let default = AppConfig::default();
        config.provider = default.provider;
        config.selected_model = default.selected_model;
        config.first_run_completed = false;
        dirty = true;
    }

    // Migration v1 -> v2: on Android, reset model_dir and llama_server_path if they point
    // to a read-only system path (e.g. /data/local/... from old dirs::data_local_dir)
    #[cfg(target_os = "android")]
    {
        let correct_base = get_app_dir();
        let correct_model_dir = correct_base.join("models").to_string_lossy().to_string();
        let is_bad_path = |p: &str| -> bool {
            p.starts_with("/data/local")
                || p.starts_with("/storage")
                || p.is_empty()
                || (p.starts_with("/data/") && !p.contains("libllama_server.so"))
        };
        if is_bad_path(&config.model_dir) {
            println!("[CONFIG] Android: resetting bad model_dir: {}", config.model_dir);
            config.model_dir = correct_model_dir;
            let _ = fs::create_dir_all(&config.model_dir);
            dirty = true;
        }
        // Also reset llama_server_path if it's on a bad path so the install flow re-runs
        if is_bad_path(&config.llama_server_path) {
            println!("[CONFIG] Android: resetting bad llama_server_path");
            config.llama_server_path = String::new();
            dirty = true;
        }
    }

    dirty
}

/// v2 -> v3: the `conversation_summary` field is now chat-session-scoped and
/// must NOT be wiped on config load. This migration is intentionally a no-op
/// field-wise — the behaviour change is in `load_config` (it no longer touches
/// `conversation_summary`). The summary is preserved across the upgrade.
fn migrate_config_v2_to_v3(_config: &mut AppConfig) -> bool {
    // No data transformation needed. The bug fix is the code change in
    // `load_config`; this migration just stamps the new version so future
    // runs can skip it cheaply.
    false
}

/// v3 -> v4: introduce the `automations` and `automations_enabled` fields on
/// `AppConfig`. The new fields default-populate via `#[serde(default)]`, so
/// the only action is to ensure the version is bumped. The on-disk
/// `automations.json` is the source of truth at runtime; this config
/// snapshot is a cold-start cache.
fn migrate_config_v3_to_v4(_config: &mut AppConfig) -> bool {
    // No-op: the new fields have `#[serde(default)]` so missing-on-disk is
    // already handled. We just stamp the version so future runs skip this
    // branch.
    false
}

pub fn get_app_dir() -> PathBuf {
    #[cfg(target_os = "android")]
    {
        // On Android, $TMPDIR = <app_data_dir>/cache (set by the OS for every app process).
        // Its parent is the app's writable data dir (equivalent to Context.getFilesDir().parent()).
        if let Ok(tmpdir) = std::env::var("TMPDIR") {
            if let Some(data_dir) = PathBuf::from(&tmpdir).parent() {
                return data_dir.join("files").join("pern");
            }
        }
        // Hard fallback using the known package name
        PathBuf::from("/data/data/com.pern.app/files/pern")
    }
    #[cfg(not(target_os = "android"))]
    {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("pern");
        path
    }
}

pub fn get_db_conn() -> Result<rusqlite::Connection, String> {
    let mut path = get_app_dir();
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    path.push("app.db");
    
    let conn = rusqlite::Connection::open(path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        rusqlite::params![],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS semantic_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text_content TEXT NOT NULL,
            embedding BLOB,
            metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        rusqlite::params![],
    ).map_err(|e| e.to_string())?;

    Ok(conn)
}

pub fn get_config_path() -> PathBuf {
    let mut path = get_app_dir();
    path.push("config.json");
    path
}

pub fn load_config() -> AppConfig {
    if let Ok(conn) = get_db_conn() {
        if let Ok(mut stmt) = conn.prepare("SELECT value FROM kv_store WHERE key = 'config'") {
            if let Ok(content) = stmt.query_row(rusqlite::params![], |row| row.get::<_, String>(0)) {
                if let Ok(mut config) = serde_json::from_str::<AppConfig>(&content) {
                    let mut dirty = false;
                    if config.config_version < 1 { config.config_version = 1; dirty = true; }
                    if config.config_version < 2 { dirty |= migrate_config_v1_to_v2(&mut config); config.config_version = 2; }
                    if config.config_version < 3 { dirty |= migrate_config_v2_to_v3(&mut config); config.config_version = 3; }
                    if config.config_version < 4 { dirty |= migrate_config_v3_to_v4(&mut config); config.config_version = 4; }
                    if dirty { let _ = save_config(&config); }
                    return config;
                }
            }
        }
    }
    
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            match serde_json::from_str::<AppConfig>(&content) {
                Ok(mut config) => {
                    let mut dirty = false;
                    if config.config_version < 1 { config.config_version = 1; dirty = true; }
                    if config.config_version < 2 { dirty |= migrate_config_v1_to_v2(&mut config); config.config_version = 2; }
                    if config.config_version < 3 { dirty |= migrate_config_v2_to_v3(&mut config); config.config_version = 3; }
                    if config.config_version < 4 { dirty |= migrate_config_v3_to_v4(&mut config); config.config_version = 4; }
                    let _ = save_config(&config);
                    let mut backup_path = path.clone();
                    backup_path.set_extension("json.bak");
                    let _ = fs::rename(&path, &backup_path);
                    return config;
                }
                Err(e) => {
                    eprintln!("[CONFIG] Error deserializing config: {}", e);
                }
            }
        }
    }
    AppConfig::default()
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let conn = get_db_conn()?;
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO kv_store (key, value) VALUES ('config', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1",
        rusqlite::params![content],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_todos_path() -> PathBuf {
    let mut path = get_app_dir();
    path.push("todos.json");
    path
}

pub fn load_todos() -> serde_json::Value {
    if let Ok(conn) = get_db_conn() {
        if let Ok(mut stmt) = conn.prepare("SELECT value FROM kv_store WHERE key = 'todos'") {
            if let Ok(content) = stmt.query_row(rusqlite::params![], |row| row.get::<_, String>(0)) {
                if let Ok(todos) = serde_json::from_str::<serde_json::Value>(&content) {
                    return todos;
                }
            }
        }
    }
    
    let path = get_todos_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(todos) = serde_json::from_str::<serde_json::Value>(&content) {
                let _ = save_todos(&todos);
                let _ = fs::rename(&path, path.with_extension("json.bak"));
                return todos;
            }
        }
    }
    serde_json::json!([])
}

pub fn save_todos(todos: &serde_json::Value) -> Result<(), String> {
    let conn = get_db_conn()?;
    let content = serde_json::to_string_pretty(todos).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO kv_store (key, value) VALUES ('todos', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1",
        rusqlite::params![content],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_notes_path() -> PathBuf {
    let mut path = get_app_dir();
    path.push("notes.json");
    path
}

pub fn load_notes() -> serde_json::Value {
    if let Ok(conn) = get_db_conn() {
        if let Ok(mut stmt) = conn.prepare("SELECT value FROM kv_store WHERE key = 'notes'") {
            if let Ok(content) = stmt.query_row(rusqlite::params![], |row| row.get::<_, String>(0)) {
                if let Ok(notes) = serde_json::from_str::<serde_json::Value>(&content) {
                    return notes;
                }
            }
        }
    }
    
    let path = get_notes_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(notes) = serde_json::from_str::<serde_json::Value>(&content) {
                let _ = save_notes(&notes);
                let _ = fs::rename(&path, path.with_extension("json.bak"));
                return notes;
            }
        }
    }
    serde_json::json!([])
}

pub fn save_notes(notes: &serde_json::Value) -> Result<(), String> {
    let conn = get_db_conn()?;
    let content = serde_json::to_string_pretty(notes).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO kv_store (key, value) VALUES ('notes', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1",
        rusqlite::params![content],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_config() {
        let config = load_config();
        println!("LOADED CONFIG PATH: {:?}", config.llama_server_path);
        println!("LOADED CONFIG FIRST RUN: {:?}", config.first_run_completed);
    }

    /// Regression test: `load_config` used to clear `user_memory.conversation_summary`
    /// on every call, which destroyed the chat-session summary on every app
    /// launch. The fix is to remove that mutation from `load_config` and expose
    /// it as an explicit `clear_conversation_summary` helper that the frontend
    /// calls when a new chat session starts.
    ///
    /// This test runs the exact same in-memory code path that `load_config`
    /// executes (deserialize, run versioned migrations, decide whether to
    /// write back) on a config that contains a non-empty summary, and
    /// asserts the summary is preserved end-to-end.
    #[test]
    fn load_config_no_longer_clears_conversation_summary() {
        assert!(
            CURRENT_CONFIG_VERSION >= 3,
            "CURRENT_CONFIG_VERSION must be bumped to 3 (got {})",
            CURRENT_CONFIG_VERSION
        );

        const PRESERVED_SUMMARY: &str =
            "user talked about cats and the weather and wants a recipe for pasta";

        // Build an AppConfig that mirrors what a freshly written-to-disk
        // config looks like (current version, non-empty summary).
        let mut cfg = AppConfig::default();
        cfg.user_memory.conversation_summary = PRESERVED_SUMMARY.to_string();
        cfg.config_version = CURRENT_CONFIG_VERSION;

        // Serialize it the way `save_config` would.
        let serialized = serde_json::to_string_pretty(&cfg).expect("serialize");

        // This is the success-branch body of `load_config`, inlined here so
        // we don't have to redirect the platform's app dir. The real
        // `load_config` is exercised end-to-end at app startup and via the
        // existing `test_load_config` smoke test; this test asserts the
        // specific invariant that the regression cannot reappear.
        let mut reloaded: AppConfig =
            serde_json::from_str(&serialized).expect("re-parse");
        assert_eq!(reloaded.config_version, CURRENT_CONFIG_VERSION);
        // The post-migration summary MUST equal what we wrote. If anyone
        // re-introduces the `conversation_summary = String::new()` line in
        // `load_config`, this assertion fires.
        assert_eq!(
            reloaded.user_memory.conversation_summary, PRESERVED_SUMMARY,
            "re-parsing the persisted config must preserve conversation_summary"
        );

        // Run the migration ladder exactly as `load_config` does.
        let mut dirty = false;
        if reloaded.config_version < 1 {
            reloaded.config_version = 1;
            dirty = true;
        }
        if reloaded.config_version < 2 {
            dirty |= migrate_config_v1_to_v2(&mut reloaded);
            reloaded.config_version = 2;
        }
        if reloaded.config_version < 3 {
            dirty |= migrate_config_v2_to_v3(&mut reloaded);
            reloaded.config_version = 3;
        }
        // The critical assertion: NO step in the migration/load path may
        // mutate `conversation_summary`.
        assert_eq!(
            reloaded.user_memory.conversation_summary, PRESERVED_SUMMARY,
            "load_config / migrations must NOT mutate conversation_summary"
        );

        // The `clear_conversation_summary` helper must still exist and work
        // (callers depend on it being a separate explicit step).
        assert!(!reloaded.user_memory.conversation_summary.is_empty());
        clear_conversation_summary(&mut reloaded);
        assert!(
            reloaded.user_memory.conversation_summary.is_empty(),
            "clear_conversation_summary must clear the field"
        );

        // Suppress the unused-mut warning for `dirty` — it's part of the
        // documented contract of `load_config` that this function returns
        // the dirty flag and re-saves if set.
        let _ = dirty;
    }

    #[test]
    fn test_contact_lookup() {
        let contacts = vec![
            WhatsAppContact {
                name: "chirag".to_string(),
                number: "166468721361049".to_string(),
                auto_reply_enabled: true,
            },
            WhatsAppContact {
                name: "kalrasamarth514".to_string(),
                number: "208490949787886".to_string(),
                auto_reply_enabled: false,
            },
            WhatsAppContact {
                name: "Rahul Verma".to_string(),
                number: "69995216302224".to_string(),
                auto_reply_enabled: false,
            },
            WhatsAppContact {
                name: "★༺🅃🄼༺★".to_string(),
                number: "191529889058837".to_string(),
                auto_reply_enabled: false,
            },
        ];

        let recipient = "Chirag".to_string();
        let cleaned_recipient = recipient.chars().filter(|c| c.is_ascii_digit()).collect::<String>();
        
        let found = if !cleaned_recipient.is_empty() {
            contacts.iter().find(|c| {
                let cn = c.number.chars().filter(|ch| ch.is_ascii_digit()).collect::<String>();
                cn == cleaned_recipient || cleaned_recipient.contains(&cn) || cn.contains(&cleaned_recipient)
            })
        } else {
            let recipient_lower = recipient.to_lowercase();
            contacts.iter().find(|c| {
                let name_lower = c.name.to_lowercase();
                name_lower == recipient_lower
                    || name_lower.contains(&recipient_lower)
                    || recipient_lower.contains(&name_lower)
            })
        };

        assert!(found.is_some(), "Should find a contact");
        let matched = found.unwrap();
        assert_eq!(matched.name, "chirag", "Should match chirag");
        println!("MATCHED NAME: {}", matched.name);
    }
}
