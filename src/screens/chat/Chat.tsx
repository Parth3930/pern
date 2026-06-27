import { useEffect, useRef, useState, useCallback } from "react";
import { api, AppConfig, ChatMessage, UserMemory } from "../../lib/api";
import { useSpeech } from "../../lib/speech";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { executeSingleTool } from "./toolExecutor";
import { useChatServer } from "./hooks/useChatServer";
import { useCLIAgentEvents } from "./hooks/useCLIAgentEvents";
import { useExternalRequests } from "./hooks/useExternalRequests";
import { useTodoReminders } from "./hooks/useTodoReminders";

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
  }, []);

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
    const memoryResults: import("../../lib/api").MemoryToolResult[] = [];
    const context = {
      successfulWhatsAppRecipients: [] as string[],
      successfulWhatsAppMessageRef: { current: "" },
      needsConfigRefreshRef: { current: false },
    };

    for (const tc of toolCalls) {
      setCurrentTask(getCurrentTaskLabel(tc));

      try {
        const result = await executeSingleTool(tc, context);

        if (result.memory_result) {
          memoryResults.push(result.memory_result);
        }
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
          memory_tool_results:
            memoryResults.length > 0 ? memoryResults : undefined,
        };
      } else {
        // No prior assistant message: splice tool results into the last
        // followUp and attach the memory payload to it.
        const followUpsWithMemory = followUpMessages.map((m, i) =>
          i === 0 && memoryResults.length > 0
            ? { ...m, memory_tool_results: memoryResults }
            : m,
        );
        nextMessages.push(...followUpsWithMemory);
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

  const handleSend = async (overrideInput?: string, imageOpts?: any) => {
    const textToSend = overrideInput !== undefined ? overrideInput : input;
    if (!textToSend.trim() && !imageOpts?.file || isGenerating) return;

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

    if (imageOpts?.task) {
      const userMsg: ChatMessage = { 
        role: "user", 
        content: textToSend, 
        image_url: imageOpts.previewUrl 
      } as any;
      
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: "Processing image...",
        is_processing_image: true,
      } as any;
      
      const nextMsgs = [...messagesRef.current, userMsg, assistantMsg];
      messagesRef.current = nextMsgs;
      setMessages(nextMsgs);
      setInput("");
      setIsGenerating(true);
      setCurrentTask(null);
      
      try {
        const { removeBg, png, upscale } = imageOpts.task;
        let sourceBlob: Blob = imageOpts.file;
        if (removeBg) {
          const imgly = await import('@imgly/background-removal');
          const removeBackground = imgly.default || (imgly as any).removeBackground;
          if (typeof removeBackground === 'function') {
            sourceBlob = await (removeBackground as any)(sourceBlob);
            localStorage.setItem("pern_bg_model_downloaded", "true");
          } else {
            throw new Error("removeBackground is not a function.");
          }
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = async () => {
            if (!removeBg) {
              await new Promise(resolve => setTimeout(resolve, 1200));
            }
            const canvas = document.createElement("canvas");
            canvas.width = upscale ? img.width * 2 : img.width;
            canvas.height = upscale ? img.height * 2 : img.height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const mimeType = png || removeBg ? "image/png" : "image/jpeg";
              const finalUrl = canvas.toDataURL(mimeType, 0.8);
              
              const finalAssistantMsg: ChatMessage = {
                role: "assistant",
                content: "Here is your processed image:",
                image_url: finalUrl,
                is_image_result: true,
                source_file_name: imageOpts.file.name
              } as any;
              
              const finalMsgs = [...messagesRef.current.slice(0, -1), finalAssistantMsg];
              messagesRef.current = finalMsgs;
              setMessages(finalMsgs);
            }
            setIsGenerating(false);
            setCurrentTask(null);
          };
          img.onerror = () => {
            setIsGenerating(false);
            setCurrentTask(null);
          };
          if (typeof ev.target?.result === "string") img.src = ev.target.result;
        };
        reader.onerror = () => {
          setIsGenerating(false);
          setCurrentTask(null);
        };
        reader.readAsDataURL(sourceBlob);
      } catch (e) {
        console.error("Image processing error", e);
        const finalMsgs = [...messagesRef.current.slice(0, -1), { role: "assistant", content: "Failed to process image." } as ChatMessage];
        messagesRef.current = finalMsgs;
        setMessages(finalMsgs);
        setIsGenerating(false);
        setCurrentTask(null);
      }
      return;
    }

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

    const userMsg: ChatMessage = { 
      role: "user", 
      content: textToSend, 
      ...(imageOpts?.previewUrl ? { image_url: imageOpts.previewUrl } : {}) 
    } as any;
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
      await api.sendChatMessage(config.selected_model, historyResult.messages.map(m => ({ 
        role: m.role, 
        content: m.content, 
        memory_tool_results: m.memory_tool_results 
      })));
    } catch (e) {
      console.error("[CHAT][DIAG] sendChatMessage FAILED:", e);
      awaitingModelResponseRef.current = false;
      setCurrentTask(null);
      setIsGenerating(false);
    }
  };

  const lastSpokenRef = useRef<string | null>(null);
  const isVoiceSessionRef = useRef<boolean>(false);

  useChatServer(config, onConfigUpdate);
  useCLIAgentEvents(setMessages, messagesRef);
  useExternalRequests(userMemoryRef, configRef, onConfigUpdateRef);

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

  useTodoReminders(speak);

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
        onSend={(opts) => handleSend(undefined, opts)}
      />
    </div>
  );
}
