import { useEffect, useState } from "react";
import { api, ProjectConfig } from "../../lib/api";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderTree,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

function deriveProjectName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

export default function ProjectsSettings() {
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<string | null>(null);

  const loadProjects = async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
    } catch (e) {
      console.error("[PROJECTS] Failed to load:", e);
    }
  };

  useEffect(() => {
    if (isExpanded) {
      loadProjects();
    }
  }, [isExpanded]);

  const handleAdd = async () => {
    const name = newName.trim();
    const path = newPath.trim();

    if (!name || !path) {
      setFormError("Project name and directory are both required.");
      setFormStatus(null);
      return;
    }

    setAdding(true);
    setFormError(null);
    setFormStatus(null);

    try {
      await api.addProject(name, path);
      setNewName("");
      setNewPath("");
      setFormStatus(`Added project "${name}".`);
      await loadProjects();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[PROJECTS] Failed to add:", e);
      setFormError(message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (name: string) => {
    if (!confirm(`Remove project "${name}"?`)) return;
    try {
      await api.removeProject(name);
      setFormStatus(`Removed project "${name}".`);
      setFormError(null);
      await loadProjects();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[PROJECTS] Failed to remove:", e);
      setFormError(message);
      setFormStatus(null);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        setNewPath(selected);
        setFormError(null);
        setFormStatus(null);

        if (!newName.trim()) {
          const derivedName = deriveProjectName(selected);
          if (derivedName) {
            setNewName(derivedName);
          }
        }
      }
    } catch (e) {
      console.error("[PROJECTS] Dialog failed:", e);
      setFormError("Could not open the folder picker.");
    }
  };

  const canAdd = !adding && Boolean(newName.trim()) && Boolean(newPath.trim());

  return (
    <section className="settings-section collapsible">
      <div
        className={`section-header clickable ${isExpanded ? "active" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <FolderTree size={14} />
          <span>Projects</span>
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {isExpanded && (
        <div className="settings-list animate-fade-in projects-settings-shell">
          <div className="settings-item">
            <label className="settings-label">
              Manage Projects (Workspaces for agent routing)
            </label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                marginTop: "0.5rem",
              }}
            >
              <input
                type="text"
                className="minimal-input"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setFormError(null);
                  setFormStatus(null);
                }}
                placeholder="Project name (e.g. Pern)"
              />
              <div style={{ display: "flex", gap: "0.25rem" }}>
                <input
                  type="text"
                  className="minimal-input"
                  style={{ flex: 1 }}
                  value={newPath}
                  onChange={(e) => {
                    setNewPath(e.target.value);
                    setFormError(null);
                    setFormStatus(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  placeholder="Directory path (e.g. D:\agent\pern)"
                />
                <button
                  type="button"
                  className="icon-only-btn"
                  onClick={handleSelectFolder}
                  title="Browse for folder"
                  style={{ padding: "0 0.6rem" }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>
              <button
                type="button"
                className="minimal-btn primary"
                onClick={handleAdd}
                disabled={!canAdd}
                style={{ width: "100%", padding: "0.6rem 1.2rem" }}
              >
                {adding ? "Adding..." : "Add"}
              </button>
            </div>

            {(formError || formStatus) && (
              <div
                style={{
                  marginTop: "0.5rem",
                  fontSize: "0.7rem",
                  color: formError ? "#ef4444" : "#22c55e",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem",
                }}
              >
                {formError ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
                <span>{formError || formStatus}</span>
              </div>
            )}

            <div
              className="allowed-numbers-list"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
                marginTop: "1rem",
              }}
            >
              {projects.length === 0 && (
                <span style={{ fontSize: "0.7rem", opacity: 0.5 }}>
                  No projects mapped yet.
                </span>
              )}
              {projects.map((project) => (
                <div
                  key={project.name}
                  className="number-tag"
                  style={{
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "0.2rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <Folder size={12} style={{ opacity: 0.7 }} />
                      <span style={{ fontWeight: 600 }}>{project.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(project.name)}
                      title={`Remove ${project.name}`}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        padding: 0,
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      opacity: 0.6,
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                    }}
                  >
                    {project.path}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .projects-count-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 1.4rem;
          height: 1.4rem;
          padding: 0 0.42rem;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 0.68rem;
          font-weight: 700;
          line-height: 1;
        }
        .projects-settings-shell {
          gap: 0.65rem;
          padding-top: 0.35rem;
        }
        .animate-fade-in {
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}
