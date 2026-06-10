import React, { useRef, useEffect } from "react";
import { Send, Mic, MicOff } from "lucide-react";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  isGenerating: boolean;
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  onSend: () => void;
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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    setInput(textarea.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Reset textarea height when input becomes empty (e.g. after sending)
  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  return (
    <div className="chat-input-container">
      <div className="chat-input-wrapper">
        {isSupported && (
          <button
            type="button"
            className={`mic-btn ${isListening ? "active-listening" : ""}`}
            onClick={() => {
              if (isListening) {
                stopListening();
              } else {
                startListening();
              }
            }}
            title={isListening ? "Stop listening" : "Start voice command"}
            aria-label={
              isListening ? "Stop listening" : "Start voice command"
            }
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
          placeholder={
            isListening ? "Listening to command…" : "Ask a question..."
          }
          rows={1}
          style={{ height: "auto", minHeight: "24px" }}
        />
        <button
          type="button"
          className="send-btn"
          onClick={onSend}
          disabled={(!input.trim() && !isListening) || isGenerating}
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};
