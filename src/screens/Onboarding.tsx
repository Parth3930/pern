import { useState, useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { api, AppConfig, LlamaInstallProgress } from "../lib/api";
import {
  ChevronRight,
  Download,
  FolderOpen,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import pernLogo from "../assets/logo.png";
import thinking3 from "../assets/thinking/thinking_3.png";
import executing5 from "../assets/executing/executing_5.png";
import executing6 from "../assets/executing/executing_6.png";
import { MonitorSmartphone } from "lucide-react";

interface Props {
  config: AppConfig | null;
  onComplete: () => void;
}

interface LogLine {
  level: string;
  message: string;
}

export default function Onboarding({ config, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [selectedModel, setSelectedModel] = useState<string>(
    config?.selected_model || "qwen-1.5-1.8b-chat-q4",
  );
  const [modelDir, setModelDir] = useState<string>(config?.model_dir || "");

  // AI Engine setup state
  const [llamaInstalled, setLlamaInstalled] = useState<boolean | null>(null);
  const [llamaInstalling, setLlamaInstalling] = useState(false);
  const [llamaInstallProgress, setLlamaInstallProgress] = useState<LlamaInstallProgress | null>(null);
  const [llamaInstallError, setLlamaInstallError] = useState<string | null>(null);
  const [platformInfo, setPlatformInfo] = useState<{ os: string; arch: string } | null>(null);

  const [logs, setLogs] = useState<LogLine[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.fromTo(
        ".onboarding-card",
        { opacity: 0, y: 15 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }
      );
    },
    { dependencies: [step], scope: containerRef }
  );

  useEffect(() => {
    api.getPlatformInfo().then(setPlatformInfo).catch(console.error);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubProgress: (() => void) | undefined;
    let unsubLogs: (() => void) | undefined;
    let unsubLlamaInstall: (() => void) | undefined;

    const setup = async () => {


      const u2 = await api.onAppLog((log) => {
        if (!active) return;
        setLogs((prev) => [...prev.slice(-99), log]);
      });
      if (!active) {
        u2();
      } else {
        unsubLogs = u2;
      }

      const u3 = await api.onLlamaInstallProgress((p) => {
        if (!active) return;
        setLlamaInstallProgress(p);
        if (p.stage === "complete") {
          setLlamaInstalled(true);
          setLlamaInstalling(false);
        }
      });
      if (!active) {
        u3();
      } else {
        unsubLlamaInstall = u3;
      }
    };
    setup();

    return () => {
      active = false;
      if (unsubProgress) unsubProgress();
      if (unsubLogs) unsubLogs();
      if (unsubLlamaInstall) unsubLlamaInstall();
    };
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  // Check llama installation when reaching the AI engine step
  useEffect(() => {
    if (step === 3) {
      api.checkLlamaInstalled().then(setLlamaInstalled).catch(() => setLlamaInstalled(false));
    }
  }, [step]);

  const handleNext = () => {
    if (step === 0 && platformInfo?.os === "android") {
      setStep(0.5);
    } else if (step === 0.5) {
      setStep(1);
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleModelSelect = async (id: string) => {
    setSelectedModel(id);
    await api.chooseModel(id);
  };

  const handleDirChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setModelDir(val);
    await api.chooseModelDir(val);
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
        await api.chooseModelDir(selected);
      }
    } catch (e) {
      console.error("Failed to open dialog", e);
    }
  };


  const startLlamaInstall = async () => {
    setLlamaInstalling(true);
    setLlamaInstallError(null);
    setLlamaInstallProgress({ stage: "starting", message: "Starting installation..." });

    try {
      await api.installLlamaServer();
      // The onLlamaInstallProgress listener will set llamaInstalled = true
    } catch (e) {
      console.error("Llama install failed", e);
      const msg = typeof e === "string" ? e : "Installation failed. Check your internet connection.";
      setLlamaInstallError(msg);
      setLlamaInstalling(false);
    }
  };



  const getPlatformLabel = () => {
    if (!platformInfo) return "your device";
    const osNames: Record<string, string> = {
      windows: "Windows",
      android: "Android",
      macos: "macOS",
      linux: "Linux",
    };
    const archNames: Record<string, string> = {
      x64: "x64",
      arm64: "ARM64",
    };
    return `${osNames[platformInfo.os] || platformInfo.os} (${archNames[platformInfo.arch] || platformInfo.arch})`;
  };

  return (
    <div className="onboarding-container" ref={containerRef}>
      <div
        className="onboarding-content"
        style={{ width: "100%", height: "100%" }}
      >
        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="onboarding-card">
            <img
              src={pernLogo}
              alt="Pern Logo"
              style={{
                width: "80px",
                height: "80px",
                objectFit: "contain",
                borderRadius: "20px",
                marginBottom: "1.25rem",
                boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              }}
            />
            <h1 className="onboarding-title">Welcome to Pern</h1>
            <p className="onboarding-text">
              Your local, private AI assistant. Pern runs entirely on your
              device, ensuring your data never leaves your machine.
            </p>
            <div className="onboarding-footer">
              <button className="btn btn-primary" onClick={handleNext}>
                Get started <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 0.5: Android Recommendation */}
        {step === 0.5 && (
          <div className="onboarding-card">
            <MonitorSmartphone size={64} style={{ color: "var(--accent)", marginBottom: "1.25rem" }} />
            <h1 className="onboarding-title">Try Desktop For Best Experience</h1>
            <p className="onboarding-text" style={{ lineHeight: "1.6" }}>
              Pern runs offline AI models locally. While Android is supported, models may run slower and consume significant battery.
              <br/><br/>
              For the best developer experience, we highly recommend using the <strong>Windows/Desktop</strong> application. You can download it at <span onClick={() => openUrl("https://pern.iparthsharma.me")} style={{ color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}>pern.iparthsharma.me</span>.
            </p>
            <div className="onboarding-footer">
              <button className="btn" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={handleNext}>
                I understand <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Choose Model */}
        {step === 1 && (
          <div className="onboarding-card">
            <img
              src={thinking3}
              alt="Thinking"
              style={{
                width: "80px",
                height: "80px",
                objectFit: "contain",
                marginBottom: "1.25rem",
                borderRadius: "20px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              }}
            />
            <h1 className="onboarding-title">Bring your own model</h1>
            <p className="onboarding-text">Pern works with any GGUF formatted local model. Pick one to get started.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', alignItems: 'center', margin: '2rem 0' }}>
              {selectedModel && selectedModel !== "qwen-1.5-1.8b-chat-q4" ? (
                <div style={{ padding: '1rem', border: '1px solid var(--accent)', borderRadius: '8px', color: 'var(--accent)' }}>
                  Selected: {selectedModel}
                </div>
              ) : null}
              <button 
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const selected = await open({
                      multiple: false,
                      filters: [{ name: 'GGUF Model', extensions: ['gguf'] }]
                    });
                    if (selected && typeof selected === "string") {
                      const newModel = await api.importLocalModel(selected);
                      await handleModelSelect(newModel);
                    }
                  } catch (e) {
                    console.error("Import failed", e);
                  }
                }}
              >
                Import .gguf File
              </button>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>You can also do this later in Settings.</span>
            </div>

            <div className="onboarding-footer">
              <button className="btn" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={handleNext}>
                Continue <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Configure Storage */}
        {step === 2 && (
          <div className="onboarding-card">
            <img
              src={executing5}
              alt="Storage"
              style={{
                width: "80px",
                height: "80px",
                objectFit: "contain",
                marginBottom: "1.25rem",
                borderRadius: "20px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              }}
            />
            <h1 className="onboarding-title">Configure storage</h1>
            <p className="onboarding-text">
              Choose where Pern should store your local AI models.
            </p>

            <div className="input-group">
              <label className="input-label">Storage Path</label>
              <div className="path-input-container">
                <input
                  type="text"
                  className="text-input"
                  value={modelDir}
                  onChange={handleDirChange}
                />
                <button
                  className="btn"
                  onClick={handleSelectFolder}
                  title="Browse for folder"
                >
                  <FolderOpen size={18} />
                </button>
              </div>
            </div>

            <div className="onboarding-footer">
              <button className="btn" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={() => setStep(3)}>
                Continue <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Setup AI Engine (llama-server installation) */}
        {step === 3 && (
          <div className="onboarding-card">
            <img
              src={executing6}
              alt="AI Engine"
              style={{
                width: "80px",
                height: "80px",
                objectFit: "contain",
                marginBottom: "1.25rem",
                borderRadius: "20px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              }}
            />
            <h1 className="onboarding-title">Setup AI Engine</h1>
            <p className="onboarding-text" style={{ fontSize: "0.8rem" }}>
              Pern needs <strong>llama.cpp</strong> to run AI models locally on {getPlatformLabel()}.
              {llamaInstalled === null
                ? " Checking..."
                : llamaInstalled
                  ? " Already installed!"
                  : " We'll download and set it up automatically."}
            </p>

            {/* Already installed */}
            {llamaInstalled === true && !llamaInstalling && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "12px",
                background: "rgba(52, 211, 153, 0.1)",
                border: "1px solid rgba(52, 211, 153, 0.25)",
                marginBottom: "0.5rem",
                width: "100%",
              }}>
                <CheckCircle size={20} style={{ color: "#34d399", flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#34d399" }}>
                    AI Engine Ready
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                    llama-server is installed and configured
                  </div>
                  <button
                    onClick={startLlamaInstall}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent, #6366f1)",
                      textDecoration: "underline",
                      fontSize: "0.7rem",
                      cursor: "pointer",
                      padding: 0,
                      marginTop: "4px",
                      display: "block",
                    }}
                  >
                    Reinstall AI Engine
                  </button>
                </div>
              </div>
            )}

            {/* Not installed — show install button */}
            {llamaInstalled === false && !llamaInstalling && !llamaInstallError && (
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                width: "100%",
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem 1rem",
                  borderRadius: "12px",
                  background: "rgba(251, 191, 36, 0.08)",
                  border: "1px solid rgba(251, 191, 36, 0.2)",
                }}>
                  <AlertCircle size={18} style={{ color: "#fbbf24", flexShrink: 0 }} />
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    llama-server needs to be installed (~16 MB download)
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={startLlamaInstall}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  <Download size={16} /> Install AI Engine
                </button>
              </div>
            )}

            {/* Installing — show progress */}
            {llamaInstalling && llamaInstallProgress && (
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                width: "100%",
              }}>
                <div style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "12px",
                  background: "rgba(99, 102, 241, 0.08)",
                  border: "1px solid rgba(99, 102, 241, 0.2)",
                }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "0.5rem",
                  }}>
                    <div className="thinking-dot" style={{ width: "6px", height: "6px" }}></div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      {llamaInstallProgress.message}
                    </span>
                  </div>
                  {llamaInstallProgress.progress !== undefined && (
                    <div className="progress-bar-container" style={{ height: "4px" }}>
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${llamaInstallProgress.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error state */}
            {llamaInstallError && (
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                width: "100%",
              }}>
                <div style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "12px",
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  fontSize: "0.75rem",
                  color: "#ef4444",
                }}>
                  {llamaInstallError}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={startLlamaInstall}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  <Download size={16} /> Retry Installation
                </button>
              </div>
            )}

            <div className="onboarding-footer">
              <button className="btn" onClick={() => setStep(2)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep(4)}
                disabled={!llamaInstalled}
              >
                Continue <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Finish Setup */}
        {step === 4 && (
          <div className="onboarding-card">
            <h1 className="onboarding-title">Ready to Go!</h1>
            <p className="onboarding-text">
              Pern is set up and ready to use. 
              {selectedModel && selectedModel !== "qwen-1.5-1.8b-chat-q4" 
                ? ` Selected model: ${selectedModel}.`
                : " You can import a model later from Settings."}
            </p>

            <div className="onboarding-footer" style={{ marginTop: '2rem' }}>
              <button className="btn" onClick={() => setStep(3)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={onComplete}>
                Finish Setup <CheckCircle size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
