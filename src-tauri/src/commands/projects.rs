use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_cli_agents_status(
    state: State<'_, AppState>,
) -> Result<Vec<crate::integrations::cli_agents::AgentStateInfo>, String> {
    let _ = state.config.lock().await;
    Ok(state.cli_agent_manager.get_all_states().await)
}

#[tauri::command]
pub async fn configure_cli_agent(
    name: String,
    enabled: bool,
    binary_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cfg = crate::integrations::cli_agents::CLIAgentConfig {
        name: name.clone(),
        enabled,
        binary_path: binary_path.clone(),
        display_name: name.clone(),
    };
    state.cli_agent_manager.apply_configs(vec![cfg]).await;
    // Persist to config
    let mut config = state.config.lock().await;
    let configs = state.cli_agent_manager.get_all_states().await;
    config.cli_agent_configs = configs
        .into_iter()
        .map(|s| crate::integrations::cli_agents::CLIAgentConfig {
            name: s.name,
            enabled: s.enabled,
            binary_path: s.binary_path,
            display_name: s.display_name,
        })
        .collect();
    crate::storage::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn send_to_cli_agent(
    agent_name: String,
    prompt: String,
    project_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized_agent_name = match agent_name.to_lowercase().trim() {
        "agy" | "antigravity" | "agye" => "agy".to_string(),
        "claude" | "claude-code" | "claude_code" | "claudecode" => "claude-code".to_string(),
        "codex" => "codex".to_string(),
        "hermes" => "hermes".to_string(),
        "freebuff" | "freebuf" => "freebuff".to_string(),
        other => other.to_string(),
    };

    // Resolve project directory if project_name is provided
    let project_dir = if let Some(ref pname) = project_name {
        let config = state.config.lock().await;
        let requested_name = pname.trim();
        let project = config
            .projects
            .iter()
            .find(|p| p.name == requested_name)
            .or_else(|| {
                config
                    .projects
                    .iter()
                    .find(|p| p.name.eq_ignore_ascii_case(requested_name))
            })
            .ok_or_else(|| format!("Project '{}' not found. Add it in settings first.", pname))?;
        let path = std::path::PathBuf::from(&project.path);
        if !path.exists() {
            return Err(format!(
                "Project directory '{}' does not exist.",
                project.path
            ));
        }
        drop(config);
        Some(path)
    } else {
        None
    };

    let result = state
        .cli_agent_manager
        .send_prompt(
            &normalized_agent_name,
            &prompt,
            project_dir.as_deref(),
            Some(crate::integrations::cli_agents::TaskOrigin::Local),
        )
        .await?;
    Ok(result)
}

#[tauri::command]
pub async fn add_project(
    name: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    // Check for duplicate names
    if config.projects.iter().any(|p| p.name == name) {
        return Err(format!("Project '{}' already exists.", name));
    }
    config.projects.push(crate::storage::ProjectConfig {
        name: name.clone(),
        path: path.clone(),
    });
    crate::storage::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn remove_project(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock().await;
    let len_before = config.projects.len();
    config.projects.retain(|p| p.name != name);
    if config.projects.len() == len_before {
        return Err(format!("Project '{}' not found.", name));
    }
    crate::storage::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn list_projects(
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::ProjectConfig>, String> {
    let config = state.config.lock().await;
    Ok(config.projects.clone())
}

#[tauri::command]
pub async fn read_file(
    path: String,
    project_name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let config = state.config.lock().await;
    let project = config.projects.iter().find(|p| p.name == project_name)
        .ok_or_else(|| "Project not found".to_string())?;
    
    let base = std::path::PathBuf::from(&project.path);
    let path_str = if path == project_name || path.is_empty() { "." } else { &path };
    let target = base.join(path_str);
    
    if !target.exists() {
        return Err(format!("File not found: {}", path));
    }
    
    // basic security: make sure target is within base
    if !target.canonicalize().unwrap_or_default().starts_with(base.canonicalize().unwrap_or_default()) {
        return Err("Path is outside project directory".to_string());
    }
    
    std::fs::read_to_string(&target).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_dir(
    path: String,
    project_name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let config = state.config.lock().await;
    let project = config.projects.iter().find(|p| p.name == project_name)
        .ok_or_else(|| "Project not found".to_string())?;
    
    let base = std::path::PathBuf::from(&project.path);
    let path_str = if path == project_name || path.is_empty() { "." } else { &path };
    let target = base.join(path_str);
    
    if !target.exists() {
        return Err(format!("Directory not found: {}", path));
    }
    
    if !target.canonicalize().unwrap_or_default().starts_with(base.canonicalize().unwrap_or_default()) {
        return Err("Path is outside project directory".to_string());
    }
    
    let mut entries = Vec::new();
    if let Ok(dir) = std::fs::read_dir(&target) {
        for entry in dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.push(format!("{}{}", name, if is_dir { "/" } else { "" }));
        }
    }
    let result = entries.join("\n");
    Ok(result)
}
