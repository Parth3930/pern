use crate::skills::{sanitize_skill_name, Skill, SkillStore};
use chrono::{Local, Timelike};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Tracks tool usage for behavior learning
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ToolUsageStats {
    /// Tool name -> usage count
    pub tool_counts: HashMap<String, u64>,
    /// Tool name -> list of snippets of recent args used (for learning patterns)
    pub tool_arg_snippets: HashMap<String, Vec<String>>,
    /// Timestamps of recent tool calls (for time-of-day patterns)
    pub recent_tool_calls: Vec<ToolCallRecord>,
    /// Count of tool call sequences detected (e.g., "launch_app" followed by "send_whatsapp_message")
    pub sequence_counts: HashMap<String, u64>,
}

/// A record of a single tool call
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolCallRecord {
    pub tool: String,
    pub args_summary: String,
    pub hour: u32, // 0-23 hour of day
}

/// An insight that PERN has learned about the user
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LearnedInsight {
    pub category: String, // "preference", "pattern", "suggestion"
    pub insight: String,
    pub confidence: f64, // 0.0 - 1.0
    pub related_tools: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LearnerData {
    pub stats: ToolUsageStats,
    pub insights: Vec<LearnedInsight>,
}

impl LearnerData {
    /// Get the path where learner data is stored
    pub fn get_path() -> std::path::PathBuf {
        let mut path = crate::storage::get_app_dir();
        path.push("learner_data.json");
        path
    }

    /// Load learner data from disk
    pub fn load() -> Self {
        let path = Self::get_path();
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(data) = serde_json::from_str::<LearnerData>(&content) {
                    return data;
                }
            }
        }
        Self::default()
    }

    /// Save learner data to disk
    pub fn save(&self) -> Result<(), String> {
        let path = Self::get_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Record a tool call and run pattern analysis
    pub fn record_tool_call(
        &mut self,
        tool: &str,
        args_summary: &str,
        skills_store: &mut SkillStore,
    ) -> Result<(), String> {
        let now = Local::now();

        // 1. Increment tool count
        *self.stats.tool_counts.entry(tool.to_string()).or_insert(0) += 1;

        // 2. Store arg snippet (keep last 5 per tool)
        let snippets = self
            .stats
            .tool_arg_snippets
            .entry(tool.to_string())
            .or_default();
        snippets.push(args_summary.to_string());
        if snippets.len() > 5 {
            snippets.remove(0);
        }

        // 3. Record the call
        self.stats.recent_tool_calls.push(ToolCallRecord {
            tool: tool.to_string(),
            args_summary: args_summary.to_string(),
            hour: now.hour(),
        });
        // Keep only last 50 calls in memory
        if self.stats.recent_tool_calls.len() > 50 {
            self.stats.recent_tool_calls.drain(..self.stats.recent_tool_calls.len() - 50);
        }

        // 4. Detect sequences (tool A followed by tool B)
        if self.stats.recent_tool_calls.len() >= 2 {
            let calls = &self.stats.recent_tool_calls;
            let prev = &calls[calls.len() - 2];
            if prev.tool != tool {
                let seq_key = format!("{} -> {}", prev.tool, tool);
                *self.stats.sequence_counts.entry(seq_key).or_insert(0) += 1;
            }
        }

        // 5. Run full pattern analysis — multiple detector passes
        self.detect_sequence_skills(skills_store)?;
        self.detect_tool_preferences(skills_store)?;
        self.detect_time_routines()?;
        self.check_skill_quality(skills_store)?;
        self.detect_arg_patterns()?;

        // Keep insights manageable (max 30)
        if self.insights.len() > 30 {
            self.insights.drain(..self.insights.len() - 30);
        }

        self.save()?;
        Ok(())
    }

    // ── DETECTOR 1: Tool sequences → auto-generated workflow skills ──

    fn detect_sequence_skills(&mut self, skills_store: &mut SkillStore) -> Result<(), String> {
        let mut strong_sequences: Vec<(String, u64)> = self
            .stats
            .sequence_counts
            .iter()
            .filter(|(_, &count)| count >= 3)
            .map(|(seq, count)| (seq.clone(), *count))
            .collect();
        strong_sequences.sort_by(|a, b| b.1.cmp(&a.1));

        let mut valid_sequence_skills = HashSet::new();

        for (sequence, _count) in &strong_sequences {
            let parts: Vec<&str> = sequence.split(" -> ").collect();
            if parts.len() == 2 {
                let tool_a = parts[0];
                let tool_b = parts[1];

                // Sort tool names to ensure A -> B and B -> A produce the same skill name
                let mut sorted_parts = vec![tool_a.to_string(), tool_b.to_string()];
                sorted_parts.sort();
                let skill_name = sanitize_skill_name(&format!("auto-{}-and-{}", sorted_parts[0], sorted_parts[1]));
                valid_sequence_skills.insert(skill_name.clone());

                if skills_store.skills.contains_key(&skill_name) {
                    continue; // Already have this skill
                }

                let friendly_a = tool_a.replace('_', " ");
                let friendly_b = tool_b.replace('_', " ");

                // FIX #1: Generate NATURAL LANGUAGE trigger patterns instead of raw tool names
                let natural_triggers = generate_sequence_triggers(tool_a, tool_b);

                let description = format!(
                    "Use when you want to {} and then {} together — the user does this often.",
                    friendly_a, friendly_b
                );

                let content = format!(
                    "# Auto-Detected Workflow: {} and {}\n\n\
                    ## Overview\n\
                    The user frequently does `{}` and `{}` together.\n\n\
                    ## Steps\n\
                    1. Execute `{}`\n\
                    2. Then execute `{}`\n\n\
                    ## Example\n\
                    User: \"[does the usual combo]\"\n\
                    OUTPUT: [{{\"tool\":\"{}\",\"args\":{{...}}}},{{\"tool\":\"{}\",\"args\":{{...}}}}]\n\
                    ",
                    friendly_a, friendly_b,
                    friendly_a, friendly_b,
                    tool_a, tool_b,
                    tool_a, tool_b
                );

                let skill = Skill {
                    name: skill_name.clone(),
                    description,
                    version: "1.0.0".to_string(),
                    author: "Pern (auto-generated)".to_string(),
                    trigger_patterns: natural_triggers,
                    related_tools: vec![tool_a.to_string(), tool_b.to_string()],
                    tags: vec!["auto-generated".to_string(), "workflow".to_string()],
                    content,
                    usage_count: 0,
                    auto_generated: true,
                };

                skills_store.upsert(skill)?;

                self.insights.push(LearnedInsight {
                    category: "suggestion".to_string(),
                    insight: format!(
                        "I noticed you often use {} and {} together. I created a '{}' skill for this workflow.",
                        friendly_a, friendly_b, skill_name
                    ),
                    confidence: 0.7,
                    related_tools: vec![tool_a.to_string(), tool_b.to_string()],
                });
            }
        }

        // Cleanup old/unsorted auto-generated sequence skills that are not in valid_sequence_skills
        let to_remove: Vec<String> = skills_store.skills.values()
            .filter(|s| s.auto_generated && s.name.starts_with("auto-") && !valid_sequence_skills.contains(&s.name))
            .map(|s| s.name.clone())
            .collect();

        for name in to_remove {
            let _ = skills_store.remove(&name);
        }

        Ok(())
    }

    // ── DETECTOR 2: Single-tool heavy usage → preference skills ──

    fn detect_tool_preferences(&mut self, skills_store: &mut SkillStore) -> Result<(), String> {
        let favorite_tools: Vec<(String, u64)> = self.stats.tool_counts.iter()
            .filter(|(_, &count)| count >= 10)
            .map(|(t, c)| (t.clone(), *c))
            .collect();

        // Get tools that are already part of a strong sequence combo
        let strong_sequence_tools: HashSet<String> = self.stats.sequence_counts.iter()
            .filter(|(_, &count)| count >= 3)
            .flat_map(|(seq, _)| seq.split(" -> ").map(|s| s.to_string()).collect::<Vec<_>>())
            .collect();

        let mut valid_frequent_skills = HashSet::new();

        for (tool, count) in &favorite_tools {
            // Skip creating or retaining individual frequent skills for tools in strong sequences
            if strong_sequence_tools.contains(tool) {
                continue;
            }

            let skill_name = sanitize_skill_name(&format!("frequent-{}", tool));
            valid_frequent_skills.insert(skill_name.clone());

            // Add insight if not already present
            let already_has = self.insights.iter().any(|i| {
                i.category == "preference" && i.insight.contains(tool)
            });
            if !already_has {
                self.insights.push(LearnedInsight {
                    category: "preference".to_string(),
                    insight: format!(
                        "Your most used tool is '{}' (used {} times). You know this workflow well.",
                        tool.replace('_', " "), count
                    ),
                    confidence: 0.8,
                    related_tools: vec![tool.clone()],
                });
            }

            // Create skill for heavily-used single tool (15+ uses, no skill exists yet)
            if *count >= 15 && !skills_store.skills.contains_key(&skill_name) {
                // Check if args are consistent
                let consistent_args = self.stats.tool_arg_snippets.get(tool)
                    .map(|snips| snips.len() >= 4 && snips.iter().all(|s| {
                        s.chars().take(50).collect::<String>() == snips[0].chars().take(50).collect::<String>()
                    }))
                    .unwrap_or(false);

                let natural_triggers = generate_tool_triggers(tool);

                let content = if consistent_args {
                    let example = self.stats.tool_arg_snippets.get(tool)
                        .and_then(|snips| snips.first())
                        .cloned()
                        .unwrap_or_default();
                    format!(
                        "# Frequently Used Tool: {}\n\n\
                        ## Overview\n\
                        The user uses '{}' frequently ({} times) — always with similar arguments.\n\n\
                        ## Typical Usage\n\
                        ```\n\
                        Tool: `{}`\n\
                        Args: {}\n\
                        ```\n\
                        ## Steps\n\
                        1. Call `{}` with the above arguments\n",
                        tool.replace('_', " "),
                        tool.replace('_', " "), count,
                        tool, example,
                        tool
                    )
                } else {
                    format!(
                        "# Frequently Used Tool: {}\n\n\
                        ## Overview\n\
                        The user uses '{}' frequently ({} times). This is a go-to tool.\n\n\
                        ## Usage\n\
                        Tool: `{}`\n\
                        Args vary per use.\n",
                        tool.replace('_', " "),
                        tool.replace('_', " "), count,
                        tool
                    )
                };

                let skill = Skill {
                    name: skill_name.clone(),
                    description: format!(
                        "The user frequently uses '{}' ({} times) — a key tool for them.",
                        tool.replace('_', " "), count
                    ),
                    version: "1.0.0".to_string(),
                    author: "Pern (auto-generated)".to_string(),
                    trigger_patterns: natural_triggers,
                    related_tools: vec![tool.clone()],
                    tags: vec!["auto-generated".to_string(), "preference".to_string()],
                    content,
                    usage_count: 0,
                    auto_generated: true,
                };
                skills_store.upsert(skill)?;

                self.insights.push(LearnedInsight {
                    category: "suggestion".to_string(),
                    insight: format!(
                        "You use '{}' a lot ({} times). I created a '{}' preference skill to remember this.",
                        tool.replace('_', " "), count, skill_name
                    ),
                    confidence: 0.7,
                    related_tools: vec![tool.clone()],
                });
            }
        }

        // Cleanup old frequent skills that are no longer valid (e.g. because they are now part of a sequence)
        let to_remove: Vec<String> = skills_store.skills.values()
            .filter(|s| s.auto_generated && s.name.starts_with("frequent-") && !valid_frequent_skills.contains(&s.name))
            .map(|s| s.name.clone())
            .collect();

        for name in to_remove {
            let _ = skills_store.remove(&name);
        }

        Ok(())
    }

    // ── DETECTOR 3: Time-of-day tool routines ──

    fn detect_time_routines(&mut self) -> Result<(), String> {
        let mut hour_tool_counts: HashMap<(u32, String), u64> = HashMap::new();
        for call in &self.stats.recent_tool_calls {
            *hour_tool_counts.entry((call.hour, call.tool.clone())).or_insert(0) += 1;
        }

        for ((hour, tool), count) in &hour_tool_counts {
            if *count >= 5 {
                let time_label = if *hour < 12 { "morning" } else if *hour < 17 { "afternoon" } else { "evening" };
                let routine_key = format!("routine-{}-{}", hour, tool);
                let already_has = self.insights.iter().any(|i| {
                    i.insight.contains(&routine_key)
                });
                if !already_has {
                    self.insights.push(LearnedInsight {
                        category: "pattern".to_string(),
                        insight: format!(
                            "routine-{}-{}: You use '{}' most often in the {} (around {:02}:00, {} times).",
                            hour, tool, tool.replace('_', " "), time_label, hour, count
                        ),
                        confidence: 0.6,
                        related_tools: vec![tool.clone()],
                    });
                }
            }
        }

        // Also add general peak-hour insight if not already present
        let hour_counts: HashMap<u32, u64> = self
            .stats
            .recent_tool_calls
            .iter()
            .fold(HashMap::new(), |mut acc, call| {
                *acc.entry(call.hour).or_insert(0) += 1;
                acc
            });

        let peak_hour = hour_counts
            .iter()
            .max_by_key(|(_, &count)| count)
            .map(|(hour, _)| *hour);

        if let Some(hour) = peak_hour {
            let time_label = if hour < 12 { "morning" } else if hour < 17 { "afternoon" } else { "evening" };
            let already_has = self.insights.iter().any(|i| {
                i.category == "pattern" && i.insight.contains(&format!("most active in the {}", time_label))
            });
            if !already_has && hour_counts.get(&hour).copied().unwrap_or(0) >= 5 {
                self.insights.push(LearnedInsight {
                    category: "pattern".to_string(),
                    insight: format!("You're most active in the {} (around {:02}:00).", time_label, hour),
                    confidence: 0.6,
                    related_tools: vec![],
                });
            }
        }
        Ok(())
    }

    // ── DETECTOR 4: Consistent argument patterns ──

    fn detect_arg_patterns(&mut self) -> Result<(), String> {
        for (tool, snippets) in &self.stats.tool_arg_snippets {
            if snippets.len() >= 4 {
                let first_head: String = snippets[0].chars().take(50).collect();
                let all_same = snippets.iter().all(|s| {
                    s.chars().take(50).collect::<String>() == first_head
                });
                if all_same {
                    let arg_key = format!("consistent-args:{}", tool);
                    let already_has = self.insights.iter().any(|i| i.insight.contains(&arg_key));
                    if !already_has {
                        self.insights.push(LearnedInsight {
                            category: "pattern".to_string(),
                            insight: format!(
                                "{}: You always call '{}' with very similar arguments. Consider creating a shortcut or template.",
                                arg_key, tool.replace('_', " ")
                            ),
                            confidence: 0.5,
                            related_tools: vec![tool.clone()],
                        });
                    }
                }
            }
        }
        Ok(())
    }

    // ── DETECTOR 5: Skill quality feedback loop ──

    fn check_skill_quality(&mut self, skills_store: &mut SkillStore) -> Result<(), String> {
        for skill in skills_store.skills.values() {
            if skill.auto_generated && skill.usage_count == 0 {
                let quality_key = format!("low-quality-skill:{}", skill.name);
                let already_flagged = self.insights.iter().any(|i| i.insight.contains(&quality_key));
                if !already_flagged {
                    self.insights.push(LearnedInsight {
                        category: "suggestion".to_string(),
                        insight: format!(
                            "{}: The auto-generated skill '{}' has never been used. It may need better trigger patterns or should be removed.",
                            quality_key, skill.name
                        ),
                        confidence: 0.4,
                        related_tools: skill.related_tools.clone(),
                    });
                }
            }
        }
        Ok(())
    }

    /// Get recent insights for display
    pub fn get_recent_insights(&self, limit: usize) -> Vec<LearnedInsight> {
        let mut insights = self.insights.clone();
        insights.reverse();
        insights.truncate(limit);
        insights
    }

    /// Get a summary of tool usage
    pub fn get_usage_summary(&self) -> String {
        let mut lines = Vec::new();

        let mut tools: Vec<(String, u64)> = self
            .stats
            .tool_counts
            .iter()
            .map(|(t, c)| (t.clone(), *c))
            .collect();
        tools.sort_by(|a, b| b.1.cmp(&a.1));

        if tools.is_empty() {
            return "No tool usage recorded yet.".to_string();
        }

        lines.push("### Tool Usage".to_string());
        for (tool, count) in &tools {
            let friendly = tool.replace('_', " ");
            lines.push(format!("- {}: {} times", friendly, count));
        }

        let mut sequences: Vec<(String, u64)> = self
            .stats
            .sequence_counts
            .iter()
            .filter(|(_, &c)| c >= 2)
            .map(|(s, c)| (s.clone(), *c))
            .collect();
        sequences.sort_by(|a, b| b.1.cmp(&a.1));

        if !sequences.is_empty() {
            lines.push("\n### Common Sequences".to_string());
            for (seq, count) in &sequences {
                let friendly = seq.replace(" -> ", " then ");
                lines.push(format!("- {} ({} times)", friendly, count));
            }
        }

        lines.join("\n")
    }
}

