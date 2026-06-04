import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Loader2, Eye, EyeOff } from "lucide-react";
import { api } from "../../lib/api";
import { listen } from "@tauri-apps/api/event";

interface Props {
  discordToken: string;
  setDiscordToken: (v: string) => void;
  discordEnabled: boolean;
  setDiscordEnabled: (v: boolean) => void;
  discordStatus: string;
  setDiscordStatus: (v: string) => void;
  discordActivity: string;
  setDiscordActivity: (v: string) => void;
  discordOwnerId: string;
  setDiscordOwnerId: (v: string) => void;
  discordBehaviourChannelId: string;
  setDiscordBehaviourChannelId: (v: string) => void;
}

export default function DiscordSettings({
  discordToken,
  setDiscordToken,
  discordEnabled,
  setDiscordEnabled,
  discordStatus,
  setDiscordStatus,
  discordActivity,
  setDiscordActivity,
  discordOwnerId,
  setDiscordOwnerId,
  discordBehaviourChannelId,
  setDiscordBehaviourChannelId,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let unlistenStatus: any;
    let unlistenBotName: any;

    const setupListeners = async () => {
      try {
        const [status, botName] = await api.getDiscordStatus();
        if (status === "connected") {
          setTestResult(`Connected as ${botName || "bot"}`);
        } else if (status === "connecting") {
          setTestResult("Connecting...");
        } else {
          setTestResult(null);
        }
      } catch (e) {
        console.error("Failed to fetch Discord status", e);
      }

      unlistenStatus = await listen<string>("discord-status", (event) => {
        const status = event.payload;
        if (status === "connected") {
          // Will receive bot name shortly
        } else if (status === "connecting") {
          setTestResult("Connecting...");
        } else {
          setTestResult(null);
        }
      });

      unlistenBotName = await listen<string>("discord-bot-name", (event) => {
        setTestResult(`Connected as ${event.payload}`);
      });
    };

    setupListeners();

    return () => {
      if (unlistenStatus) unlistenStatus();
      if (unlistenBotName) unlistenBotName();
    };
  }, []);

  const handleTest = async (tokenToTest: string) => {
    const t = tokenToTest.trim();
    if (!t) {
      setTestResult("Error: Bot token is empty.");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const username = await api.discordTestToken(t);
      setTestResult(`Connected as ${username}`);
    } catch (e) {
      setTestResult(`Error: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="settings-section collapsible">
      <div
        className={`section-header clickable ${isExpanded ? "active" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 127.14 96.36"
            fill="currentColor"
            style={{ display: "inline-block", verticalAlign: "middle" }}
          >
            <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.22,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.5-5c.9-.65,1.76-1.34,2.58-2a75.46,75.46,0,0,0,73.08,0c.83.71,1.69,1.4,2.59,2a67.76,67.76,0,0,1-10.5,5,77.84,77.84,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129.89,49.38,123.82,26.54,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.9,46,53.9,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.14,46,96.14,53,91,65.69,84.69,65.69Z" />
          </svg>
          <span>Discord Bot</span>
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {isExpanded && (
        <div className="settings-list animate-fade-in">
          <div className="settings-item">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.25rem",
              }}
            >
              <label className="settings-label" style={{ margin: 0 }}>
                Enable Discord Bot Integration
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={discordEnabled}
                  onChange={(e) => setDiscordEnabled(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>

          <div className="settings-item">
            <label className="settings-label">Bot Token</label>
            <div style={{ position: "relative" }}>
              <input
                type={showToken ? "text" : "password"}
                className="minimal-input"
                style={{ paddingRight: "2.5rem" }}
                value={discordToken}
                onChange={(e) => setDiscordToken(e.target.value)}
                placeholder="MTAx..."
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                style={{
                  position: "absolute",
                  right: "0.75rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="settings-item">
            <label className="settings-label">Bot Online Status</label>
            <select
              className="minimal-input"
              value={discordStatus}
              onChange={(e) => setDiscordStatus(e.target.value)}
              style={{ background: "var(--bg-secondary)", color: "var(--text)" }}
            >
              <option value="online">Online</option>
              <option value="idle">Idle</option>
              <option value="dnd">Do Not Disturb</option>
              <option value="invisible">Invisible</option>
            </select>
          </div>

          <div className="settings-item">
            <label className="settings-label">Bot Activity (Playing...)</label>
            <input
              type="text"
              className="minimal-input"
              value={discordActivity}
              onChange={(e) => setDiscordActivity(e.target.value)}
              placeholder="e.g. with Pern AI"
            />
          </div>

          <div className="settings-item">
            <label className="settings-label">Owner ID / Username</label>
            <input
              type="text"
              className="minimal-input"
              value={discordOwnerId}
              onChange={(e) => setDiscordOwnerId(e.target.value)}
              placeholder="e.g. 123456789012345678 or owner_username"
            />
          </div>

          <div className="settings-item">
            <label className="settings-label">Behaviour Tracking Channel ID</label>
            <input
              type="text"
              className="minimal-input"
              value={discordBehaviourChannelId}
              onChange={(e) => setDiscordBehaviourChannelId(e.target.value)}
              placeholder="e.g. 10453982743"
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              marginTop: "1rem",
            }}
          >
            <button
              type="button"
              className="minimal-btn"
              style={{ width: "100%", fontSize: "0.75rem" }}
              onClick={() => handleTest(discordToken)}
              disabled={testing || !discordToken}
            >
              {testing ? "Testing Connection..." : "Test Connection"}
            </button>

            {testing && (
              <div className="auth-status">
                <Loader2 size={14} className="animate-spin" />
                <span>Checking bot status...</span>
              </div>
            )}

            {!testing && testResult && (
              <div
                className={`auth-status ${
                  testResult.startsWith("Connected") || testResult.startsWith("Connecting") ? "success" : "error"
                }`}
              >
                <span>
                  {testResult.startsWith("Connected") || testResult.startsWith("Connecting") ? "✓ " : "✗ "}
                  {testResult}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
