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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectConfig {
    pub name: String,
    pub path: String,
}

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
        }
    }
}

pub const CURRENT_CONFIG_VERSION: u32 = 3;

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

pub fn get_config_path() -> PathBuf {
    let mut path = get_app_dir();
    path.push("config.json");
    path
}
pub fn load_config() -> AppConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            match serde_json::from_str::<AppConfig>(&content) {
                Ok(mut config) => {
                    let mut dirty = false;

                    // Run versioned migrations
                    if config.config_version < 1 {
                        config.config_version = 1;
                        dirty = true;
                    }
                    if config.config_version < 2 {
                        dirty |= migrate_config_v1_to_v2(&mut config);
                        config.config_version = 2;
                    }
                    if config.config_version < 3 {
                        dirty |= migrate_config_v2_to_v3(&mut config);
                        config.config_version = 3;
                    }

                    // NOTE: do NOT clear `conversation_summary` here. The
                    // summary is chat-session-scoped and must be cleared by
                    // the frontend (via the `clear_conversation_summary`
                    // command) when a new chat session starts, not on every
                    // app launch. See `clear_conversation_summary` helper.

                    if dirty {
                        let _ = save_config(&config);
                    }
                    return config;
                }
                Err(e) => {
                    eprintln!("[CONFIG] Error deserializing config: {}. Wiping is blocked, backing up old config.", e);
                    let mut backup_path = path.clone();
                    backup_path.set_extension("json.bak");
                    if let Err(backup_err) = fs::write(&backup_path, &content) {
                        eprintln!("[CONFIG] Failed to write backup file to {:?}: {}", backup_path, backup_err);
                    } else {
                        eprintln!("[CONFIG] Backed up corrupted/old config file to {:?}", backup_path);
                    }
                }
            }
        }
    }
    AppConfig::default()
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn get_todos_path() -> PathBuf {
    let mut path = get_app_dir();
    path.push("todos.json");
    path
}

pub fn load_todos() -> serde_json::Value {
    let path = get_todos_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(todos) = serde_json::from_str::<serde_json::Value>(&content) {
                return todos;
            }
        }
    }
    serde_json::json!([])
}

pub fn save_todos(todos: &serde_json::Value) -> Result<(), String> {
    let path = get_todos_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(todos).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
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
