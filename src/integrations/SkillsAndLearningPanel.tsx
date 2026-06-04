import { useState, useEffect } from "react";
import { api, Skill, LearnedInsight } from "../lib/api";
import { ChevronDown, ChevronRight, Brain, Book, Trash2, Lightbulb, BarChart3, RefreshCw, Edit3, XCircle } from "lucide-react";

export default function SkillsAndLearningSection() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [insights, setInsights] = useState<LearnedInsight[]>([]);
  const [usageSummary, setUsageSummary] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"skills" | "insights" | "usage">("skills");

  // New skill form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingInsightIndex, setEditingInsightIndex] = useState<number | null>(null);
  const [editingInsightText, setEditingInsightText] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTriggers, setNewTriggers] = useState("");
  const [newTools, setNewTools] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newContent, setNewContent] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, i, u] = await Promise.all([
        api.listSkills(),
        api.getLearningInsights(),
        api.getToolUsageSummary(),
      ]);
      setSkills(s);
      setInsights(i);
      setUsageSummary(u);
    } catch (e) {
      console.error("[SKILLS] Failed to load:", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete skill "${name}"?`)) return;
    try {
      await api.deleteSkill(name);
      setSkills((prev) => prev.filter((s) => s.name !== name));
      if (selectedSkill?.name === name) setSelectedSkill(null);
    } catch (e) {
      console.error("[SKILLS] Delete failed:", e);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newDesc.trim()) return;
    const triggerArray = newTriggers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const toolsArray = newTools
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const tagsArray = newTags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await api.createSkill(
        newName.trim(),
        newDesc.trim(),
        triggerArray,
        toolsArray,
        tagsArray,
        newContent.trim(),
      );
      setNewName("");
      setNewDesc("");
      setNewTriggers("");
      setNewTools("");
      setNewTags("");
      setNewContent("");
      setShowNewForm(false);
      await loadAll();
    } catch (e) {
      console.error("[SKILLS] Create failed:", e);
    }
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) return { label: "high", cls: "conf-high" };
    if (confidence >= 0.6) return { label: "medium", cls: "conf-med" };
    return { label: "low", cls: "conf-low" };
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "preference":
        return "❤️";
      case "pattern":
        return "🔄";
      case "suggestion":
        return "💡";
      default:
        return "📌";
    }
  };

  return (
    <section className="settings-section collapsible">
      <div
        className={`section-header clickable ${isExpanded ? "active" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <Brain size={14} />
          <span>Skills & Learning</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {isExpanded && (
            <button
              className="icon-only-btn"
              onClick={(e) => {
                e.stopPropagation();
                loadAll();
              }}
              title="Refresh"
            >
              <RefreshCw size={12} className={loading ? "spin" : ""} />
            </button>
          )}
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {isExpanded && (
        <div className="settings-list animate-fade-in">
          {/* Tab bar */}
          <div className="tab-bar" style={{ marginBottom: "0.75rem" }}>
            <button
              className={`tab-btn ${tab === "skills" ? "active" : ""}`}
              onClick={() => setTab("skills")}
            >
              <Book size={14} /> Skills
            </button>
            <button
              className={`tab-btn ${tab === "insights" ? "active" : ""}`}
              onClick={() => setTab("insights")}
            >
              <Lightbulb size={14} /> Insights
            </button>
            <button
              className={`tab-btn ${tab === "usage" ? "active" : ""}`}
              onClick={() => setTab("usage")}
            >
              <BarChart3 size={14} /> Usage
            </button>
          </div>

          {/* Skills Tab */}
          {tab === "skills" && (
            <div className="skills-tab">
              <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0" }}>
                <span>Skills ({skills.length})</span>
                <button
                  className="save-btn"
                  onClick={() => setShowNewForm(!showNewForm)}
                  style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                >
                  + New
                </button>
              </div>

              {/* New skill form */}
              {showNewForm && (
                <div className="skill-form">
                  <input
                    className="minimal-input"
                    placeholder="Skill name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <input
                    className="minimal-input"
                    placeholder="Description"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                  <input
                    className="minimal-input"
                    placeholder="Trigger patterns (comma-separated)"
                    value={newTriggers}
                    onChange={(e) => setNewTriggers(e.target.value)}
                  />
                  <input
                    className="minimal-input"
                    placeholder="Related tools (comma-separated)"
                    value={newTools}
                    onChange={(e) => setNewTools(e.target.value)}
                  />
                  <input
                    className="minimal-input"
                    placeholder="Tags (comma-separated)"
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                  />
                  <textarea
                    className="minimal-input"
                    placeholder="Skill content (markdown)"
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    rows={4}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <button className="save-btn" onClick={handleCreate}>
                      Create
                    </button>
                    <button
                      className="back-btn"
                      onClick={() => setShowNewForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Skill list */}
              {skills.length === 0 ? (
                <div className="empty-state" style={{ padding: "1rem 0" }}>
                  <p>No skills yet. Skills will be auto-created as PERN learns your patterns.</p>
                </div>
              ) : (
                <div className="skill-list">
                  {skills.map((skill) => (
                    <div key={skill.name} className="skill-item">
                      <div
                        className="skill-item-header"
                        onClick={() =>
                          setSelectedSkill(
                            selectedSkill?.name === skill.name ? null : skill,
                          )
                        }
                      >
                        <span className="skill-name">
                          {skill.auto_generated ? "🤖 " : "📋 "}
                          {skill.name}
                        </span>
                        <span className="skill-meta">
                          {skill.auto_generated ? "auto" : "user"}
                          {" · "}
                          {skill.usage_count} uses
                        </span>
                      </div>

                      {selectedSkill?.name === skill.name && (
                        <div className="skill-detail">
                          <p className="skill-desc">{skill.description}</p>
                          {skill.trigger_patterns.length > 0 && (
                            <div className="skill-tags">
                              {skill.trigger_patterns.map((p) => (
                                <span key={p} className="tag">
                                  {p}
                                </span>
                              ))}
                            </div>
                          )}
                          {skill.related_tools.length > 0 && (
                            <p className="skill-tools">
                              Tools: {skill.related_tools.join(", ")}
                            </p>
                          )}
                          <div className="skill-actions">
                            <button
                              className="delete-btn"
                              onClick={() => handleDelete(skill.name)}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Insights Tab */}
          {tab === "insights" && (
            <div className="insights-tab">
              <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0" }}>
                <span>What PERN Has Learned About You</span>
                {insights.length > 0 && (
                  <button
                    className="minimal-btn"
                    onClick={async () => {
                      if (confirm("Clear all learned insights? This cannot be undone.")) {
                        try {
                          await api.clearLearningInsights();
                          setInsights([]);
                        } catch (e) {
                          console.error("[INSIGHTS] Failed to clear:", e);
                        }
                      }
                    }}
                    style={{ padding: "3px 8px", fontSize: "0.7rem", color: "var(--danger, #e74c3c)" }}
                    title="Clear all insights"
                  >
                    <XCircle size={12} /> Clear All
                  </button>
                )}
              </div>

              {insights.length === 0 ? (
                <div className="empty-state" style={{ padding: "1rem 0" }}>
                  <p>
                    No insights yet. As you use PERN more, it will learn your
                    preferences and patterns.
                  </p>
                </div>
              ) : (
                <div className="insight-list">
                  {insights.map((insight, i) => {
                    const badge = getConfidenceBadge(insight.confidence);
                    const isEditing = editingInsightIndex === i;
                    return (
                      <div key={i} className="insight-item">
                        <div className="insight-icon">
                          {getCategoryIcon(insight.category)}
                        </div>
                        <div className="insight-body">
                          {isEditing ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                              <textarea
                                className="minimal-input"
                                value={editingInsightText}
                                onChange={(e) => setEditingInsightText(e.target.value)}
                                rows={3}
                                style={{ width: "100%", fontSize: "0.75rem", resize: "vertical" }}
                              />
                              <div style={{ display: "flex", gap: "0.4rem" }}>
                                <button
                                  className="save-btn"
                                  onClick={async () => {
                                    if (!editingInsightText.trim()) return;
                                    try {
                                      await api.updateLearningInsight(
                                        i,
                                        editingInsightText.trim(),
                                        insight.category,
                                        insight.confidence,
                                        insight.related_tools,
                                      );
                                      setInsights((prev) =>
                                        prev.map((ins, idx) =>
                                          idx === i
                                            ? { ...ins, insight: editingInsightText.trim() }
                                            : ins,
                                        ),
                                      );
                                      setEditingInsightIndex(null);
                                    } catch (e) {
                                      console.error("[INSIGHTS] Update failed:", e);
                                    }
                                  }}
                                  style={{ padding: "2px 8px", fontSize: "0.7rem" }}
                                >
                                  Save
                                </button>
                                <button
                                  className="back-btn"
                                  onClick={() => setEditingInsightIndex(null)}
                                  style={{ padding: "2px 8px", fontSize: "0.7rem" }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="insight-text">{insight.insight}</p>
                          )}
                          <div className="insight-meta">
                            <span className={`conf-badge ${badge.cls}`}>
                              {badge.label} confidence
                            </span>
                            <span className="insight-category">
                              {insight.category}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginLeft: "0.4rem" }}>
                          {!isEditing && (
                            <button
                              className="icon-only-btn"
                              onClick={() => {
                                setEditingInsightIndex(i);
                                setEditingInsightText(insight.insight);
                              }}
                              title="Edit insight"
                              style={{ padding: "2px", opacity: 0.5 }}
                            >
                              <Edit3 size={11} />
                            </button>
                          )}
                          <button
                            className="icon-only-btn"
                            onClick={async () => {
                              try {
                                await api.deleteLearningInsight(i);
                                setInsights((prev) => prev.filter((_, idx) => idx !== i));
                                if (editingInsightIndex === i) setEditingInsightIndex(null);
                              } catch (e) {
                                console.error("[INSIGHTS] Delete failed:", e);
                              }
                            }}
                            title="Delete insight"
                            style={{ padding: "2px", opacity: 0.5, color: "var(--danger, #e74c3c)" }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Usage Tab */}
          {tab === "usage" && (
            <div className="usage-tab">
              <div className="section-header" style={{ padding: "0.5rem 0" }}>
                <span>Tool Usage Summary</span>
              </div>
              <div
                className="usage-content"
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "0.8rem",
                  lineHeight: 1.6,
                  opacity: 0.9,
                }}
              >
                {usageSummary || "Loading..."}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}