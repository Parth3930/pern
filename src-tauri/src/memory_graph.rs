//! Persistent knowledge graph backing the agent's long-term memory.
//!
//! Stored on disk at `<app_dir>/memory_graph.json` as pretty-printed JSON.
//! The graph is a small directed-typed graph of `Entity` nodes connected by
//! labelled `Relation` edges. Each entity has a category (Person, Project,
//! Preference, RecurringTask, Other), a stable `key`, a `value`, and a list
//! of `aliases` so that free-form queries can resolve e.g. "Bob" -> "robert".
//!
//! Concurrency: callers store the loaded graph behind an `Arc<Mutex<MemoryGraph>>`
//! in `state::AppState`. Every mutating API method on this type takes `&mut
//! MemoryGraph`, so the mutex is the only synchronisation point. Pure-Rust
//! search uses `to_lowercase().contains()` — no regex crate, no extra deps.

use crate::storage::get_app_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub const CURRENT_GRAPH_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntityCategory {
    Person,
    Project,
    Preference,
    RecurringTask,
    Other,
}

impl EntityCategory {
    /// Convert the snake_case form used on the wire back to the enum.
    pub fn from_str(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "person" => Some(Self::Person),
            "project" => Some(Self::Project),
            "preference" => Some(Self::Preference),
            "recurring_task" | "recurringtask" | "recurring-task" => {
                Some(Self::RecurringTask)
            }
            "other" => Some(Self::Other),
            _ => None,
        }
    }

    /// Canonical snake_case wire form.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Project => "project",
            Self::Preference => "preference",
            Self::RecurringTask => "recurring_task",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Entity {
    pub id: String,
    pub category: EntityCategory,
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub source: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Relation {
    pub from_id: String,
    pub to_id: String,
    pub label: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MemoryGraph {
    pub entities: Vec<Entity>,
    pub relations: Vec<Relation>,
    pub version: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchHit {
    pub entity: Entity,
    pub score: f32,
}

/// A partial update for an existing entity. Every field is optional; absent
/// fields are left untouched on the target entity.
#[derive(Debug, Default, Deserialize, Clone)]
pub struct EntityPatch {
    pub category: Option<String>,
    pub key: Option<String>,
    pub value: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub source: Option<String>,
}

pub fn get_memory_graph_path() -> PathBuf {
    let mut path = get_app_dir();
    path.push("memory_graph.json");
    path
}

fn now_nanos() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// Generate a short, unique, deterministic-enough entity id.
pub fn generate_id() -> String {
    // Combination of nanos timestamp + process counter — fast and good enough
    // for a local single-user app. Avoids pulling in a uuid dependency.
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = now_nanos();
    format!("e_{:x}_{:x}", ts, n)
}

impl MemoryGraph {
    pub fn new() -> Self {
        Self {
            entities: Vec::new(),
            relations: Vec::new(),
            version: CURRENT_GRAPH_VERSION,
        }
    }

    /// Load the graph from disk; return an empty graph if no file exists or
    /// the file is corrupted.
    pub fn load() -> Self {
        let path = get_memory_graph_path();
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                match serde_json::from_str::<MemoryGraph>(&content) {
                    Ok(mut g) => {
                        g.migrate();
                        return g;
                    }
                    Err(e) => {
                        eprintln!(
                            "[MEMORY] Error deserializing memory_graph.json: {}. Backing up and starting fresh.",
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

    /// Persist the graph to disk, creating the app dir if needed.
    pub fn save(&self) -> Result<(), String> {
        let path = get_memory_graph_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }

    /// In-place version migration. Currently a v1-only no-op; future versions
    /// will transform `entities` / `relations` here.
    fn migrate(&mut self) {
        if self.version < CURRENT_GRAPH_VERSION {
            // Placeholder for future migration work; stamping the version is
            // the v1 -> v1 no-op. Keeping the branch so the structure is in place.
            self.version = CURRENT_GRAPH_VERSION;
        }
    }

    /// Add a brand-new entity. Returns the new entity on success.
    ///
    /// Rejects duplicates by `(category, key)` or by any alias colliding with
    /// an existing entity's key or alias.
    pub fn add(
        &mut self,
        category: EntityCategory,
        key: String,
        value: String,
        aliases: Vec<String>,
        source: Option<String>,
    ) -> Result<Entity, String> {
        let key = key.trim().to_string();
        if key.is_empty() {
            return Err("Entity key cannot be empty".to_string());
        }

        // Dedupe incoming aliases (lowercase, drop empties, drop key duplicates).
        let mut cleaned_aliases: Vec<String> = Vec::new();
        for a in aliases.iter() {
            let t = a.trim();
            if t.is_empty() {
                continue;
            }
            if t.eq_ignore_ascii_case(&key) {
                continue;
            }
            if cleaned_aliases
                .iter()
                .any(|x: &String| x.eq_ignore_ascii_case(t))
            {
                continue;
            }
            cleaned_aliases.push(t.to_string());
        }

        if self.find_id_by_key_or_alias(&key).is_some() {
            return Err(format!("Entity with key or alias '{}' already exists", key));
        }
        for a in &cleaned_aliases {
            if self.find_id_by_key_or_alias(a).is_some() {
                return Err(format!(
                    "Alias '{}' already belongs to another entity",
                    a
                ));
            }
        }

        let now = now_nanos();
        let entity = Entity {
            id: generate_id(),
            category,
            key,
            value,
            aliases: cleaned_aliases,
            source: source.unwrap_or_default(),
            created_at: now,
            updated_at: now,
        };
        self.entities.push(entity.clone());
        self.save()?;
        Ok(entity)
    }

    /// Patch an entity by id. Returns the updated entity.
    pub fn update(&mut self, id: &str, patch: EntityPatch) -> Result<Entity, String> {
        let target = self
            .entities
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| format!("Entity with id '{}' not found", id))?;

        // Build a tentative copy with the patch applied so we can validate
        // uniqueness before mutating in place.
        let original = self.entities[target].clone();
        let mut updated = original.clone();

        if let Some(cat_str) = patch.category {
            let new_cat = EntityCategory::from_str(&cat_str)
                .ok_or_else(|| format!("Invalid category '{}'", cat_str))?;
            updated.category = new_cat;
        }
        if let Some(k) = patch.key {
            let new_key = k.trim().to_string();
            if new_key.is_empty() {
                return Err("Entity key cannot be empty".to_string());
            }
            updated.key = new_key;
        }
        if let Some(v) = patch.value {
            updated.value = v;
        }
        if let Some(source) = patch.source {
            updated.source = source;
        }
        if let Some(aliases) = patch.aliases {
            let mut cleaned: Vec<String> = Vec::new();
            for a in aliases.iter() {
                let t = a.trim();
                if t.is_empty() {
                    continue;
                }
                if t.eq_ignore_ascii_case(&updated.key) {
                    continue;
                }
                if cleaned.iter().any(|x| x.eq_ignore_ascii_case(t)) {
                    continue;
                }
                cleaned.push(t.to_string());
            }
            updated.aliases = cleaned;
        }

        // Validate uniqueness of the new key + aliases against all *other* entities.
        for other in self.entities.iter().filter(|e| e.id != id) {
            if other.key.eq_ignore_ascii_case(&updated.key) {
                return Err(format!(
                    "Another entity already uses key '{}'",
                    updated.key
                ));
            }
            for a in &updated.aliases {
                if other.key.eq_ignore_ascii_case(a) {
                    return Err(format!(
                        "Alias '{}' collides with another entity's key",
                        a
                    ));
                }
                if other.aliases.iter().any(|oa| oa.eq_ignore_ascii_case(a)) {
                    return Err(format!(
                        "Alias '{}' collides with another entity's alias",
                        a
                    ));
                }
            }
        }

        updated.updated_at = now_nanos();
        self.entities[target] = updated.clone();
        self.save()?;
        Ok(updated)
    }

    /// Delete an entity and any relations touching it.
    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        let before = self.entities.len();
        self.entities.retain(|e| e.id != id);
        if self.entities.len() == before {
            return Err(format!("Entity with id '{}' not found", id));
        }
        // Cascade: drop any relations referencing this id.
        self.relations.retain(|r| r.from_id != id && r.to_id != id);
        self.save()?;
        Ok(())
    }

    /// Lookup a single entity by id.
    pub fn get(&self, id: &str) -> Option<Entity> {
        self.entities.iter().find(|e| e.id == id).cloned()
    }

    /// Find an entity id by primary key or alias match (case-insensitive).
    pub fn find_id_by_key_or_alias(&self, query: &str) -> Option<String> {
        let q = query.trim().to_lowercase();
        for e in &self.entities {
            if e.key.to_lowercase() == q {
                return Some(e.id.clone());
            }
            for a in &e.aliases {
                if a.to_lowercase() == q {
                    return Some(e.id.clone());
                }
            }
        }
        None
    }

    /// Optional category filter. `None` returns everything.
    pub fn list(&self, category: Option<EntityCategory>) -> Vec<Entity> {
        match category {
            Some(cat) => self
                .entities
                .iter()
                .filter(|e| e.category == cat)
                .cloned()
                .collect(),
            None => self.entities.clone(),
        }
    }

    /// Substring + alias search. Pure Rust, no regex.
    ///
    /// Score (0.0..1.0) is the maximum of:
    ///   - exact key match  -> 1.0
    ///   - exact alias match -> 0.95
    ///   - key contains query -> 0.8
    ///   - alias contains query -> 0.7
    ///   - value contains query -> 0.4
    ///   - alias contains key match (reverse) -> 0.3
    pub fn search(&self, query: &str, k: usize) -> Vec<SearchHit> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Vec::new();
        }

        let mut hits: Vec<SearchHit> = Vec::new();
        for e in &self.entities {
            let key_lc = e.key.to_lowercase();
            let mut best: Option<f32> = None;

            if key_lc == q {
                best = Some(1.0);
            } else if key_lc.contains(&q) {
                best = Some(0.8);
            } else if e.value.to_lowercase().contains(&q) {
                best = Some(0.4);
            }

            for a in &e.aliases {
                let al = a.to_lowercase();
                let s = if al == q {
                    0.95
                } else if al.contains(&q) {
                    0.7
                } else if q.contains(&al) {
                    0.3
                } else {
                    0.0
                };
                if s > 0.0 {
                    best = Some(best.map_or(s, |b| b.max(s)));
                }
            }

            if let Some(score) = best {
                hits.push(SearchHit {
                    entity: e.clone(),
                    score,
                });
            }
        }

        // Highest score first, stable on id for determinism.
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.entity.id.cmp(&b.entity.id))
        });
        hits.truncate(k);
        hits
    }

    /// Add a typed relation between two entities. Rejects self-loops, missing
    /// endpoints, and exact duplicates.
    pub fn add_relation(
        &mut self,
        from_id: &str,
        to_id: &str,
        label: &str,
    ) -> Result<Relation, String> {
        if from_id == to_id {
            return Err("Relation cannot point an entity to itself".to_string());
        }
        if !self.entities.iter().any(|e| e.id == from_id) {
            return Err(format!("Source entity '{}' not found", from_id));
        }
        if !self.entities.iter().any(|e| e.id == to_id) {
            return Err(format!("Target entity '{}' not found", to_id));
        }
        let label = label.trim();
        if label.is_empty() {
            return Err("Relation label cannot be empty".to_string());
        }
        if self
            .relations
            .iter()
            .any(|r| r.from_id == from_id && r.to_id == to_id && r.label == label)
        {
            return Err(format!(
                "Relation '{}' -> '{}' with label '{}' already exists",
                from_id, to_id, label
            ));
        }
        let rel = Relation {
            from_id: from_id.to_string(),
            to_id: to_id.to_string(),
            label: label.to_string(),
        };
        self.relations.push(rel.clone());
        self.save()?;
        Ok(rel)
    }

    pub fn delete_relation(
        &mut self,
        from_id: &str,
        to_id: &str,
        label: &str,
    ) -> Result<(), String> {
        let before = self.relations.len();
        self.relations
            .retain(|r| !(r.from_id == from_id && r.to_id == to_id && r.label == label));
        if self.relations.len() == before {
            return Err(format!(
                "Relation '{}' -> '{}' (label '{}') not found",
                from_id, to_id, label
            ));
        }
        self.save()?;
        Ok(())
    }

    pub fn list_relations(&self, from_id: Option<&str>) -> Vec<Relation> {
        match from_id {
            Some(fid) => self
                .relations
                .iter()
                .filter(|r| r.from_id == fid)
                .cloned()
                .collect(),
            None => self.relations.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_graph() -> MemoryGraph {
        // Don't touch disk in unit tests.
        MemoryGraph::new()
    }

    #[test]
    fn test_category_from_str() {
        assert_eq!(EntityCategory::from_str("person"), Some(EntityCategory::Person));
        assert_eq!(EntityCategory::from_str("RECURRING_TASK"), Some(EntityCategory::RecurringTask));
        assert_eq!(EntityCategory::from_str("recurringTask"), Some(EntityCategory::RecurringTask));
        assert_eq!(EntityCategory::from_str("nope"), None);
    }

    #[test]
    fn test_add_and_get() {
        let mut g = fresh_graph();
        let e = g
            .add(
                EntityCategory::Person,
                "robert".to_string(),
                "Friend from college".to_string(),
                vec!["Bob".to_string(), "bobby".to_string()],
                Some("test".to_string()),
            )
            .expect("add ok");
        assert_eq!(e.key, "robert");
        assert_eq!(e.aliases, vec!["Bob".to_string(), "bobby".to_string()]);
        assert_eq!(g.get(&e.id).map(|x| x.key), Some("robert".to_string()));
    }

    #[test]
    fn test_add_rejects_duplicate_key() {
        let mut g = fresh_graph();
        g.add(
            EntityCategory::Person,
            "robert".to_string(),
            "a".to_string(),
            vec![],
            None,
        )
        .unwrap();
        let err = g
            .add(
                EntityCategory::Person,
                "Robert".to_string(),
                "b".to_string(),
                vec![],
                None,
            )
            .unwrap_err();
        assert!(err.to_lowercase().contains("already"), "got: {}", err);
    }

    #[test]
    fn test_add_rejects_duplicate_alias() {
        let mut g = fresh_graph();
        g.add(
            EntityCategory::Person,
            "robert".to_string(),
            "a".to_string(),
            vec![],
            None,
        )
        .unwrap();
        let err = g
            .add(
                EntityCategory::Person,
                "bob".to_string(),
                "b".to_string(),
                vec!["Robert".to_string()],
                None,
            )
            .unwrap_err();
        assert!(err.to_lowercase().contains("already"), "got: {}", err);
    }

    #[test]
    fn test_add_rejects_empty_key() {
        let mut g = fresh_graph();
        let err = g
            .add(
                EntityCategory::Person,
                "   ".to_string(),
                "v".to_string(),
                vec![],
                None,
            )
            .unwrap_err();
        assert!(err.to_lowercase().contains("empty"));
    }

    #[test]
    fn test_add_strips_empty_and_duplicate_aliases() {
        let mut g = fresh_graph();
        let e = g
            .add(
                EntityCategory::Person,
                "robert".to_string(),
                "v".to_string(),
                vec!["".to_string(), "Bob".to_string(), "bobby".to_string(), "Bob".to_string()],
                None,
            )
            .unwrap();
        assert_eq!(e.aliases, vec!["Bob".to_string(), "bobby".to_string()]);
    }

    #[test]
    fn test_update_changes_fields() {
        let mut g = fresh_graph();
        let e = g
            .add(
                EntityCategory::Preference,
                "tea".to_string(),
                "Earl grey".to_string(),
                vec![],
                None,
            )
            .unwrap();
        let updated = g
            .update(
                &e.id,
                EntityPatch {
                    value: Some("English breakfast".to_string()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(updated.value, "English breakfast");
        assert!(updated.updated_at >= e.updated_at);
    }

    #[test]
    fn test_update_changes_category_via_string() {
        let mut g = fresh_graph();
        let e = g
            .add(
                EntityCategory::Other,
                "k".to_string(),
                "v".to_string(),
                vec![],
                None,
            )
            .unwrap();
        let updated = g
            .update(
                &e.id,
                EntityPatch {
                    category: Some("project".to_string()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(updated.category, EntityCategory::Project);
    }

    #[test]
    fn test_update_rejects_invalid_category() {
        let mut g = fresh_graph();
        let e = g
            .add(
                EntityCategory::Other,
                "k".to_string(),
                "v".to_string(),
                vec![],
                None,
            )
            .unwrap();
        let err = g
            .update(
                &e.id,
                EntityPatch {
                    category: Some("not-a-category".to_string()),
                    ..Default::default()
                },
            )
            .unwrap_err();
        assert!(err.to_lowercase().contains("invalid"), "got: {}", err);
    }

    #[test]
    fn test_update_rejects_duplicate_alias() {
        let mut g = fresh_graph();
        g.add(
            EntityCategory::Person,
            "robert".to_string(),
            "v".to_string(),
            vec![],
            None,
        )
        .unwrap();
        let e2 = g
            .add(
                EntityCategory::Person,
                "kate".to_string(),
                "v".to_string(),
                vec!["katie".to_string()],
                None,
            )
            .unwrap();
        let err = g
            .update(
                &e2.id,
                EntityPatch {
                    aliases: Some(vec!["Robert".to_string()]),
                    ..Default::default()
                },
            )
            .unwrap_err();
        assert!(err.to_lowercase().contains("collides"), "got: {}", err);
    }

    #[test]
    fn test_delete_cascades_relations() {
        let mut g = fresh_graph();
        let a = g
            .add(EntityCategory::Person, "a".to_string(), "v".to_string(), vec![], None)
            .unwrap();
        let b = g
            .add(EntityCategory::Person, "b".to_string(), "v".to_string(), vec![], None)
            .unwrap();
        g.add_relation(&a.id, &b.id, "knows").unwrap();
        assert_eq!(g.relations.len(), 1);
        g.delete(&a.id).unwrap();
        assert!(g.relations.is_empty());
    }

    #[test]
    fn test_delete_missing_returns_error() {
        let mut g = fresh_graph();
        let err = g.delete("e_does_not_exist").unwrap_err();
        assert!(err.to_lowercase().contains("not found"));
    }

    #[test]
    fn test_search_finds_exact_key_and_alias() {
        let mut g = fresh_graph();
        g.add(
            EntityCategory::Person,
            "robert".to_string(),
            "college friend".to_string(),
            vec!["Bob".to_string()],
            None,
        )
        .unwrap();
        g.add(
            EntityCategory::Project,
            "pern".to_string(),
            "offline AI assistant".to_string(),
            vec![],
            None,
        )
        .unwrap();

        let hits = g.search("Bob", 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entity.key, "robert");
        assert!(hits[0].score >= 0.9);

        let hits = g.search("pern", 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entity.key, "pern");
    }

    #[test]
    fn test_search_substring_match_in_value() {
        let mut g = fresh_graph();
        g.add(
            EntityCategory::Preference,
            "drink".to_string(),
            "I like green tea in the morning".to_string(),
            vec![],
            None,
        )
        .unwrap();
        let hits = g.search("green tea", 10);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].score <= 0.5, "value match should be low-ish: {}", hits[0].score);
    }

    #[test]
    fn test_search_empty_query_returns_nothing() {
        let mut g = fresh_graph();
        g.add(
            EntityCategory::Person,
            "robert".to_string(),
            "v".to_string(),
            vec![],
            None,
        )
        .unwrap();
        let hits = g.search("   ", 10);
        assert!(hits.is_empty());
    }

    #[test]
    fn test_search_k_limits_results() {
        let mut g = fresh_graph();
        for i in 0..5 {
            g.add(
                EntityCategory::Other,
                format!("thing{}", i),
                format!("desc {}", i),
                vec![],
                None,
            )
            .unwrap();
        }
        let hits = g.search("thing", 2);
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn test_list_with_category_filter() {
        let mut g = fresh_graph();
        g.add(
            EntityCategory::Person,
            "a".to_string(),
            "v".to_string(),
            vec![],
            None,
        )
        .unwrap();
        g.add(
            EntityCategory::Project,
            "b".to_string(),
            "v".to_string(),
            vec![],
            None,
        )
        .unwrap();
        g.add(
            EntityCategory::Person,
            "c".to_string(),
            "v".to_string(),
            vec![],
            None,
        )
        .unwrap();
        assert_eq!(g.list(None).len(), 3);
        assert_eq!(g.list(Some(EntityCategory::Person)).len(), 2);
        assert_eq!(g.list(Some(EntityCategory::Project)).len(), 1);
        assert_eq!(g.list(Some(EntityCategory::Preference)).len(), 0);
    }

    #[test]
    fn test_relations_add_list_delete() {
        let mut g = fresh_graph();
        let a = g
            .add(EntityCategory::Person, "a".to_string(), "v".to_string(), vec![], None)
            .unwrap();
        let b = g
            .add(EntityCategory::Person, "b".to_string(), "v".to_string(), vec![], None)
            .unwrap();
        let r = g.add_relation(&a.id, &b.id, "knows").unwrap();
        assert_eq!(r.label, "knows");
        assert_eq!(g.list_relations(None).len(), 1);
        assert_eq!(g.list_relations(Some(&a.id)).len(), 1);
        assert_eq!(g.list_relations(Some(&b.id)).len(), 0);
        g.delete_relation(&a.id, &b.id, "knows").unwrap();
        assert!(g.relations.is_empty());
    }

    #[test]
    fn test_relation_rejects_self_loop() {
        let mut g = fresh_graph();
        let a = g
            .add(EntityCategory::Person, "a".to_string(), "v".to_string(), vec![], None)
            .unwrap();
        let err = g.add_relation(&a.id, &a.id, "self").unwrap_err();
        assert!(err.to_lowercase().contains("self"), "got: {}", err);
    }

    #[test]
    fn test_relation_rejects_missing_endpoint() {
        let mut g = fresh_graph();
        let a = g
            .add(EntityCategory::Person, "a".to_string(), "v".to_string(), vec![], None)
            .unwrap();
        let err = g.add_relation(&a.id, "e_nope", "knows").unwrap_err();
        assert!(err.to_lowercase().contains("not found"));
    }

    #[test]
    fn test_relation_rejects_duplicate() {
        let mut g = fresh_graph();
        let a = g
            .add(EntityCategory::Person, "a".to_string(), "v".to_string(), vec![], None)
            .unwrap();
        let b = g
            .add(EntityCategory::Person, "b".to_string(), "v".to_string(), vec![], None)
            .unwrap();
        g.add_relation(&a.id, &b.id, "knows").unwrap();
        let err = g.add_relation(&a.id, &b.id, "knows").unwrap_err();
        assert!(err.to_lowercase().contains("already"));
    }

    #[test]
    fn test_migrate_is_noop_for_v1() {
        let mut g = MemoryGraph {
            entities: Vec::new(),
            relations: Vec::new(),
            version: 0,
        };
        g.migrate();
        assert_eq!(g.version, CURRENT_GRAPH_VERSION);
    }

    #[test]
    fn test_find_id_by_key_or_alias() {
        let mut g = fresh_graph();
        let a = g
            .add(
                EntityCategory::Person,
                "robert".to_string(),
                "v".to_string(),
                vec!["Bob".to_string()],
                None,
            )
            .unwrap();
        assert_eq!(g.find_id_by_key_or_alias("Robert").as_ref(), Some(&a.id));
        assert_eq!(g.find_id_by_key_or_alias("bob").as_ref(), Some(&a.id));
        assert_eq!(g.find_id_by_key_or_alias("nobody"), None);
    }
}
