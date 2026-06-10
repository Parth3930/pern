import { useEffect, useRef, useState, useCallback } from "react";
import { api, AppConfig, ChatMessage, UserMemory } from "../../lib/api";
import { useSpeech } from "../../lib/speech";
import { showNotification } from "../../lib/notifications";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { executeSingleTool } from "./toolExecutor";

interface Props {
  config: AppConfig;
  onConfigUpdate?: () => void;
  setShowTodos?: (show: boolean) => void;
}

import {
  ActionIntent,
  ChatActionMemory,
  ChatActionMemoryArg,
  ToolCall,
  buildConversationHistory,
  buildToolReply,
  detectActionIntent,
  extractToolCalls,
  getCurrentTaskLabel,
  getErrorMessage,
  getStringArg,
  stripToolCalls,
  removeTrailingAssistantMessage,
} from "../chatLogic";

export default function Chat({ config, onConfigUpdate, setShowTodos }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userMemory, setUserMemory] = useState<UserMemory>({
    name: null,
    persona: [],
    conversation_summary: "",
  });
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentTask, setCurrentTask] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const setupRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const userMemoryRef = useRef<UserMemory>({
    name: null,
    persona: [],
    conversation_summary: "",
  });
  const configRef = useRef(config);
  const onConfigUpdateRef = useRef(onConfigUpdate);
  const lastExecutedToolCallRef = useRef<string | null>(null);
  const emptyResponseRetryCountRef = useRef(0);
  const awaitingModelResponseRef = useRef(false);
  const chatActionMemoryRef = useRef<ChatActionMemory>({});
  const latestIntentRef = useRef<ActionIntent>("chat");
  const pendingToolExecutionRef = useRef<ToolCall[] | null>(null);
  const lastToolResultRef = useRef<{ tool: string; status: string } | null>(
    null,
  );
  const NON_NAME_SELF_DESCRIPTORS = new Set([
    "bored",
    "busy",
    "confused",
    "done",
    "fine",
    "good",
    "great",
    "happy",
    "here",
    "hungry",
    "maybe",
    "ok",
    "okay",
    "sad",
    "stressed",
    "sure",
    "there",
    "tired",
    "upset",
  ]);

  const extractDeclaredName = (text: string): string | null => {
    const normalized = text.trim().replace(/\s+/g, " ");
    const patterns = [
      /^(?:my\s+name\s+is|name\s+is|call\s+me|you\s+can\s+call\s+me)\s+(?<name>[a-z][a-z'-]{0,31}(?:\s+[a-z][a-z'-]{0,31})?)\s*[.!?]*$/i,
      /^(?:(?:hi|hello|hey)\s+)?(?:i\s+am|i'm|im|this\s+is)\s+(?<name>[a-z][a-z'-]{0,31}(?:\s+[a-z][a-z'-]{0,31})?)\s*[.!?]*$/i,
    ];

    for (const pattern of patterns) {
      const name = pattern.exec(normalized)?.groups?.name?.trim();
      if (!name) {
        continue;
      }

      const words = name.toLowerCase().split(/\s+/);
      if (words.some((word) => NON_NAME_SELF_DESCRIPTORS.has(word))) {
        return null;
      }

      return name;
    }

    return null;
  };

  const formatCLIAgentOutput = (output: string, label: string): string => {
    const trimmed = output.trim();
    if (!trimmed) {
      return "";
    }

    const clipped =
      trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
    const quoted = clipped
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    return `\n\n**${label}:**\n${quoted}`;
  };

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
  }, []);

  useEffect(() => {
    const loadMemory = async () => {
      try {
        const memory = await api.getUserMemory();
        const memoryWithEmptySummary = {
          ...memory,
          conversation_summary: "",
        };
        setUserMemory(memoryWithEmptySummary);
        try {
          await api.updateUserMemory(memoryWithEmptySummary);
        } catch (e) {
          console.error("[MEMORY] Failed to clear conversation summary on startup:", e);
        }
      } catch (e) {
        console.error("[CHAT] Failed to load user memory:", e);
      }
    };
    loadMemory();

    const initServer = async () => {
      try {
        console.log("[SERVER] Checking llama server health...");
        const isHealthy = await api.llamaServerHealth();
        console.log("[SERVER] Health check result:", isHealthy);
        if (!isHealthy) {
          console.log(
            "[SERVER] Starting local AI server for model:",
            config.selected_model,
          );
          await api.startLlamaServer(config.selected_model);
          console.log("[SERVER] Local AI server started.");
        } else {
          console.log("[SERVER] Server already healthy.");
        }
      } catch (e) {
        console.error("[SERVER] Failed to start local AI server:", e);
        try {
          const installed = await api.checkLlamaInstalled();
          if (!installed) {
            console.log(
              "[SERVER] Local AI installation is broken/incomplete. Redirecting to onboarding...",
            );
            await api.setFirstRunCompleted(false);
            onConfigUpdate?.();
          }
        } catch (err) {
          console.error(
            "[SERVER] Failed to verify installation after crash:",
            err,
          );
        }
      }
    };
    initServer();
  }, [config.selected_model]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    userMemoryRef.current = userMemory;
  }, [userMemory]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    onConfigUpdateRef.current = onConfigUpdate;
  }, [onConfigUpdate]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (setupRef.current) return;
    setupRef.current = true;

    let active = true;
    let unsubToken: (() => void) | undefined;
    let unsubComplete: (() => void) | undefined;
    let accumulatedContent = "";

    const setupListeners = async () => {
      const u1 = await api.onChatToken((token) => {
        if (!active || !awaitingModelResponseRef.current) return;
        accumulatedContent += token;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const nextMessages =
            last && last.role === "assistant"
              ? [
                  ...prev.slice(0, -1),
                  { ...last, content: last.content + token },
                ]
              : [...prev, { role: "assistant", content: token }];

          messagesRef.current = nextMessages;
          return nextMessages;
        });
      });
      unsubToken = u1;

      const u2 = await api.onChatComplete(async () => {
        if (!active) return;
        if (!awaitingModelResponseRef.current) {
          accumulatedContent = "";
          return;
        }
        awaitingModelResponseRef.current = false;

        const content = accumulatedContent.trim();
        console.log("[CHAT][DIAG] Model raw output:", {
          length: content.length,
          preview: content.slice(0, 200),
          intent: latestIntentRef.current,
        });
        accumulatedContent = "";

        try {
          const lastUserMsg = [...messagesRef.current]
            .reverse()
            .find((m) => m.role === "user")?.content;
          const toolCalls = extractToolCalls(content, lastUserMsg);
          console.log("[CHAT][DIAG] Tool extraction", {
            parsedToolCalls: toolCalls.length,
            toolNames: toolCalls.map((t) => t.tool),
            intent: latestIntentRef.current,
          });

          if (toolCalls.length > 0 && latestIntentRef.current === "action") {
            console.log(
              "[CHAT][DIAG] Action intent + tools found → executing tool batch",
            );
            pendingToolExecutionRef.current = toolCalls;
            lastExecutedToolCallRef.current = null;
            await handleToolBatch(toolCalls);
            pendingToolExecutionRef.current = null;
          } else {
            if (toolCalls.length > 0) {
              console.warn(
                "[CHAT][DIAG] MISMATCH: Model output tools but intent=chat — retrying with chat-only prompt.",
              );
              const nextMsgs = removeTrailingAssistantMessage(messagesRef.current);
              messagesRef.current = nextMsgs;
              setMessages(nextMsgs);

              if (emptyResponseRetryCountRef.current < 1) {
                emptyResponseRetryCountRef.current += 1;
                try {
                  const retryHistory = buildConversationHistory(
                    nextMsgs,
                    userMemoryRef.current,
                    "chat",
                    undefined,
                    undefined,
                    undefined,
                    configRef.current.whatsapp_contacts,
                  );

                  awaitingModelResponseRef.current = true;
                  await api.sendChatMessage(
                    configRef.current.selected_model,
                    retryHistory.messages,
                  );
                  return;
                } catch (retryErr) {
                  console.error("[CHAT] Retry failed:", retryErr);
                }
              }
            } else if (
              latestIntentRef.current === "action" &&
              emptyResponseRetryCountRef.current < 1
            ) {
              console.warn(
                "[CHAT][DIAG] Action intended but NO tool calls extracted from response — retrying with forced action prompt.",
              );
              emptyResponseRetryCountRef.current += 1;

              const nextMsgs = removeTrailingAssistantMessage(messagesRef.current);
              messagesRef.current = nextMsgs;
              setMessages(nextMsgs);

              try {
                const retryHistory = buildConversationHistory(
                  nextMsgs,
                  userMemoryRef.current,
                  "action",
                  lastToolResultRef.current || undefined,
                  chatActionMemoryRef.current as ChatActionMemoryArg,
                  undefined,
                  configRef.current.whatsapp_contacts,
                );

                retryHistory.messages.push({
                  role: "system",
                  content:
                    "ERROR: You responded with text. Output ONLY the JSON tool call for the user's request.",
                });

                awaitingModelResponseRef.current = true;
                await api.sendChatMessage(
                  configRef.current.selected_model,
                  retryHistory.messages,
                );
                return;
              } catch (retryErr) {
                console.error("[CHAT] Action retry failed:", retryErr);
              }
            }
            pendingToolExecutionRef.current = null;
            emptyResponseRetryCountRef.current = 0;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== "assistant") {
                return [
                  ...prev,
                  {
                    role: "assistant",
                    content:
                      "Sorry, I had trouble processing that. Could you rephrase or try again?",
                  },
                ];
              }
              if (!last.content.trim()) {
                const rest = prev.slice(0, -1);
                return [
                  ...rest,
                  {
                    role: "assistant",
                    content:
                      "Sorry, I had trouble processing that. Could you rephrase or try again?",
                  },
                ];
              }
              return prev;
            });
            setCurrentTask(null);
            setIsGenerating(false);
          }
        } catch (e) {
          console.error("[CHAT] onChatComplete handler threw:", e);
          awaitingModelResponseRef.current = false;
          setCurrentTask(null);
          setIsGenerating(false);
        }
      });
      unsubComplete = u2;
    };

    setupListeners();

    return () => {
      active = false;
      setupRef.current = false;
      if (unsubToken) unsubToken();
      if (unsubComplete) unsubComplete();
    };
  }, []);

  const handleToolBatch = async (toolCalls: ToolCall[]) => {
    console.log("[CHAT][DIAG] handleToolBatch START", {
      toolCount: toolCalls.length,
      tools: toolCalls.map((t) => ({
        tool: t.tool,
        argsKeys: Object.keys(t.args),
      })),
    });
    const callsSig = JSON.stringify(toolCalls);
    if (lastExecutedToolCallRef.current === callsSig) {
      setCurrentTask(null);
      setIsGenerating(false);
      return;
    }
    lastExecutedToolCallRef.current = callsSig;

    setIsGenerating(true);
    const followUpMessages: ChatMessage[] = [];
    const context = {
      successfulWhatsAppRecipients: [] as string[],
      successfulWhatsAppMessageRef: { current: "" },
      needsConfigRefreshRef: { current: false },
    };

    for (const tc of toolCalls) {
      setCurrentTask(getCurrentTaskLabel(tc));

      try {
        const result = await executeSingleTool(tc, context);

        followUpMessages.push({
          role: "assistant",
          content: "[TOOL_RESULT] " + buildToolReply(tc, result),
        });
        if (result.ok) {
          lastToolResultRef.current = {
            tool: tc.tool,
            status: `${tc.tool} succeeded`,
          };
          api
            .recordToolUsage(tc.tool, JSON.stringify(tc.args).slice(0, 200))
            .catch((e) => console.warn("[LEARNER] Failed to record usage:", e));
        }
      } catch (error) {
        console.error(`[TOOL] Tool "${tc.tool}" threw an error:`, error);
        const reason = getErrorMessage(error);
        const errorMessage =
          tc.tool === "send_whatsapp_message"
            ? `Failed to send WhatsApp message to ${getStringArg(tc.args, "recipient") || "recipient"}: ${reason}`
            : reason;
        followUpMessages.push({
          role: "assistant",
          content: "[TOOL_RESULT] " + errorMessage,
        });
      }
    }

    setCurrentTask(null);
    if (context.successfulWhatsAppRecipients.length > 0 && context.successfulWhatsAppMessageRef.current) {
      chatActionMemoryRef.current = {
        ...chatActionMemoryRef.current,
        whatsapp: {
          recipients: [...new Set(context.successfulWhatsAppRecipients)],
          message: context.successfulWhatsAppMessageRef.current,
        },
      };
    }
    setMessages((prev) => {
      const nextMessages = [...prev];
      const lastAssIdx = nextMessages.map((m) => m.role).lastIndexOf("assistant");
      if (lastAssIdx !== -1) {
        const resultsText = followUpMessages.map((m) => m.content).join("\n");
        nextMessages[lastAssIdx] = {
          ...nextMessages[lastAssIdx],
          content: nextMessages[lastAssIdx].content.trim() + "\n" + resultsText,
        };
      } else {
        nextMessages.push(...followUpMessages);
      }
      messagesRef.current = nextMessages;
      return nextMessages;
    });
    setIsGenerating(false);

    if (context.needsConfigRefreshRef.current && onConfigUpdate) {
      try {
        await onConfigUpdate();
      } catch {
        // Ignore refresh failures
      }
    }
  };

  useEffect(() => {
    let active = true;
    let unsubExternal: (() => void) | undefined;

    const setupExternalListener = async () => {
      const u = await listen<{
        request_id: string;
        platform: string;
        contact_name: string;
        user_message: string;
        is_owner: boolean;
      }>("request-external-reply", async (event) => {
        if (!active) return;
        const { request_id, platform, contact_name, user_message, is_owner } = event.payload;

        console.log(`[EXTERNAL_REQUEST] Received request ${request_id} from ${platform} (sender: ${contact_name}, is_owner: ${is_owner})`);

        try {
          const latestIntent = is_owner ? detectActionIntent(user_message) : "chat";

          let relevantSkills: import("../../lib/api").Skill[] = [];
          try {
            relevantSkills = await api.findRelevantSkills(user_message);
          } catch (_) {}

          const tempMessages: ChatMessage[] = [{ role: "user", content: user_message }];

          const historyResult = buildConversationHistory(
            tempMessages,
            userMemoryRef.current,
            latestIntent,
            undefined,
            {},
            relevantSkills.length > 0 ? relevantSkills : undefined,
            configRef.current.whatsapp_contacts,
          );

          const response = await fetch("http://127.0.0.1:4891/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "local",
              messages: historyResult.messages,
              temperature: 0.7,
              stream: false,
            }),
          });

          if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
          }

          const data = await response.json();
          const rawReply = data.choices?.[0]?.message?.content || "";
          console.log("[EXTERNAL_REQUEST] Raw reply:", rawReply);

          const toolCalls = latestIntent === "action" ? extractToolCalls(rawReply, user_message) : [];

          let finalReply = "";

          if (toolCalls.length > 0) {
            console.log("[EXTERNAL_REQUEST] Action intent + tools found → executing tools");
            const toolResults: string[] = [];
            const context = {
              successfulWhatsAppRecipients: [] as string[],
              successfulWhatsAppMessageRef: { current: "" },
              needsConfigRefreshRef: { current: false },
            };

            for (const tc of toolCalls) {
              try {
                const res = await executeSingleTool(tc, context);
                toolResults.push(buildToolReply(tc, res));
              } catch (err) {
                toolResults.push(`Error executing ${tc.tool}: ${err}`);
              }
            }

            if (context.needsConfigRefreshRef.current && onConfigUpdateRef.current) {
              try {
                await onConfigUpdateRef.current();
              } catch {}
            }

            finalReply = toolResults.join("\n");
          } else {
            finalReply = stripToolCalls(rawReply).trim();
          }

          await invoke("submit_external_reply", { requestId: request_id, reply: finalReply });
        } catch (err) {
          console.error("[EXTERNAL_REQUEST] Failed to process request:", err);
          try {
            await invoke("submit_external_reply", {
              requestId: request_id,
              reply: "Sorry, I encountered an error while processing that request.",
            });
          } catch (invokeErr) {
            console.error("[EXTERNAL_REQUEST] Failed to submit error reply:", invokeErr);
          }
        }
      });
      unsubExternal = u;
    };

    setupExternalListener();

    return () => {
      active = false;
      if (unsubExternal) unsubExternal();
    };
  }, []);

  const handleSend = async (overrideInput?: string) => {
    const textToSend = overrideInput !== undefined ? overrideInput : input;
    if (!textToSend.trim() || isGenerating) return;

    isVoiceSessionRef.current = overrideInput !== undefined;

    if (typeof lastSpokenRef !== "undefined") {
      lastSpokenRef.current = null;
    }
    if (typeof stopSpeaking !== "undefined") {
      stopSpeaking();
    }

    const trimmedInput = textToSend.trim();
    const cleanInputForCommand = trimmedInput.replace(/[.?!\s]+$/, "").trim();
    console.log("[CHAT] User prompt:", trimmedInput);

    if (/^(?:open\s+|show\s+)?(?:up\s+)?(?:my\s+)?todo(s|(?:\s+list))?$/i.test(cleanInputForCommand)) {
      if (setShowTodos) {
        setShowTodos(true);
        const userMsg: ChatMessage = { role: "user", content: textToSend };
        const assistantMsg: ChatMessage = { role: "assistant", content: "Opening your Todo list..." };
        const nextMessages = [...messagesRef.current, userMsg, assistantMsg];
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        setInput("");
        setIsGenerating(false);
        speak("Opening your Todo list.");
        return;
      }
    }

    if (
      /^(?:clear|clear\s+(?:the\s+)?chat(?:\s+.*)?|@clear(?:\s+.*)?|\/clear(?:\s+.*)?)$/i.test(
        cleanInputForCommand,
      )
    ) {
      awaitingModelResponseRef.current = false;
      lastExecutedToolCallRef.current = null;
      emptyResponseRetryCountRef.current = 0;
      chatActionMemoryRef.current = {};
      messagesRef.current = [];
      setMessages([]);
      setInput("");
      setCurrentTask(null);
      setIsGenerating(false);
      lastToolResultRef.current = null;

      const clearedMemory = { name: null, persona: [], conversation_summary: "" };
      setUserMemory(clearedMemory);
      try {
        await api.updateUserMemory(clearedMemory);
        console.log("[MEMORY] Cleared all memory on user request.");
      } catch (e) {
        console.error("[MEMORY] Failed to clear memory:", e);
      }
      return;
    }

    if (
      pendingToolExecutionRef.current &&
      /^(yes|yeah|yep|ok|okay|sure|do it|go ahead|send|yes send|please do)\s*$/i.test(
        cleanInputForCommand,
      )
    ) {
      await handleToolBatch(pendingToolExecutionRef.current);
      pendingToolExecutionRef.current = null;
      setInput("");
      return;
    }

    lastExecutedToolCallRef.current = null;
    emptyResponseRetryCountRef.current = 0;
    lastToolResultRef.current = null;

    const userMsg: ChatMessage = { role: "user", content: textToSend };
    const nextMessages = [...messagesRef.current, userMsg];

    let memoryForTurn = userMemory;
    const detectedName = extractDeclaredName(trimmedInput);
    if (detectedName && detectedName !== userMemory.name) {
      const updatedMemory = { ...userMemory, name: detectedName };
      setUserMemory(updatedMemory);
      memoryForTurn = updatedMemory;
      await api.updateUserMemory(updatedMemory);
      console.log("[MEMORY] Updated user name to:", detectedName);
    } else if (/^(?:clear|reset) my name$/i.test(cleanInputForCommand)) {
      const updatedMemory = { ...userMemory, name: null };
      setUserMemory(updatedMemory);
      memoryForTurn = updatedMemory;
      await api.updateUserMemory(updatedMemory);
      console.log("[MEMORY] Cleared user name.");
    }

    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput("");

    setIsGenerating(true);
    setCurrentTask(null);

    const latestIntent = detectActionIntent(trimmedInput, messagesRef.current);
    latestIntentRef.current = latestIntent;

    try {
      let relevantSkills: import("../../lib/api").Skill[] = [];
      try {
        relevantSkills = await api.findRelevantSkills(trimmedInput);
      } catch (_) {}

      const historyResult = buildConversationHistory(
        nextMessages,
        memoryForTurn,
        latestIntent,
        lastToolResultRef.current || undefined,
        chatActionMemoryRef.current as ChatActionMemoryArg,
        relevantSkills.length > 0 ? relevantSkills : undefined,
        config.whatsapp_contacts,
      );

      if (historyResult.summary !== memoryForTurn.conversation_summary) {
        const updatedMemory = {
          ...memoryForTurn,
          conversation_summary: historyResult.summary,
        };
        setUserMemory(updatedMemory);
        memoryForTurn = updatedMemory;
        await api.updateUserMemory(updatedMemory);
      }

      awaitingModelResponseRef.current = true;
      await api.sendChatMessage(config.selected_model, historyResult.messages);
    } catch (e) {
      console.error("[CHAT][DIAG] sendChatMessage FAILED:", e);
      awaitingModelResponseRef.current = false;
      setCurrentTask(null);
      setIsGenerating(false);
    }
  };

  const lastSpokenRef = useRef<string | null>(null);
  const isVoiceSessionRef = useRef<boolean>(false);

  const handleVoiceCommand = useCallback((command: string) => {
    handleSend(command);
  }, []);

  const {
    isSupported,
    isListening,
    speak,
    stopSpeaking,
    startListening,
    stopListening,
  } = useSpeech({
    onCommandDetected: handleVoiceCommand,
  });

  useEffect(() => {
    if (!isGenerating && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "assistant" && lastMsg.content) {
        const text = stripToolCalls(lastMsg.content).trim();
        if (text && text !== lastSpokenRef.current) {
          lastSpokenRef.current = text;
          if (isVoiceSessionRef.current) {
            speak(text);
          }
        }
      }
    }
  }, [isGenerating, messages, speak]);

  useEffect(() => {
    const syncTodos = async () => {
      try {
        const diskTodos = await api.getTodos();
        if (diskTodos) {
          localStorage.setItem("pern_todos", JSON.stringify(diskTodos));
          window.dispatchEvent(new Event("pern_todos_updated"));
        }
      } catch (err) {
        console.error("Failed to sync todos from disk on startup:", err);
      }
    };
    syncTodos();
  }, []);

  useEffect(() => {
    const checkTodos = () => {
      try {
        const storedTodos = localStorage.getItem("pern_todos");
        if (!storedTodos) return;
        const todos = JSON.parse(storedTodos);
        let updated = false;

        const now = new Date();

        const updatedTodos = todos.map((todo: any) => {
          if (!todo.completed && !todo.reminded && todo.time) {
            const reminderTime = new Date(todo.time);
            if (reminderTime <= now) {
              speak(`Excuse me, this is a reminder for your task: ${todo.text}`);
              showNotification("Todo Reminder", todo.text);

              if (todo.repeat_hours && todo.repeat_hours > 0) {
                const nextTime = new Date(reminderTime.getTime() + todo.repeat_hours * 60 * 60 * 1000);
                todo.time = nextTime.toISOString();
                todo.reminded = false;
              } else {
                todo.reminded = true;
              }
              updated = true;
            }
          }
          return todo;
        });

        if (updated) {
          localStorage.setItem("pern_todos", JSON.stringify(updatedTodos));
          api.saveTodos(updatedTodos).catch((err) => {
            console.error("Failed to save updated todos to disk in background checker:", err);
          });
          window.dispatchEvent(new Event("pern_todos_updated"));
        }
      } catch (err) {
        console.error("Error checking todo reminders:", err);
      }
    };

    const interval = setInterval(checkTodos, 5000);
    return () => clearInterval(interval);
  }, [speak]);

  return (
    <div className="chat-main">
      <MessageList
        messages={messages}
        isGenerating={isGenerating}
        currentTask={currentTask}
        scrollRef={scrollRef}
      />
      <ChatInput
        input={input}
        setInput={setInput}
        isGenerating={isGenerating}
        isListening={isListening}
        isSupported={isSupported}
        startListening={startListening}
        stopListening={stopListening}
        onSend={() => handleSend()}
      />
    </div>
  );
}
