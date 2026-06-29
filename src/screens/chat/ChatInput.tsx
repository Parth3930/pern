import React, { useRef, useEffect, useState } from "react";
import { Send, Mic, MicOff, Plus, X, Image as ImageIcon, Folder, PlusCircle, ChevronRight, ChevronLeft } from "lucide-react";
import { api, ProjectConfig } from "../../lib/api";
import { open } from "@tauri-apps/plugin-dialog";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  isGenerating: boolean;
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  onSend: (imageOpts?: any, overrideInput?: string, projectName?: string, displayContent?: string) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  input,
  setInput,
  isGenerating,
  isListening,
  isSupported,
  startListening,
  stopListening,
  onSend,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // ponytail: absolute positioned div instead of popover dependency
  const [showDropdown, setShowDropdown] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectConfig | null>(null);

  useEffect(() => {
    if (showDropdown) {
      api.listProjects().then(setProjects).catch(console.error);
    }
  }, [showDropdown]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.chat-plus-menu')) {
        setShowDropdown(false);
        setShowProjects(false);
      }
    };
    if (showDropdown) document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showDropdown]);

  const handleSelectProject = (project: ProjectConfig) => {
    setSelectedProject(project);
    setShowDropdown(false);
    setShowProjects(false);
    textareaRef.current?.focus();
  };

  const handleAddNewProject = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        const normalized = selected.replace(/[\\/]+$/, "");
        const segments = normalized.split(/[\\/]/).filter(Boolean);
        const derivedName = segments.length > 0 ? segments[segments.length - 1] : "New Project";
        await api.addProject(derivedName, selected);
        const updated = await api.listProjects();
        setProjects(updated);
        handleSelectProject({ name: derivedName, path: selected });
      }
    } catch (e) {
      console.error("Failed to add new project", e);
    }
  };

  const handleProcess = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (typeof ev.target?.result === "string") setImgUrl(ev.target.result);
      };
      reader.readAsDataURL(file);
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleLocalSend = () => {
    if (selectedFile && input.trim()) {
      const task = input.toLowerCase();
      const shouldRemoveBg = /(remove|strip|clear|delete|cut|drop|no).*(bg|back)/i.test(task);
      const shouldConvertPng = /(convert|change|make|turn|to|format).*(png)/i.test(task);
      const shouldUpscale = /(upscale|resize|enlarge|bigger|double)/i.test(task);
      const shouldCompress = /(compress|shrink|smaller|reduce)/i.test(task);
      
      const hasTask = shouldRemoveBg || shouldConvertPng || shouldUpscale || shouldCompress;
      const textOverride = selectedProject ? `fire pern in project ${selectedProject.name} to ${input}` : undefined;
      
      onSend({ 
        task: hasTask ? { removeBg: shouldRemoveBg, png: shouldConvertPng, upscale: shouldUpscale } : null, 
        file: selectedFile, 
        previewUrl: imgUrl 
      }, textOverride, selectedProject?.name, selectedProject ? input : undefined);
      
      setInput("");
      setSelectedFile(null);
      setImgUrl(null);
      return;
    }

    if (selectedProject && input.trim()) {
      onSend(undefined, `fire pern in project ${selectedProject.name} to ${input}`, selectedProject.name, input);
      setInput("");
      return;
    }

    onSend();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    setInput(textarea.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleLocalSend();
    }
  };

  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  return (
    <div className="chat-input-container">
      {imgUrl && (
        <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 12, background: "var(--bg-secondary)", borderRadius: "8px 8px 0 0", borderBottom: "1px solid var(--border)" }}>
          <img src={imgUrl} alt="preview" style={{ height: 40, borderRadius: 6 }} />
          <button onClick={() => { setImgUrl(null); setSelectedFile(null); }} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", marginLeft: "auto", display: "flex", alignItems: "center" }}>
            <X size={16} />
          </button>
        </div>
      )}
      {selectedProject && (
        <div style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: 8, background: "var(--bg-secondary)", borderRadius: imgUrl ? "0" : "8px 8px 0 0", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
          <Folder size={14} /> <span style={{ fontWeight: 500, color: "var(--text)" }}>{selectedProject.name}</span>
          <button onClick={() => setSelectedProject(null)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", marginLeft: "auto", display: "flex", alignItems: "center" }}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="chat-input-wrapper" style={{ borderRadius: imgUrl || selectedProject ? "0 0 8px 8px" : undefined }}>
        {isSupported && (
          <button
            type="button"
            className={`mic-btn ${isListening ? "active-listening" : ""}`}
            onClick={() => {
              if (isListening) stopListening();
              else startListening();
            }}
            title={isListening ? "Stop listening" : "Start voice command"}
            aria-label={isListening ? "Stop listening" : "Start voice command"}
          >
            {isListening ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
        )}
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? "Listening to command…" : "Ask a question..."}
          rows={1}
          style={{ height: "auto", minHeight: "24px" }}
        />
        
        <input type="file" ref={fileInput} onChange={handleProcess} style={{ display: "none" }} accept="image/*" />
        
        <div className="chat-plus-menu" style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => {
              setShowDropdown(!showDropdown);
              setShowProjects(false);
            }}
            style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Add Media or Project"
          >
            <Plus size={18} />
          </button>
          
          {showDropdown && (
            <div 
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: "calc(50% - 20px)",
                transform: "translateX(-50%)",
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "4px",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                minWidth: "160px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                zIndex: 10
              }}
            >
              {!showProjects ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      fileInput.current?.click();
                      setShowDropdown(false);
                    }}
                    style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "none", border: "none", color: "var(--text)", cursor: "pointer", borderRadius: "6px", textAlign: "left", width: "100%" }}
                    onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-tertiary)"}
                    onMouseOut={(e) => e.currentTarget.style.background = "none"}
                  >
                    <ImageIcon size={14} /> Image
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowProjects(true);
                    }}
                    style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "none", border: "none", color: "var(--text)", cursor: "pointer", borderRadius: "6px", textAlign: "left", width: "100%", justifyContent: "space-between" }}
                    onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-tertiary)"}
                    onMouseOut={(e) => e.currentTarget.style.background = "none"}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><Folder size={14} /> Project</div>
                    <ChevronRight size={14} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowProjects(false);
                    }}
                    style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", borderRadius: "6px", textAlign: "left", width: "100%", fontSize: "0.8rem" }}
                    onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-tertiary)"}
                    onMouseOut={(e) => e.currentTarget.style.background = "none"}
                  >
                    <ChevronLeft size={14} /> Back
                  </button>
                  <div style={{ height: "1px", background: "var(--border)", margin: "4px 0" }} />
                  {projects.length === 0 && (
                    <div style={{ padding: "8px 12px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>No projects added</div>
                  )}
                  {projects.map(p => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => handleSelectProject(p)}
                      style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "none", border: "none", color: "var(--text)", cursor: "pointer", borderRadius: "6px", textAlign: "left", width: "100%" }}
                      onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-tertiary)"}
                      onMouseOut={(e) => e.currentTarget.style.background = "none"}
                    >
                      <Folder size={14} /> {p.name}
                    </button>
                  ))}
                  <div style={{ height: "1px", background: "var(--border)", margin: "4px 0" }} />
                  <button
                    type="button"
                    onClick={handleAddNewProject}
                    style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "none", border: "none", color: "var(--accent)", cursor: "pointer", borderRadius: "6px", textAlign: "left", width: "100%" }}
                    onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-tertiary)"}
                    onMouseOut={(e) => e.currentTarget.style.background = "none"}
                  >
                    <PlusCircle size={14} /> Add New
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="send-btn"
          onClick={handleLocalSend}
          disabled={(!input.trim() && !isListening) || isGenerating}
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};
