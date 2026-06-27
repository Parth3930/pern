import React, { useRef, useEffect, useState } from "react";
import { Send, Mic, MicOff, Plus, Download, Loader2, X } from "lucide-react";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  isGenerating: boolean;
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  onSend: (imageOpts?: any) => void;
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
      
      onSend({ 
        task: hasTask ? { removeBg: shouldRemoveBg, png: shouldConvertPng, upscale: shouldUpscale } : null, 
        file: selectedFile, 
        previewUrl: imgUrl 
      });
      
      setInput("");
      setSelectedFile(null);
      setImgUrl(null);
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
          <button onClick={() => { setImgUrl(null); setSelectedFile(null); }} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", marginLeft: "auto" }}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="chat-input-wrapper" style={{ borderRadius: imgUrl ? "0 0 8px 8px" : undefined }}>
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
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}
          title="Process Image"
        >
          <Plus size={18} />
        </button>

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
