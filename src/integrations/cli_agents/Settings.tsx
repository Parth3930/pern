import { useState, useEffect } from "react";
import { api, AgentStateInfo } from "../../lib/api";
import { ChevronDown, ChevronRight, Terminal, RefreshCw, Circle } from "lucide-react";

export default function CLIAgentSettings() {
  const [agents, setAgents] = useState<AgentStateInfo[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const states = await api.getCLIAgentsStatus();
      setAgents(states);
    } catch (e) {
      console.error("[CLI_AGENTS] Failed to load status:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isExpanded) {
      loadAgents();
    }
  }, [isExpanded]);

  const handleToggle = async (agent: AgentStateInfo) => {
    setSavingId(agent.name);
    try {
      await api.configureCLIAgent(agent.name, !agent.enabled, agent.binary_path);
      setAgents((prev) =>
        prev.map((a) =>
          a.name === agent.name ? { ...a, enabled: !a.enabled } : a,
        ),
      );
    } catch (e) {
      console.error("[CLI_AGENTS] Failed to toggle:", e);
    } finally {
      setSavingId(null);
    }
  };

  const handleBinaryPathChange = async (agent: AgentStateInfo, binaryPath: string) => {
    setSavingId(agent.name);
    try {
      await api.configureCLIAgent(agent.name, agent.enabled, binaryPath);
      setAgents((prev) =>
        prev.map((a) =>
          a.name === agent.name ? { ...a, binary_path: binaryPath } : a,
        ),
      );
    } catch (e) {
      console.error("[CLI_AGENTS] Failed to update path:", e);
    } finally {
      setSavingId(null);
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case "running":
        return { color: "#22c55e", pulse: true };
      case "completed":
        return { color: "#22c55e", pulse: false };
      case "failed":
        return { color: "#ef4444", pulse: false };
      case "not_found":
        return { color: "#f59e0b", pulse: false };
      default:
        return { color: "#6b7280", pulse: false };
    }
  };

  return (
    <section className="settings-section collapsible">
      <div
        className={`section-header clickable ${isExpanded ? "active" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <Terminal size={14} />
          <span>CLI Agents</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {isExpanded && (
            <button
              className="icon-only-btn"
              onClick={(e) => {
                e.stopPropagation();
                loadAgents();
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
        <div className="settings-list animate-fade-in" style={{ paddingTop: "0.25rem" }}>
          {agents.length === 0 && !loading && (
            <div className="empty-state" style={{ padding: "0.75rem 0" }}>
              <p style={{ fontSize: "0.75rem", opacity: 0.6 }}>No agents configured.</p>
            </div>
          )}

          {loading && agents.length === 0 && (
            <div className="empty-state" style={{ padding: "0.75rem 0" }}>
              <p style={{ fontSize: "0.75rem", opacity: 0.6 }}>Loading...</p>
            </div>
          )}

          <div className="agent-list" style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {agents.map((agent) => {
              const dot = getStatusDot(agent.status);
              return (
                <div
                  key={agent.name}
                  className="settings-item"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.4rem",
                    padding: "0.5rem 0.6rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border, #2a2a2a)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <Circle
                          size={10}
                          fill={dot.color}
                          color={dot.color}
                          style={{
                            opacity: 0.9,
                            animation: dot.pulse ? "pulse 2s infinite" : undefined,
                          }}
                        />
                      </div>
                      <span style={{ fontWeight: 600, fontSize: "0.8rem" }}>
                        {agent.display_name}
                      </span>
                      <span
                        style={{
                          fontSize: "0.65rem",
                          opacity: 0.6,
                          fontFamily: "monospace",
                          background: "var(--bg-secondary, #1a1a1a)",
                          padding: "1px 5px",
                          borderRadius: "3px",
                        }}
                      >
                        {agent.status}
                      </span>
                    </div>
                    <label className="toggle-switch" style={{ transform: "scale(0.8)" }}>
                      <input
                        type="checkbox"
                        checked={agent.enabled}
                        onChange={() => handleToggle(agent)}
                        disabled={savingId === agent.name}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ fontSize: "0.7rem", opacity: 0.6, minWidth: "4rem" }}>
                      Binary:
                    </span>
                    <input
                      type="text"
                      className="minimal-input"
                      defaultValue={agent.binary_path}
                      onBlur={(e) => {
                        if (e.target.value !== agent.binary_path) {
                          handleBinaryPathChange(agent, e.target.value);
                        }
                      }}
                      placeholder="e.g., claude"
                      style={{
                        flex: 1,
                        fontSize: "0.7rem",
                        padding: "2px 6px",
                        fontFamily: "monospace",
                      }}
                    />
                    {!agent.binary_found && (
                      <span
                        style={{
                          fontSize: "0.65rem",
                          color: "#f59e0b",
                          whiteSpace: "nowrap",
                        }}
                        title="Binary not found on PATH"
                      >
                        ⚠️
                      </span>
                    )}
                  </div>

                  {agent.current_task && (
                    <div style={{ fontSize: "0.7rem", opacity: 0.7, padding: "0.25rem 0" }}>
                      <span style={{ opacity: 0.5 }}>Task: </span>
                      {agent.current_task.length > 80
                        ? agent.current_task.slice(0, 77) + "..."
                        : agent.current_task}
                    </div>
                  )}

                  {agent.last_output &&
                    (agent.status === "completed" || agent.status === "failed") && (
                    <details style={{ fontSize: "0.68rem" }}>
                      <summary style={{ opacity: 0.5, cursor: "pointer" }}>
                        {agent.status === "failed" ? "Last error" : "Last output"}
                      </summary>
                      <pre
                        style={{
                          marginTop: "0.3rem",
                          padding: "0.4rem",
                          background: "var(--bg-secondary, #111)",
                          borderRadius: "4px",
                          maxHeight: "100px",
                          overflow: "auto",
                          fontSize: "0.65rem",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}
                      >
                        {agent.last_output.slice(0, 500)}
                        {agent.last_output.length > 500 ? "..." : ""}
                      </pre>
                    </details>
                    )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 36px;
          height: 20px;
        }
        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #333;
          transition: 0.3s;
          border-radius: 20px;
        }
        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 14px;
          width: 14px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        .toggle-switch input:checked + .toggle-slider {
          background-color: #22c55e;
        }
        .toggle-switch input:checked + .toggle-slider:before {
          transform: translateX(16px);
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
