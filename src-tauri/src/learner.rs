use crate::skills::SkillStore;
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

        for (sequence, _count) in &strong_sequences {
            let parts: Vec<&str> = sequence.split(" -> ").collect();
            if parts.len() == 2 {
                let tool_a = parts[0];
                let tool_b = parts[1];
                let friendly_a = tool_a.replace('_', " ");
                let friendly_b = tool_b.replace('_', " ");

                // ponytail: YAGNI - don't auto-generate actual skills, just log insights.
                let insight_text = format!(
                    "I noticed you often use {} and {} together.",
                    friendly_a, friendly_b
                );
                let already_has = self.insights.iter().any(|i| i.insight == insight_text);
                if !already_has {
                    self.insights.push(LearnedInsight {
                        category: "suggestion".to_string(),
                        insight: insight_text,
                        confidence: 0.7,
                        related_tools: vec![tool_a.to_string(), tool_b.to_string()],
                    });
                }
            }
        }

        // Cleanup any legacy auto-generated sequence skills
        let to_remove: Vec<String> = skills_store.skills.values()
            .filter(|s| s.auto_generated && s.name.starts_with("auto-"))
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

        for (tool, count) in &favorite_tools {
            if strong_sequence_tools.contains(tool) {
                continue;
            }

            // ponytail: YAGNI - no need to generate skills for frequent tools. Just insights.
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
        }

        // Cleanup old frequent skills
        let to_remove: Vec<String> = skills_store.skills.values()
            .filter(|s| s.auto_generated && s.name.starts_with("frequent-"))
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
