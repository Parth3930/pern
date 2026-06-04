use crate::integrations::cli_agents::CLIAgentManager;
use crate::storage::AppConfig;
use crate::integrations::whatsapp::WhatsAppManager;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::process::Child;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Mutex<AppConfig>>,
    pub whatsapp_manager: Arc<WhatsAppManager>,
    pub discord_manager: Arc<crate::integrations::discord::DiscordManager>,
    pub cli_agent_manager: Arc<CLIAgentManager>,
    pub llama_server: Arc<Mutex<Option<Child>>>,
    pub current_model_id: Arc<Mutex<Option<String>>>,
    pub start_time: std::time::Instant,
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
        let cli_mgr = CLIAgentManager::new();
        // Apply persisted configs
        let cli_configs = config.cli_agent_configs.clone();
        tauri::async_runtime::block_on(async {
            cli_mgr.apply_configs(cli_configs).await;
        });
        Self {
            config: Arc::new(Mutex::new(config)),
            whatsapp_manager: Arc::new(WhatsAppManager::new()),
            discord_manager: Arc::new(crate::integrations::discord::DiscordManager::new()),
            cli_agent_manager: Arc::new(cli_mgr),
            llama_server: Arc::new(Mutex::new(None)),
            current_model_id: Arc::new(Mutex::new(None)),
            start_time: std::time::Instant::now(),
        }
    }
}
