use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UserMemory {
    pub name: Option<String>,
    pub persona: Vec<String>,
    pub conversation_summary: String,
}

pub fn update_memory(config: &mut crate::storage::AppConfig, new_info: UserMemory) {
    config.user_memory.name = new_info.name;
    // Replace persona entirely (frontend sends the complete current state, not incremental additions).
    // Previously used extend() which caused exponential growth (each save doubled the entries).
    config.user_memory.persona = new_info.persona;
    // Deduplicate to prevent any future accumulation
    config.user_memory.persona.sort();
    config.user_memory.persona.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    // Cap at a reasonable limit
    if config.user_memory.persona.len() > 50 {
        config.user_memory.persona.truncate(50);
    }
    config.user_memory.conversation_summary = new_info.conversation_summary;
}
