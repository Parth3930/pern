import { useState, useEffect } from "react";
import { api, AppConfig, ModelInfo } from "../lib/api";
import { FolderOpen, ChevronRight, ChevronDown, Loader2, Cpu, Trash2, Download, Mic, CheckSquare, Image as ImageIcon } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

import WhatsAppSettings from "../integrations/whatsapp/Settings";
import EmailSettings from "../integrations/email/Settings";
import DiscordSettings from "../integrations/discord/Settings";
import CLIAgentSettings from "../integrations/cli_agents/Settings";
import ProjectsSettings from "../integrations/projects/Settings";
import MemorySettings from "../integrations/memory/Settings";
import SkillsAndLearningSection from "../integrations/SkillsAndLearningPanel";
import TodoPanel from "./TodoPanel";
import MinecraftSettings from "../integrations/minecraft/Settings";


interface Props {
  config: AppConfig;
  onClose: () => void;
  onSaved: () => void;
}

export default function SettingsPanel({ config, onClose, onSaved }: Props) {
  const [isWindows, setIsWindows] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [showTodosOverlay, setShowTodosOverlay] = useState(false);

  const [bgRemovalEnabled, setBgRemovalEnabled] = useState(() => {
    const val = localStorage.getItem("pern_bg_removal_enabled");
    return val === null ? false : val === "true";
  });
  const [imageExpanded, setImageExpanded] = useState(false);
  const bgModelDownloaded = localStorage.getItem("pern_bg_model_downloaded") === "true";

  const [modelDir, setModelDir] = useState(config.model_dir);
  const [smtpHost, setSmtpHost] = useState(config.email_smtp_host);
  const [smtpPort, setSmtpPort] = useState(config.email_smtp_port);
  const [senderEmail, setSenderEmail] = useState(config.email_sender_email);
  const [smtpPassword, setSmtpPassword] = useState(config.email_smtp_password);

  const [discordToken, setDiscordToken] = useState(config.discord_token || "");
  const [discordEnabled, setDiscordEnabled] = useState(config.discord_enabled || false);
  const [discordStatus, setDiscordStatus] = useState(config.discord_status || "online");
  const [discordActivity, setDiscordActivity] = useState(config.discord_activity || "");
  const [discordOwnerId, setDiscordOwnerId] = useState(config.discord_owner_id || "");
  const [discordBehaviourChannelId, setDiscordBehaviourChannelId] = useState(config.discord_behaviour_channel_id || "");

  const [ttsEnabled, setTtsEnabled] = useState(() => {
    const val = localStorage.getItem("pern_tts_enabled");
    return val === null ? true : val === "true";
  });
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => {
    const val = localStorage.getItem("pern_wakeword_enabled");
    return val === null ? false : val === "true";
  });
  const [voiceExpanded, setVoiceExpanded] = useState(false);
  const [wakeWordKeyword, setWakeWordKeyword] = useState(() => {
    return localStorage.getItem("pern_wakeword_keyword") || "both";
  });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState(() => {
    return localStorage.getItem("pern_tts_voice") || "";
  });

  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const updateVoices = () => {
        setVoices(window.speechSynthesis.getVoices());
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  const [saving, setSaving] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairProgress, setRepairProgress] = useState(0);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [installedFiles, setInstalledFiles] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(config.selected_model);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, { completed: number; total: number; status: string }>>({});
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [modelsExpanded, setModelsExpanded] = useState(false);

  useEffect(() => {
    let unlistenInstall: any;

    const setupListeners = async () => {
      try {
        await api.checkLlamaInstalled();
      } catch (e) {
        console.error("Failed to check Llama installation status", e);
      }

      unlistenInstall = await api.onLlamaInstallProgress((progress) => {
        if (progress.progress !== undefined) {
          setRepairProgress(progress.progress);
        }
        if (progress.stage === "complete") {
          setRepairing(false);
        }
      });
    };

    setupListeners();
    return () => {
      if (unlistenInstall) unlistenInstall();
    };
  }, []);

  useEffect(() => {
    api.listAvailableModels().then(setModels).catch(console.error);
    api.listInstalledModels().then(setInstalledFiles).catch(console.error);
  }, []);

  useEffect(() => {
    api.getPlatformInfo()
      .then((info) => {
        const win = info.os === "windows";
        setIsWindows(win);
        if (win) {
          api.getAutostart().then(setAutostartEnabled).catch(console.error);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubProgress: any;
    let unsubComplete: any;

    const setup = async () => {
      unsubProgress = await api.onDownloadProgress((p) => {
        if (!active) return;
        if (downloadingModelId) {
          setDownloadProgress((prev) => ({
            ...prev,
            [downloadingModelId]: {
              completed: p.completed || 0,
              total: p.total || 100,
              status: p.status || "Downloading...",
            },
          }));
        }
      });

      unsubComplete = await api.onDownloadComplete((modelId) => {
        if (!active) return;
        api.listInstalledModels().then(setInstalledFiles).catch(console.error);
        setDownloadingModelId(null);
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
      });
    };

    setup();
    return () => {
      active = false;
      if (unsubProgress) unsubProgress();
      if (unsubComplete) unsubComplete();
    };
  }, [downloadingModelId]);

  const handleSelectModel = async (modelId: string) => {
    setSelectedModel(modelId);
    try {
      await api.chooseModel(modelId);
    } catch (e) {
      console.error("Failed to select model", e);
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    setDownloadingModelId(modelId);
    setDownloadProgress((prev) => ({
      ...prev,
      [modelId]: { completed: 0, total: 100, status: "Starting download..." },
    }));
    try {
      await api.downloadModel(modelId);
    } catch (e) {
      console.error("Failed to download model", e);
      alert(`Download failed: ${e}`);
      setDownloadingModelId(null);
    }
  };

  const handleDeleteModel = async (modelId: string, displayName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete the model "${displayName}"? This will delete the files from your storage directory and free up space.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteModel(modelId);
      const installed = await api.listInstalledModels();
      setInstalledFiles(installed);
      if (selectedModel === modelId) {
        const defaultModel = models.find((m) => m.default)?.id || "qwen-2.5-1.5b-it-q4";
        setSelectedModel(defaultModel);
        await api.chooseModel(defaultModel);
      }
      alert(`Model "${displayName}" deleted successfully.`);
    } catch (e) {
      console.error("Failed to delete model", e);
      alert(`Failed to delete model: ${e}`);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: modelDir,
      });
      if (selected && typeof selected === "string") {
        setModelDir(selected);
      }
    } catch (e) {
      console.error("Failed to open dialog", e);
    }
  };

  const handleRepairEngine = async () => {
    if (repairing) return;
    if (
      !confirm(
        "Are you sure you want to repair/reinstall the local AI engine? This will download the latest server files from GitHub.",
      )
    )
      return;
    setRepairing(true);
    setRepairProgress(0);
    try {
      await api.installLlamaServer(true); // force = true
      alert("AI Engine repaired successfully!");
    } catch (e) {
      console.error("Repair failed", e);
      alert(`Repair failed: ${e}`);
    } finally {
      setRepairing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      localStorage.setItem("pern_tts_enabled", String(ttsEnabled));
      localStorage.setItem("pern_wakeword_enabled", String(wakeWordEnabled));
      localStorage.setItem("pern_wakeword_keyword", wakeWordKeyword);
      localStorage.setItem("pern_tts_voice", selectedVoice);
      localStorage.setItem("pern_bg_removal_enabled", String(bgRemovalEnabled));

      await api.chooseModelDir(modelDir);
      await api.saveEmailConfig(smtpHost, smtpPort, senderEmail, smtpPassword);
      await api.toggleDiscord(discordEnabled, discordToken, discordStatus, discordActivity, discordOwnerId, discordBehaviourChannelId);
      if (isWindows) {
        await api.setAutostart(autostartEnabled);
      }
      onSaved();
    } catch (e) {
      console.error("Failed to save settings", e);
    } finally {
      setSaving(false);
    }
  };

  const renderMainContent = () => {
    return (
      <>
        <section className="settings-section" style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1.25rem", marginBottom: "0.5rem" }}>
          <div className="settings-item">
            <label className="settings-label" style={{ fontWeight: 600 }}>Model Directory</label>
            <div className="minimal-path-input">
              <input
                type="text"
                className="minimal-input"
                value={modelDir}
                onChange={(e) => setModelDir(e.target.value)}
                placeholder="C:\Users\..."
              />
              <button type="button" className="icon-only-btn" onClick={handleSelectFolder} title="Browse folder">
                <FolderOpen size={16} />
              </button>
            </div>
          </div>

          {isWindows && (
            <div className="settings-item" style={{ marginTop: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                  <label className="settings-label" style={{ margin: 0, fontWeight: 600 }}>Start on Windows Open</label>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                    Automatically start Pern when you log into Windows
                  </span>
                </div>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    checked={autostartEnabled}
                    onChange={(e) => setAutostartEnabled(e.target.checked)}
                  />
                  <span className="settings-slider"></span>
                </label>
              </div>
            </div>
          )}

        </section>
        <WhatsAppSettings config={config} />

        <MinecraftSettings />

        <EmailSettings
          smtpHost={smtpHost}
          setSmtpHost={setSmtpHost}
          smtpPort={smtpPort}
          setSmtpPort={setSmtpPort}
          senderEmail={senderEmail}
          setSenderEmail={setSenderEmail}
          smtpPassword={smtpPassword}
          setSmtpPassword={setSmtpPassword}
        />

        <DiscordSettings
          discordToken={discordToken}
          setDiscordToken={setDiscordToken}
          discordEnabled={discordEnabled}
          setDiscordEnabled={setDiscordEnabled}
          discordStatus={discordStatus}
          setDiscordStatus={setDiscordStatus}
          discordActivity={discordActivity}
          setDiscordActivity={setDiscordActivity}
          discordOwnerId={discordOwnerId}
          setDiscordOwnerId={setDiscordOwnerId}
          discordBehaviourChannelId={discordBehaviourChannelId}
          setDiscordBehaviourChannelId={setDiscordBehaviourChannelId}
        />

        <SkillsAndLearningSection />

        <CLIAgentSettings />

        <ProjectsSettings />

        <MemorySettings />

        <section className="settings-section collapsible" style={{ marginTop: "0.5rem" }}>
          <div
            className="section-header clickable"
            onClick={() => setShowTodosOverlay(true)}
            style={{ cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <CheckSquare size={14} />
              <span>Todos & Reminders</span>
            </div>
            <ChevronRight size={14} />
          </div>
        </section>

        <section className="settings-section collapsible" style={{ marginTop: "0.5rem" }}>
          <div
            className={`section-header clickable ${voiceExpanded ? "active" : ""}`}
            onClick={() => setVoiceExpanded(!voiceExpanded)}
            style={{ cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <Mic size={14} />
              <span>Voice Access Settings</span>
            </div>
            {voiceExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>

          {voiceExpanded && (
            <div className="settings-list animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className="settings-item">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                    <label className="settings-label" style={{ margin: 0 }}>Wake Word Detection</label>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Listen continuously in the background to activate voice mode</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={wakeWordEnabled}
                      onChange={(e) => setWakeWordEnabled(e.target.checked)}
                    />
                    <span className="settings-slider"></span>
                  </label>
                </div>
              </div>

              {wakeWordEnabled && (
                <div className="settings-item animate-fade-in" style={{ paddingLeft: "0.5rem" }}>
                  <label className="settings-label">Wake Word Keyword</label>
                  <select
                    className="minimal-input"
                    value={wakeWordKeyword}
                    onChange={(e) => setWakeWordKeyword(e.target.value)}
                    style={{ background: "var(--bg-secondary)", color: "var(--text)" }}
                  >
                    <option value="both">Both ("Pern" or "Agent")</option>
                    <option value="pern">"Pern" only</option>
                    <option value="agent">"Agent" only</option>
                  </select>
                </div>
              )}

              <div className="settings-item">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                    <label className="settings-label" style={{ margin: 0 }}>Speak Responses</label>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Read the assistant responses aloud using text-to-speech</span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={ttsEnabled}
                      onChange={(e) => setTtsEnabled(e.target.checked)}
                    />
                    <span className="settings-slider"></span>
                  </label>
                </div>
              </div>

              {ttsEnabled && (
                <div className="settings-item animate-fade-in" style={{ paddingLeft: "0.5rem" }}>
                  <label className="settings-label">Text-to-Speech Voice</label>
                  <select
                    className="minimal-input"
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    style={{ background: "var(--bg-secondary)", color: "var(--text)" }}
                  >
                    <option value="">Default Friendly Voice</option>
                    {voices.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="settings-section collapsible" style={{ marginTop: "0.5rem" }}>
          <div
            className={`section-header clickable ${imageExpanded ? "active" : ""}`}
            onClick={() => setImageExpanded(!imageExpanded)}
            style={{ cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <ImageIcon size={14} />
              <span>Image Processing</span>
            </div>
            {imageExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>

          {imageExpanded && (
            <div className="settings-list animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className="settings-item">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                    <label className="settings-label" style={{ margin: 0 }}>Background Removal</label>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                      Locally remove image backgrounds
                    </span>
                    <span style={{ fontSize: "0.7rem", color: bgModelDownloaded ? "var(--success, #10b981)" : "var(--text-secondary)", marginTop: "4px" }}>
                      Model Status: {bgModelDownloaded ? "Downloaded" : "Not Downloaded (Will download ~40MB on first use)"}
                    </span>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={bgRemovalEnabled}
                      onChange={(e) => setBgRemovalEnabled(e.target.checked)}
                    />
                    <span className="settings-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="settings-section collapsible" style={{ marginTop: "0.5rem" }}>
          <div
            className={`section-header clickable ${modelsExpanded ? "active" : ""}`}
            onClick={() => setModelsExpanded(!modelsExpanded)}
            style={{ cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <Cpu size={14} />
              <span>Local AI Models</span>
            </div>
            {modelsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>

          {modelsExpanded && (
            <div className="settings-list animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className="model-settings-list" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {models.map((m) => {
                  const isDownloaded = installedFiles.includes(m.file_name);
                  const isActive = selectedModel === m.id;
                  const isDownloading = downloadingModelId === m.id;
                  const progress = downloadProgress[m.id];

                  return (
                    <div
                      key={m.id}
                      className={`settings-model-card ${isActive ? "active" : ""}`}
                      style={{
                        border: isActive ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "10px",
                        padding: "0.75rem 1rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                        cursor: isDownloaded && !isActive ? "pointer" : "default",
                        transition: "all 0.2s ease",
                        boxShadow: isActive ? "0 4px 12px rgba(99, 102, 241, 0.12)" : "none",
                      }}
                      onClick={() => {
                        if (isDownloaded && !isActive) {
                          handleSelectModel(m.id);
                        }
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>{m.display_name}</span>
                            {m.tier === "recommended" && (
                              <span className="badge recommended" style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem" }}>Recommended</span>
                            )}
                            {isDownloaded && isActive && (
                              <span className="badge" style={{ backgroundColor: "rgba(52, 211, 153, 0.15)", color: "#34d399", border: "1px solid rgba(52, 211, 153, 0.3)", fontSize: "0.6rem", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>
                                Active
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{m.recommended_for}</span>
                        </div>
                        
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                          {isDownloaded ? (
                            <>
                              {!isActive && (
                                <button
                                  className="minimal-btn"
                                  style={{ fontSize: "0.7rem", padding: "0.2rem 0.6rem", borderRadius: "4px" }}
                                  onClick={() => handleSelectModel(m.id)}
                                >
                                  Use Model
                                </button>
                              )}
                              <button
                                className="icon-only-btn"
                                style={{ color: "#ef4444", padding: "0.3rem", borderRadius: "6px" }}
                                onClick={() => handleDeleteModel(m.id, m.display_name)}
                                title="Delete model files"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          ) : isDownloading ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              <Loader2 size={12} className="animate-spin" style={{ color: "var(--accent)" }} />
                              <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                                {progress ? `${Math.round((progress.completed / progress.total) * 100)}%` : "0%"}
                              </span>
                            </div>
                          ) : (
                            <button
                              className="minimal-btn primary"
                              style={{ fontSize: "0.7rem", padding: "0.2rem 0.6rem", borderRadius: "4px", display: "flex", alignItems: "center", gap: "0.25rem" }}
                              onClick={() => handleDownloadModel(m.id)}
                            >
                              <Download size={12} /> Download
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.25rem", borderTop: "1px solid var(--border)", paddingTop: "0.4rem" }}>
                        <span>Size: {m.size_mb >= 1000 ? `${(m.size_mb / 1000).toFixed(1)} GB` : `${m.size_mb} MB`}</span>
                        <span>RAM: {m.recommended_ram_gb} GB</span>
                        <span>Memory: {m.estimated_memory}</span>
                      </div>

                      {isDownloading && progress && (
                        <div style={{ marginTop: "0.25rem" }}>
                          <div className="progress-bar-container" style={{ height: "4px", backgroundColor: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
                            <div
                              className="progress-bar-fill"
                              style={{
                                width: `${(progress.completed / progress.total) * 100}%`,
                                height: "100%",
                                backgroundColor: "var(--accent)",
                                transition: "width 0.2s ease",
                              }}
                            />
                          </div>
                          <span style={{ fontSize: "0.6rem", color: "var(--text-secondary)", marginTop: "2px", display: "block" }}>{progress.status}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <div
          className="settings-item"
          style={{
            marginTop: "0.5rem",
            borderTop: "1px solid var(--border)",
            paddingTop: "1rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}
            >
              <span
                className="settings-label"
                style={{ margin: 0, fontWeight: 600 }}
              >
                AI Engine
              </span>
            </div>
            {repairing ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <Loader2 size={12} className="animate-spin" />
                <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>
                  {repairProgress}%
                </span>
              </div>
            ) : (
              <button
                className="minimal-btn primary"
                style={{
                  fontSize: "0.75rem",
                  padding: "0.3rem 1rem",
                  borderRadius: "4px",
                }}
                onClick={handleRepairEngine}
              >
                Repair
              </button>
            )}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-header">
          <div className="settings-title-area">
            <button className="back-btn" onClick={onClose}>
              <ChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
            </button>
            <h2 className="settings-title">Settings</h2>
          </div>
        </div>



        <div className="settings-content">
          <h3 className="features-title">Pern Features</h3>

          {renderMainContent()}
        </div>

        <div className="settings-footer">
          <button className="minimal-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="minimal-btn primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      {showTodosOverlay && (
        <TodoPanel onClose={() => setShowTodosOverlay(false)} />
      )}
    </div>
  );
}
