import { useState, useEffect } from "react";
import "./App.css";
import { api, AppConfig } from "./lib/api";
import Onboarding from "./screens/Onboarding";
import Chat from "./screens/Chat";
import SettingsPanel from "./screens/SettingsPanel";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Settings, Terminal } from "lucide-react";

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [platform, setPlatform] = useState<string>("desktop");
  const [logs, setLogs] = useState<
    { time: string; type: string; message: string }[]
  >([]);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    api
      .getPlatformInfo()
      .then((info) => {
        const os = info.os.toLowerCase();
        setPlatform(os);
        if (os === "android") {
          api.requestAndroidNotificationPermission().catch(console.error);
        }
      })
      .catch(() => {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes("android")) {
          setPlatform("android");
          api.requestAndroidNotificationPermission().catch(console.error);
        } else if (ua.includes("iphone") || ua.includes("ipad"))
          setPlatform("ios");
      });

    async function loadState() {
      try {
        const state = await api.getOnboardingState();
        setConfig(state);
        // If first run is "completed" but llama-server is not installed,
        // force back to onboarding so they can install the AI engine
        if (state.first_run_completed) {
          try {
            const installed = await api.checkLlamaInstalled();
            if (!installed) {
              // Reset first_run_completed to force onboarding
              await api.setFirstRunCompleted(false);
              state.first_run_completed = false;
              setConfig({ ...state });
            }
          } catch {
            // If check fails, don't block
          }
        }
      } catch (e) {
        console.error("Failed to load onboarding state", e);
      } finally {
        setLoading(false);
      }
    }
    loadState();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const handleResize = () => {
      const vh = window.visualViewport
        ? window.visualViewport.height
        : window.innerHeight;
      document.documentElement.style.setProperty(
        "--visual-viewport-height",
        `${vh}px`,
      );
    };

    window.visualViewport.addEventListener("resize", handleResize);
    window.visualViewport.addEventListener("scroll", handleResize);
    handleResize(); // Run once initially

    return () => {
      window.visualViewport?.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("scroll", handleResize);
    };
  }, []);

  useEffect(() => {
    const addLog = (type: string, message: string) => {
      const time = new Date().toLocaleTimeString();
      setLogs((prev) => [...prev.slice(-149), { time, type, message }]);
    };

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
      originalLog.apply(console, args);
      addLog(
        "log",
        args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" "),
      );
    };
    console.warn = (...args) => {
      originalWarn.apply(console, args);
      addLog(
        "warn",
        args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" "),
      );
    };
    console.error = (...args) => {
      originalError.apply(console, args);
      addLog(
        "error",
        args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" "),
      );
    };

    let active = true;
    let unsub: (() => void) | undefined;
    const setup = async () => {
      unsub = await api.onAppLog((log) => {
        if (!active) return;
        addLog(log.level, `[BACKEND] ${log.message}`);
      });
    };
    setup();

    return () => {
      active = false;
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      if (unsub) unsub();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unsubContacts: (() => void) | undefined;

    const setupContactsListener = async () => {
      try {
        unsubContacts = await api.onWhatsAppContactsUpdated(() => {
          if (active) {
            refreshConfig();
          }
        });
      } catch (e) {
        console.error("Failed to subscribe to whatsapp-contacts-updated", e);
      }
    };
    setupContactsListener();

    return () => {
      active = false;
      if (unsubContacts) unsubContacts();
    };
  }, []);

  const refreshConfig = async () => {
    const updated = await api.getOnboardingState();
    setConfig(updated);
  };

  const handleOnboardingComplete = async () => {
    await api.setFirstRunCompleted(true);
    await refreshConfig();
  };

  const handleMinimize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const window = getCurrentWindow();
    await window.hide();
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const window = getCurrentWindow();
    await window.close();
  };

  if (loading) {
    return (
      <div
        className="loading-screen"
        style={{
          borderRadius:
            platform === "android" || platform === "ios" ? "0" : "24px",
          border:
            platform === "android" || platform === "ios"
              ? "none"
              : "1px solid var(--border)",
        }}
      >
        <div
          className="thinking-dot"
          style={{
            width: "12px",
            height: "12px",
            backgroundColor: "var(--accent)",
          }}
        ></div>
        <div
          style={{
            fontWeight: 500,
            fontSize: "0.9rem",
            color: "var(--text-secondary)",
          }}
        >
          Initializing pern...
        </div>
      </div>
    );
  }

  return (
    <div
      className={`app-container ${platform === "android" || platform === "ios" ? "mobile" : "desktop"}`}
    >
      <div className="title-bar">
        <div className="title-bar-drag" data-tauri-drag-region></div>
        <div className="title-bar-content">
          <span className="title-bar-title">Pern</span>
        </div>

        <div className="title-bar-actions">
          <button
            className="action-btn logs-btn"
            onClick={() => setShowLogs(!showLogs)}
            title="Show Debug Logs"
            style={{ color: showLogs ? "var(--accent)" : "inherit" }}
          >
            <Terminal size={14} />
          </button>
          <button
            className="action-btn settings-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <Settings size={14} />
          </button>
          <button
            className="action-btn minimize-btn"
            onClick={handleMinimize}
            title="Minimize"
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="none">
              <rect width="10" height="1" fill="currentColor" />
            </svg>
          </button>
          <button
            className="action-btn close-btn close"
            onClick={handleClose}
            title="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M1 1L9 9M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
        </div>
      </div>

      {showSettings && config && (
        <SettingsPanel
          config={config}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            refreshConfig();
            setShowSettings(false);
          }}
        />
      )}

      {config?.first_run_completed ? (
        <Chat config={config} onConfigUpdate={refreshConfig} />
      ) : (
        <Onboarding config={config} onComplete={handleOnboardingComplete} />
      )}

      {showLogs && (
        <div className="debug-logs-overlay">
          <div className="debug-logs-header">
            <h3>Debug Logs</h3>
            <div className="debug-logs-actions">
              <button
                onClick={() => {
                  const text = logs
                    .map(
                      (l) =>
                        `[${l.time}] [${l.type.toUpperCase()}] ${l.message}`,
                    )
                    .join("\n");
                  navigator.clipboard.writeText(text);
                  alert("Logs copied to clipboard!");
                }}
              >
                Copy
              </button>
              <button onClick={() => setLogs([])}>Clear</button>
              <button onClick={() => setShowLogs(false)}>Close</button>
            </div>
          </div>
          <div className="debug-logs-content">
            {logs.length === 0 ? (
              <div className="debug-log-empty">No logs captured yet.</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} className={`debug-log-line ${l.type}`}>
                  <span className="log-time">[{l.time}]</span>
                  <span className="log-type">[{l.type.toUpperCase()}]</span>
                  <span className="log-msg">{l.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
