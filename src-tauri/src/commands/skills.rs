use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn list_skills(state: State<'_, AppState>) -> Result<Vec<crate::skills::Skill>, String> {
    let _config = state.config.lock().await;
    let store = crate::skills::SkillStore::load();
    let mut skills: Vec<crate::skills::Skill> = store.skills.into_values().collect();
    skills.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
    drop(_config);
    Ok(skills)
}

#[tauri::command]
pub async fn get_skill(name: String) -> Result<crate::skills::Skill, String> {
    let store = crate::skills::SkillStore::load();
    store
        .skills
        .get(&name)
        .cloned()
        .ok_or_else(|| format!("Skill '{}' not found", name))
}

#[tauri::command]
pub async fn create_skill(
    name: String,
    description: String,
    trigger_patterns: Vec<String>,
    related_tools: Vec<String>,
    tags: Vec<String>,
    content: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    let skill = crate::skills::Skill {
        name: crate::skills::sanitize_skill_name(&name),
        description,
        version: "1.0.0".to_string(),
        author: "Pern User".to_string(),
        trigger_patterns,
        related_tools,
        tags,
        content,
        usage_count: 0,
        auto_generated: false,
    };
    let mut store = crate::skills::SkillStore::load();
    store.upsert(skill)
}

#[tauri::command]
pub async fn delete_skill(name: String) -> Result<(), String> {
    let mut store = crate::skills::SkillStore::load();
    store.remove(&name)
}

#[tauri::command]
pub async fn record_tool_usage(
    tool: String,
    args_summary: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    let mut skills_store = crate::skills::SkillStore::load();
    let mut learner = crate::learner::LearnerData::load();
    learner.record_tool_call(&tool, &args_summary, &mut skills_store)?;
    config.tool_usage_stats = learner.stats.clone();

    // Persist skills changes (auto-generated skills from pattern detection)
    // Also persist learner data
    crate::storage::save_config(&config)?;
    drop(config);

    Ok(())
}

#[tauri::command]
pub async fn get_learning_insights(
    _state: State<'_, AppState>,
) -> Result<Vec<crate::learner::LearnedInsight>, String> {
    let learner = crate::learner::LearnerData::load();
    Ok(learner.get_recent_insights(20))
}

#[tauri::command]
pub async fn get_tool_usage_summary(_state: State<'_, AppState>) -> Result<String, String> {
    let learner = crate::learner::LearnerData::load();
    Ok(learner.get_usage_summary())
}

#[tauri::command]
pub async fn set_user_preference(
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.user_preferences.insert(key, value);
    crate::storage::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn get_user_preferences(
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let config = state.config.lock().await;
    Ok(config.user_preferences.clone())
}

#[tauri::command]
pub async fn find_relevant_skills(input: String) -> Result<Vec<crate::skills::Skill>, String> {
    let store = crate::skills::SkillStore::load();
    let relevant: Vec<crate::skills::Skill> =
        store.find_relevant(&input).into_iter().cloned().collect();
    Ok(relevant)
}

#[tauri::command]
pub async fn record_skill_usage(name: String) -> Result<(), String> {
    let mut store = crate::skills::SkillStore::load();
    store.record_usage(&name)
}

#[tauri::command]
pub async fn delete_learning_insight(index: usize) -> Result<(), String> {
    let mut learner = crate::learner::LearnerData::load();
    if index >= learner.insights.len() {
        return Err(format!(
            "Insight index {} out of bounds (max {})",
            index,
            learner.insights.len().saturating_sub(1)
        ));
    }
    learner.insights.remove(index);
    learner.save()?;
    Ok(())
}

#[tauri::command]
pub async fn clear_learning_insights() -> Result<(), String> {
    let mut learner = crate::learner::LearnerData::load();
    learner.insights.clear();
    learner.save()?;
    Ok(())
}

#[tauri::command]
pub async fn update_learning_insight(
    index: usize,
    insight: String,
    category: String,
    confidence: f64,
    related_tools: Vec<String>,
) -> Result<(), String> {
    let mut learner = crate::learner::LearnerData::load();
    if index >= learner.insights.len() {
        return Err(format!(
            "Insight index {} out of bounds (max {})",
            index,
            learner.insights.len().saturating_sub(1)
        ));
    }
    learner.insights[index] = crate::learner::LearnedInsight {
        category,
        insight,
        confidence,
        related_tools,
    };
    learner.save()?;
    Ok(())
}