// ── NATURAL LANGUAGE TRIGGER GENERATORS ──

/// Generate natural language trigger patterns for a tool sequence (A → B).
/// E.g., "send_whatsapp_message → toggle_whatsapp" generates triggers like:
/// "send whatsapp and toggle whatsapp", etc.
fn generate_sequence_triggers(tool_a: &str, tool_b: &str) -> Vec<String> {
    let mut triggers = Vec::new();

    // Friendly names
    let friendly_a = tool_a.replace('_', " ");
    let friendly_b = tool_b.replace('_', " ");

    // Both friendly names together
    triggers.push(format!("{} and {}", friendly_a, friendly_b));
    triggers.push(format!("{} then {}", friendly_a, friendly_b));
    triggers.push(format!("{} {}", friendly_a, friendly_b));

    // Individual keywords
    let keywords_a = extract_keywords(tool_a);
    let keywords_b = extract_keywords(tool_b);

    // Cross-product keyword combinations
    for kw_a in &keywords_a {
        for kw_b in &keywords_b {
            if kw_a != kw_b {
                triggers.push(format!("{} and {}", kw_a, kw_b));
                triggers.push(format!("{} then {}", kw_a, kw_b));
            }
        }
    }

    // Action-based patterns: prefix verbs like "do X where I need to Y"
    for kw_a in &keywords_a {
        for kw_b in &keywords_b {
            triggers.push(format!("use {} and then use {}", kw_a, kw_b));
            triggers.push(format!("need to {} and {}", kw_a, kw_b));
        }
    }

    deduplicate_triggers(triggers)
}

