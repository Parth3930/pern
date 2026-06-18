import { useEffect } from "react";
import { api, ChatMessage } from "../../../lib/api";

function formatCLIAgentOutput(output: string, label: string): string {
  const trimmed = output.trim();
  if (!trimmed) return "";
  const clipped =
    trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
  const quoted = clipped
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\n**${label}:**\n${quoted}`;
}

/**
 * Listens for `cli-agent-complete` events from the backend and appends
 * formatted result messages to the chat.
 */
export function useCLIAgentEvents(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  messagesRef: React.MutableRefObject<ChatMessage[]>,
) {
  useEffect(() => {
    let unsubCLIAgent: (() => void) | undefined;
    const setup = async () => {
      unsubCLIAgent = await api.onCLIAgentComplete((data) => {
        console.log("[CHAT] CLI agent completion received:", data);
        const outputLabel =
          data.status === "completed" ? "Output" : "Error output";
        const outputBlock = formatCLIAgentOutput(data.output, outputLabel);
        const emoji = data.status === "completed" ? "✅" : "❌";
        let summaryPart = "";
        if (data.summary) {
          summaryPart = `\n\n### Summary of changes:\n${data.summary}`;
        }
        const msg: ChatMessage = {
          role: "assistant",
          content: `${emoji} **${data.agent}** ${data.status === "completed" ? "completed" : "failed"}: "${data.task.slice(0, 100)}"${summaryPart}${outputBlock}`,
        };
        setMessages((prev) => {
          const next = [...prev, msg];
          messagesRef.current = next;
          return next;
        });
      });
    };
    setup();
    return () => {
      if (unsubCLIAgent) unsubCLIAgent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
