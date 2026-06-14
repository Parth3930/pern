import React from "react";
import logo from "../../assets/logo.png";
import { CheckCircle2, Database, Trash2 } from "lucide-react";
import { ChatMessage, MemoryToolResult } from "../../lib/api";
import { stripToolCalls } from "../chatLogic";

interface MessageListProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  currentTask: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const cleanUserMessageForDisplay = (content: string) => {
  if (content.includes("\n\nUser Request: ")) {
    const idx = content.lastIndexOf("\n\nUser Request: ");
    let userReq = content.slice(idx + 16);
    const planIdx = userReq.lastIndexOf("\nPlan:\n");
    if (planIdx !== -1) {
      userReq = userReq.slice(0, planIdx);
    } else {
      const planIdx2 = userReq.lastIndexOf("Plan:\n");
      if (planIdx2 !== -1) {
        userReq = userReq.slice(0, planIdx2);
      }
    }
    return userReq.trim();
  }

  if (
    content.startsWith("[Context:\n") ||
    content.startsWith("[Owner context:")
  ) {
    const idx = content.indexOf("]\n\n");
    if (idx !== -1) {
      return content.slice(idx + 3);
    }
  }
  return content;
};

const MemoryResultCard: React.FC<{ result: MemoryToolResult }> = ({ result }) => {
  if (result.kind === "remember") {
    return (
      <div
        className="memory-tool-pill memory-tool-pill--remember"
        role="status"
        title={`Saved to memory: ${result.key} = ${result.value}`}
      >
        <CheckCircle2 size={12} aria-hidden="true" />
        <span>
          Saved <code>{result.key}</code>
        </span>
        <span className="memory-tool-pill__category">{result.category}</span>
      </div>
    );
  }
  if (result.kind === "forget") {
    return (
      <div
        className="memory-tool-pill memory-tool-pill--forget"
        role="status"
        title={`Forgot memory entry: ${result.key}`}
      >
        <Trash2 size={12} aria-hidden="true" />
        <span>
          Forgot <code>{result.key}</code>
        </span>
      </div>
    );
  }
  // recall
  return (
    <div className="memory-tool-list" role="region" aria-label="Memory matches">
      <div className="memory-tool-list__header">
        <Database size={12} aria-hidden="true" />
        <span>Memory matches for “{result.query}”</span>
      </div>
      {result.hits.length === 0 ? (
        <div className="memory-tool-list__empty">No matching memory.</div>
      ) : (
        <ul className="memory-tool-list__items">
          {result.hits.map((hit) => (
            <li
              key={hit.entity.id}
              className="memory-tool-list__item"
              title={`${hit.entity.category} · ${hit.entity.key}`}
            >
              <div className="memory-tool-list__item-head">
                <span className="memory-tool-list__category">
                  {hit.entity.category}
                </span>
                <span className="memory-tool-list__key">{hit.entity.key}</span>
              </div>
              <div className="memory-tool-list__value">
                {hit.entity.value}
              </div>
              {hit.entity.aliases && hit.entity.aliases.length > 0 && (
                <div className="memory-tool-list__aliases">
                  aka {hit.entity.aliases.join(", ")}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isGenerating,
  currentTask,
  scrollRef,
}) => {
  const renderMessageContent = (
    content: string,
    isLastAssistantMsg: boolean,
  ) => {
    const cleanContent = stripToolCalls(content);

    // Always show cleanContent if it exists, regardless of tool calls
    const isMeaninglessContent = /^[\s\x60{}[\]]*$/.test(cleanContent);
    const isProcessing = isLastAssistantMsg && isGenerating && !currentTask;

    if ((!cleanContent || isMeaninglessContent) && !isProcessing) {
      return null;
    }

    if ((!cleanContent || isMeaninglessContent) && isProcessing) {
      return (
        <div className="thinking-indicator">
          <div className="thinking-dot"></div>
          <div className="thinking-dot"></div>
          <div className="thinking-dot"></div>
        </div>
      );
    }

    return (
      <div
        className="message-content-wrapper"
        style={{ whiteSpace: "pre-wrap" }}
      >
        {cleanContent && <span>{cleanContent}</span>}
      </div>
    );
  };

  const lastAssistantIdx = [...messages]
    .reverse()
    .findIndex((m) => m.role === "assistant");
  const actualLastAssistantIdx =
    lastAssistantIdx === -1 ? -1 : messages.length - 1 - lastAssistantIdx;

  return (
    <div className="chat-messages" ref={scrollRef}>
      {messages.length === 0 ? (
        <div
          style={{
            margin: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <img src={logo} alt="Pern Logo" className="idle-sprite" />
        </div>
      ) : (
        messages.map((msg, i) => {
          if (msg.role === "system" && msg.content.startsWith("Tool Result:"))
            return null;

          const isLastAssistantMsg = i === actualLastAssistantIdx;
          const assistantContent =
            msg.role === "assistant"
              ? renderMessageContent(msg.content, isLastAssistantMsg)
              : null;

          const hasMemoryResults =
            msg.role === "assistant" &&
            msg.memory_tool_results &&
            msg.memory_tool_results.length > 0;

          if (msg.role === "assistant" && !assistantContent && !hasMemoryResults) {
            return null;
          }

          return (
            <div key={i} className={`message ${msg.role}`}>
              {msg.role === "assistant" ? assistantContent : cleanUserMessageForDisplay(msg.content)}
              {hasMemoryResults && (
                <div className="memory-tool-results">
                  {msg.memory_tool_results!.map((m, idx) => (
                    <MemoryResultCard key={idx} result={m} />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
      {isGenerating &&
        !currentTask &&
        (messages.length === 0 ||
          messages[messages.length - 1].role !== "assistant") && (
          <div
            className="message assistant"
            style={{ width: "fit-content", padding: "0.75rem 1rem" }}
          >
            <div className="thinking-indicator">
              <div className="thinking-dot"></div>
              <div className="thinking-dot"></div>
              <div className="thinking-dot"></div>
            </div>
          </div>
        )}
      {isGenerating && currentTask && (
        <div className="message assistant">
          <div className="tool-call-row one-liner">
            <div
              className="thinking-dot"
              style={{ width: "6px", height: "6px" }}
            ></div>
            <span
              style={{
                fontSize: "0.75rem",
                opacity: 0.8,
              }}
            >
              {currentTask}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