/// Generate natural language trigger patterns for a single tool.
fn generate_tool_triggers(tool: &str) -> Vec<String> {
    let mut triggers = Vec::new();

    let friendly = tool.replace('_', " ");
    triggers.push(friendly.clone());

    let keywords = extract_keywords(tool);
    for kw in &keywords {
        triggers.push(kw.clone());
    }

    deduplicate_triggers(triggers)
}

/// Extract meaningful natural-language keywords from a tool name.
/// "send_whatsapp_message" → ["send whatsapp", "whatsapp message", "message",
///                              "send", "whatsapp", "wa", "whats app"]
fn extract_keywords(tool: &str) -> Vec<String> {
    let parts: Vec<&str> = tool.split('_').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return vec![tool.to_string()];
    }

    let mut keywords = Vec::new();

    // Each individual word
    for part in &parts {
        let lower = part.to_lowercase();
        if !lower.is_empty() {
            keywords.push(lower.clone());
        }
    }

    // Bigrams (word pairs)
    for window in parts.windows(2) {
        keywords.push(format!("{} {}", window[0], window[1]).to_lowercase());
    }

    // Full space-separated name
    let full: String = parts.join(" ");
    keywords.push(full.clone());

    // Verb prefix patterns — what users actually say
    let verb = parts[0];
    let rest: String = parts[1..].join(" ");
    match verb {
        "send" => {
            keywords.push(format!("send {}", rest));
            keywords.push(format!("message {}", rest));
            keywords.push("text".to_string());
            keywords.push("message".to_string());
        }
        "launch" => {
            keywords.push(format!("open {}", rest));
            keywords.push(format!("launch {}", rest));
            keywords.push(format!("start {}", rest));
            keywords.push("open".to_string());
        }
        "close" => {
            keywords.push(format!("close {}", rest));
            keywords.push(format!("quit {}", rest));
            keywords.push(format!("exit {}", rest));
        }
        "toggle" => {
            keywords.push(format!("toggle {}", rest));
            keywords.push(format!("turn {} off", rest));
            keywords.push(format!("turn {} on", rest));
            keywords.push(format!("enable {}", rest));
            keywords.push(format!("disable {}", rest));
            keywords.push("enable".to_string());
            keywords.push("disable".to_string());
            keywords.push("turn on".to_string());
            keywords.push("turn off".to_string());
        }
        "discord" => {
            keywords.push("discord".to_string());
            keywords.push("server".to_string());
            keywords.push("members".to_string());
        }
        _ => {}
    }

    // Product/app name aliases
    for part in &parts {
        match part.to_lowercase().as_str() {
            "whatsapp" => {
                keywords.push("wa".to_string());
                keywords.push("whats app".to_string());
                keywords.push("whatsapp message".to_string());
            }
            "discord" => {
                keywords.push("dc".to_string());
                keywords.push("disc".to_string());
            }
            "spotify" => {
                keywords.push("spot".to_string());
            }
            "email" => {
                keywords.push("mail".to_string());
                keywords.push("email".to_string());
            }
            "gmail" => {
                keywords.push("gmail".to_string());
                keywords.push("mail".to_string());
            }
            _ => {}
        }
    }

    keywords
}

fn deduplicate_triggers(triggers: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for t in triggers {
        let lower = t.to_lowercase().trim().to_string();
        if !lower.is_empty() && seen.insert(lower.clone()) {
            result.push(lower);
        }
    }
    // Keep a reasonable cap — too many trigger patterns waste memory + matching time
    if result.len() > 25 {
        result.truncate(25);
    }
    result
}