import React from "react";
import logo from "../../assets/logo.png";
import { CheckCircle2, Database, Trash2, Download } from "lucide-react";
import { ChatMessage, MemoryToolResult } from "../../lib/api";
import { stripToolCalls } from "../chatLogic";
import { PlannerView } from "./PlannerView";
import { TaskPlan } from "./taskPlanner";

interface MessageListProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  currentTask: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  activePlan?: TaskPlan | null;
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
  activePlan,
}) => {
  const renderMessageContent = (
    content: string,
    isLastAssistantMsg: boolean,
    msgData?: any
  ) => {
    if (msgData?.is_processing_image) {
      return (
        <div className="thinking-indicator" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Processing image</span>
          <div className="thinking-dot"></div>
          <div className="thinking-dot"></div>
          <div className="thinking-dot"></div>
        </div>
      );
    }

    if (msgData?.is_image_result && msgData?.image_url) {
      return (
        <div style={{ position: "relative", display: "inline-block", marginTop: "4px" }}>
          <img src={msgData.image_url} alt="result" style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8, display: "block" }} />
          <a href={msgData.image_url} download={`processed_${msgData.source_file_name || 'image'}`} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "rgba(0,0,0,0.65)", color: "white", width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", backdropFilter: "blur(4px)" }} title="Download Image">
            <Download size={22} />
          </a>
        </div>
      );
    }

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

          if (msg.harness_plan) {
            return (
              <div key={i} style={{ padding: "0 4px", margin: "4px 0" }}>
                <PlannerView plan={msg.harness_plan} />
              </div>
            );
          }

          const isLastAssistantMsg = i === actualLastAssistantIdx;
          const assistantContent =
            msg.role === "assistant"
              ? renderMessageContent(msg.content, isLastAssistantMsg, msg)
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
              {msg.role === "user" && (msg as any).image_url && (
                <img src={(msg as any).image_url} alt="attachment" style={{marginTop: 8, maxWidth: "100%", maxHeight: 200, borderRadius: 8, objectFit: 'contain', display: 'block'}} />
              )}
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

      {/* Harness plan view — shown when a multi-step plan is active */}
      {activePlan && (
        <div style={{ padding: "0 4px" }}>
          <PlannerView plan={activePlan} />
        </div>
      )}
    </div>
  );
};
