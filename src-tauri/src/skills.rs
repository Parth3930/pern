use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// A reusable skill/workflow — like Hermes Agent SKILL.md but simpler.
/// Skills define a trigger pattern and procedure for a recurring task.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub version: String, // semver
    pub author: String,
    pub trigger_patterns: Vec<String>, // keywords/phrases that trigger this skill
    pub related_tools: Vec<String>,    // tools this skill uses
    pub tags: Vec<String>,
    pub content: String, // markdown body — how to execute the skill
    pub usage_count: u64,
    pub auto_generated: bool, // true = PERN created it from observed patterns
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SkillStore {
    pub skills: HashMap<String, Skill>,
}

impl SkillStore {
    /// Get the directory where skills are stored
    pub fn get_skills_dir() -> PathBuf {
        let mut path = crate::storage::get_app_dir();
        path.push("skills");
        path
    }

    /// Load all skills from disk
    pub fn load() -> Self {
        let dir = Self::get_skills_dir();
        if !dir.exists() {
            return Self::default();
        }

        let mut skills = HashMap::new();
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(skill) = serde_json::from_str::<Skill>(&content) {
                            skills.insert(skill.name.clone(), skill);
                        }
                    }
                }
            }
        }
        Self { skills }
    }

    /// Save skill to disk
    pub fn save_skill(&self, skill: &Skill) -> Result<(), String> {
        let dir = Self::get_skills_dir();
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let mut path = dir;
        path.push(format!("{}.json", skill.name));
        let content = serde_json::to_string_pretty(skill).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Add or update a skill
    pub fn upsert(&mut self, skill: Skill) -> Result<(), String> {
        self.save_skill(&skill)?;
        self.skills.insert(skill.name.clone(), skill);
        Ok(())
    }

    /// Remove a skill
    pub fn remove(&mut self, name: &str) -> Result<(), String> {
        let dir = Self::get_skills_dir();
        let mut path = dir;
        path.push(format!("{}.json", name));
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        self.skills.remove(name);
        Ok(())
    }

    /// Find skills relevant to a given user input
    pub fn find_relevant(&self, input: &str) -> Vec<&Skill> {
        let input_lower = input.to_lowercase();
        let mut relevant: Vec<&Skill> = self
            .skills
            .values()
            .filter(|s| {
                s.trigger_patterns
                    .iter()
                    .any(|p| input_lower.contains(&p.to_lowercase()))
            })
            .collect();
        // Sort by usage_count descending (most-used first)
        relevant.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
        relevant.truncate(3); // max 3 relevant skills
        relevant
    }

    /// Increment usage count for a skill
    pub fn record_usage(&mut self, name: &str) -> Result<(), String> {
        if let Some(skill) = self.skills.get_mut(name) {
            skill.usage_count += 1;
            let skill_clone = skill.clone();
            self.save_skill(&skill_clone)?;
        }
        Ok(())
    }
}

/// Generate a name-safe key from a string
pub fn sanitize_skill_name(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == ' ')
        .collect::<String>()
        .trim()
        .replace(' ', "-")
}