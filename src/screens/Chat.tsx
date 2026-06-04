import { useEffect, useRef, useState, useCallback } from "react";
import { api, AppConfig, ChatMessage, UserMemory } from "../lib/api";
import { Send, Mic, MicOff } from "lucide-react";
import { useSpeech } from "../lib/speech";

import logo from "../assets/logo.png";
interface Props {
  config: AppConfig;
  onConfigUpdate?: () => void;
}

import {
  ActionIntent,
  ChatActionMemory,
  ChatActionMemoryArg,
  ToolCall,
  ToolResult,
  buildConversationHistory,
  buildToolReply,
  detectActionIntent,
  extractToolCalls,
  getCurrentTaskLabel,
  getErrorMessage,
  getExactStringArg,
  getNumberArg,
  getStringArg,
  getBooleanArg,
  replacePendingToolMessage,
  stripToolCalls,
  validateEmailToolArgs,
} from "./chatLogic";

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

  if (content.startsWith("[Context:\n") || content.startsWith("[Owner context:")) {
    const idx = content.indexOf("]\n\n");
    if (idx !== -1) {
      return content.slice(idx + 3);
    }
  }
  return content;
};

export default function Chat({ config, onConfigUpdate }: Props) {
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

    const clipped = trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
    const quoted = clipped.split("\n").map((line) => `> ${line}`).join("\n");
    return `\n\n**${label}:**\n${quoted}`;
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let unsubCLIAgent: (() => void) | undefined;
    const setup = async () => {
      unsub = await api.onAppLog((log) => {
        const prefix = log.level.toUpperCase();
        if (log.level === "error") {
          console.error(`[BACKEND] ${prefix}: ${log.message}`);
        } else if (log.level === "warn") {
          console.warn(`[BACKEND] ${prefix}: ${log.message}`);
        } else {
          console.log(`[BACKEND] ${prefix}: ${log.message}`);
        }
      });

      // Listen for CLI agent task completions
      unsubCLIAgent = await api.onCLIAgentComplete((data) => {
        console.log("[CHAT] CLI agent completion received:", data);
        const outputLabel = data.status === "completed" ? "Output" : "Error output";
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
      if (unsub) unsub();
      if (unsubCLIAgent) unsubCLIAgent();
    };
  }, []);

  useEffect(() => {
    const loadMemory = async () => {
      try {
        const memory = await api.getUserMemory();
        setUserMemory(memory);
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
        console.error(
          "[SERVER] Error details:",
          JSON.stringify(e, Object.getOwnPropertyNames(e)),
        );
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
        console.log("[CHAT] Model raw output:", content);
        accumulatedContent = "";

        try {
          const lastUserMsg = [...messagesRef.current]
            .reverse()
            .find((m) => m.role === "user")?.content;
          const toolCalls = extractToolCalls(content, lastUserMsg);

          if (toolCalls.length > 0 && latestIntentRef.current === "action") {
            pendingToolExecutionRef.current = toolCalls;
            lastExecutedToolCallRef.current = null;
            // If the model output tools, we clean up the assistant message
            // and execute the tools.
            const nextMessages = replacePendingToolMessage(messagesRef.current);
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
            await handleToolBatch(toolCalls);
          } else {
            // intent=chat or no tool calls
            if (toolCalls.length > 0) {
              console.warn(
                "[CHAT] Model output tool JSON but intent=chat — retrying with chat-only prompt.",
              );
              // Strip the bad message and retry once so the user gets a real reply
              const stripped = (nextMessages: ChatMessage[]) =>
                replacePendingToolMessage(nextMessages);
              const nextMsgs = stripped(messagesRef.current);
              messagesRef.current = nextMsgs;
              setMessages(nextMsgs);

              if (emptyResponseRetryCountRef.current < 1) {
                emptyResponseRetryCountRef.current += 1;
                try {
                  const retryHistory = buildConversationHistory(
                    nextMsgs,
                    userMemoryRef.current,
                    "chat", // force chat intent so prompt has no JSON
                    undefined,
                    undefined,
                    undefined,
                    configRef.current.whatsapp_contacts,
                  );

                  // Update the last user message in React state to include the context (keeps cache matching across turns)
                  if (retryHistory.messages.length > 0) {
                    const lastModifiedMsg = retryHistory.messages[retryHistory.messages.length - 1];
                    if (lastModifiedMsg.role === "user") {
                      setMessages((prev) => {
                        const next = [...prev];
                        for (let i = next.length - 1; i >= 0; i -= 1) {
                          if (next[i].role === "user") {
                            next[i] = {
                              ...next[i],
                              content: lastModifiedMsg.content,
                            };
                            break;
                          }
                        }
                        messagesRef.current = next;
                        return next;
                      });
                    }
                  }

                  awaitingModelResponseRef.current = true;
                  await api.sendChatMessage(
                    configRef.current.selected_model,
                    retryHistory.messages,
                  );
                  return; // wait for next onChatComplete
                } catch (retryErr) {
                  console.error("[CHAT] Retry failed:", retryErr);
                }
              }
            } else if (
              latestIntentRef.current === "action" &&
              emptyResponseRetryCountRef.current < 1
            ) {
              // If we intended an action but got no JSON, it's likely a conversational hallucination
              console.warn(
                "[CHAT] Action intended but no JSON found — retrying with forced action prompt.",
              );
              emptyResponseRetryCountRef.current += 1;

              // Keep the current history but nudge for JSON
              const nextMsgs = replacePendingToolMessage(messagesRef.current);
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

                // Update the last user message in React state to include the context (keeps cache matching across turns)
                if (retryHistory.messages.length > 0) {
                  const lastModifiedMsg = retryHistory.messages[retryHistory.messages.length - 1];
                  if (lastModifiedMsg.role === "user") {
                    setMessages((prev) => {
                      const next = [...prev];
                      for (let i = next.length - 1; i >= 0; i -= 1) {
                        if (next[i].role === "user") {
                          next[i] = {
                            ...next[i],
                            content: lastModifiedMsg.content,
                          };
                          break;
                        }
                      }
                      messagesRef.current = next;
                      return next;
                    });
                  }
                }

                // Add a final system nudge for JSON
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
            // If we exhausted retries without a valid response, show a fallback
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
              // If last assistant message is empty or just whitespace, replace it
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
    console.log("[CHAT] Executing tool batch:", toolCalls);
    const callsSig = JSON.stringify(toolCalls);
    if (lastExecutedToolCallRef.current === callsSig) {
      setCurrentTask(null);
      setIsGenerating(false);
      return;
    }
    lastExecutedToolCallRef.current = callsSig;

    setIsGenerating(true);
    const followUpMessages: ChatMessage[] = [];
    let needsConfigRefresh = false;
    const successfulWhatsAppRecipients: string[] = [];
    let successfulWhatsAppMessage = "";

    for (const tc of toolCalls) {
      setCurrentTask(getCurrentTaskLabel(tc));

      try {
        let result: ToolResult;

        if (tc.tool === "close_app") {
          const appName = getStringArg(tc.args, "app_name");
          result = appName
            ? await api.closeApp(appName)
            : { ok: false, error: "The app name was missing." };
        } else if (tc.tool === "launch_app") {
          const appName = getStringArg(tc.args, "app_name");
          result = appName
            ? await api.launchApp(appName)
            : { ok: false, error: "The app name was missing." };
        } else if (tc.tool === "restart_system") {
          result = await api.restartSystem();
        } else if (tc.tool === "shutdown_system") {
          result = await api.shutdownSystem();
        } else if (tc.tool === "send_email") {
          const validationError = validateEmailToolArgs(tc.args);
          if (validationError) {
            result = { ok: false, error: validationError };
          } else {
            const body = getExactStringArg(tc.args, "body");
            result = await api.sendEmail(
              getStringArg(tc.args, "to"),
              getStringArg(tc.args, "subject"),
              body,
            );
          }
        } else if (tc.tool === "set_discord_status") {
          const status = getStringArg(tc.args, "status") || undefined;
          const activity = getStringArg(tc.args, "activity") || undefined;
          if (!status && !activity) {
            result = { ok: false, error: "Status or activity missing." };
          } else {
            const message = await api.setDiscordStatus(status, activity);
            result = { ok: true, message };
          }
        } else if (tc.tool === "add_whatsapp_contact") {
          const name = getStringArg(tc.args, "name");
          const number = getStringArg(tc.args, "number");
          if (!name || !number) {
            result = { ok: false, error: "Name or number missing." };
          } else {
            await api.addWhatsAppContact(name, number);
            result = { ok: true };
            needsConfigRefresh = true;
          }
        } else if (tc.tool === "set_whatsapp_contact_auto_reply") {
          const name = getStringArg(tc.args, "name");
          const enabled = getBooleanArg(tc.args, "enabled");
          if (!name || enabled === undefined) {
            result = { ok: false, error: "Name or enabled status missing." };
          } else {
            await api.setWhatsAppContactAutoReply(name, enabled);
            result = { ok: true };
            needsConfigRefresh = true;
          }
        } else if (tc.tool === "set_whatsapp_auto_reply") {
          const recipient = getStringArg(tc.args, "recipient") || getStringArg(tc.args, "name");
          const enabled = getBooleanArg(tc.args, "enabled");
          if (!recipient || enabled === undefined) {
            result = { ok: false, error: "Recipient or enabled status missing." };
          } else {
            const actualName = await api.setWhatsAppAutoReply(recipient, enabled);
            result = { ok: true, status: `Auto-reply ${enabled ? "enabled" : "disabled"} for contact ${actualName} on WhatsApp.` };
            needsConfigRefresh = true;
          }
        } else if (tc.tool === "toggle_whatsapp_auto_reply") {
          const recipient = getStringArg(tc.args, "recipient") || getStringArg(tc.args, "name");
          if (!recipient) {
            result = { ok: false, error: "Recipient missing." };
          } else {
            try {
              const [actualName, newState] =
                await api.toggleWhatsAppAutoReply(recipient);
              result = {
                ok: true,
                status: `Toggled auto-reply on WhatsApp. It is now ${newState ? "enabled" : "disabled"} for contact ${actualName}.`,
              };
            } catch (e) {
              try {
                const refreshed = await api.getWhatsAppContacts();
                const recipientLower = recipient.toLowerCase();
                const recipientKey = recipientLower.replace(/[^a-z0-9]/g, "");
                const matches = refreshed.find((c) => {
                  const nameLower = c.name.toLowerCase();
                  const nameKey = nameLower.replace(/[^a-z0-9]/g, "");
                  return (
                    nameLower === recipientLower ||
                    nameLower.includes(recipientLower) ||
                    recipientLower.includes(nameLower) ||
                    (nameKey &&
                      recipientKey &&
                      (nameKey === recipientKey ||
                        nameKey.includes(recipientKey) ||
                        recipientKey.includes(nameKey)))
                  );
                });

                if (matches) {
                  result = {
                    ok: true,
                    status: `Auto-reply is now ${matches.auto_reply_enabled ? "enabled" : "disabled"} for contact ${matches.name} on WhatsApp.`,
                  };
                } else {
                  result = {
                    ok: true,
                    status: `Auto-reply toggle sent for contact ${recipient} on WhatsApp. (Couldn't verify state in chat.)`,
                  };
                }
              } catch (_refreshError) {
                result = {
                  ok: true,
                  status: `Auto-reply toggle sent for contact ${recipient} on WhatsApp. (Couldn't verify state in chat.)`,
                };
              }
            }

            needsConfigRefresh = true;
          }
        } else if (tc.tool === "toggle_whatsapp") {
          const enabled = getBooleanArg(tc.args, "enabled");
          if (enabled === undefined) {
            result = { ok: false, error: "Enabled status missing." };
          } else {
            await api.toggleWhatsApp(enabled);
            result = { ok: true };
            needsConfigRefresh = true;
          }
        } else if (tc.tool === "send_whatsapp_message") {
          const recipient = getStringArg(tc.args, "recipient");
          const message = getStringArg(tc.args, "message");
          if (!recipient || !message) {
            result = { ok: false, error: "Recipient or message missing." };
          } else {
            await api.sendWhatsAppMessage(recipient, message);
            result = { ok: true };
            successfulWhatsAppRecipients.push(recipient);
            successfulWhatsAppMessage = message;
          }
        } else if (tc.tool === "save_email_config") {
          const smtpHost = getStringArg(tc.args, "smtp_host");
          const smtpPort = getNumberArg(tc.args, "smtp_port");
          const senderEmail = getStringArg(tc.args, "sender_email");
          const smtpPassword = getStringArg(tc.args, "smtp_password");

          if (!smtpHost || smtpPort === null || !senderEmail || !smtpPassword) {
            result = {
              ok: false,
              error: "The email settings were incomplete.",
            };
          } else {
            await api.saveEmailConfig(
              smtpHost,
              smtpPort,
              senderEmail,
              smtpPassword,
            );
            result = { ok: true };
            needsConfigRefresh = true;
          }
        } else if (tc.tool === "discord_kick") {
          const guildId = getStringArg(tc.args, "guild_id");
          const userId = getStringArg(tc.args, "user_id");
          const reason = getStringArg(tc.args, "reason") || undefined;
          if (!guildId || !userId) {
            result = { ok: false, error: "Guild ID or User ID missing." };
          } else {
            await api.discordKick(guildId, userId, reason);
            result = { ok: true };
          }
        } else if (tc.tool === "discord_ban") {
          const guildId = getStringArg(tc.args, "guild_id");
          const userId = getStringArg(tc.args, "user_id");
          const reason = getStringArg(tc.args, "reason") || undefined;
          const deleteSecs = getNumberArg(tc.args, "delete_message_seconds") || undefined;
          if (!guildId || !userId) {
            result = { ok: false, error: "Guild ID or User ID missing." };
          } else {
            await api.discordBan(guildId, userId, reason, deleteSecs);
            result = { ok: true };
          }
        } else if (tc.tool === "discord_unban") {
          const guildId = getStringArg(tc.args, "guild_id");
          const userId = getStringArg(tc.args, "user_id");
          if (!guildId || !userId) {
            result = { ok: false, error: "Guild ID or User ID missing." };
          } else {
            await api.discordUnban(guildId, userId);
            result = { ok: true };
          }
        } else if (tc.tool === "discord_mute") {
          const guildId = getStringArg(tc.args, "guild_id");
          const userId = getStringArg(tc.args, "user_id");
          const duration = getNumberArg(tc.args, "duration_mins");
          const reason = getStringArg(tc.args, "reason") || undefined;
          if (!guildId || !userId || duration === null) {
            result = { ok: false, error: "Guild ID, User ID, or duration missing." };
          } else {
            await api.discordMute(guildId, userId, duration, reason);
            result = { ok: true };
          }
        } else if (tc.tool === "discord_unmute") {
          const guildId = getStringArg(tc.args, "guild_id");
          const userId = getStringArg(tc.args, "user_id");
          if (!guildId || !userId) {
            result = { ok: false, error: "Guild ID or User ID missing." };
          } else {
            await api.discordUnmute(guildId, userId);
            result = { ok: true };
          }
        } else if (tc.tool === "discord_warn") {
          const guildId = getStringArg(tc.args, "guild_id") || null;
          const userId = getStringArg(tc.args, "user_id");
          const reason = getStringArg(tc.args, "reason");
          if (!userId || !reason) {
            result = { ok: false, error: "User ID or warning reason missing." };
          } else {
            await api.discordWarn(guildId, userId, reason);
            result = { ok: true };
          }
        } else if (tc.tool === "discord_delete_messages") {
          const channelId = getStringArg(tc.args, "channel_id");
          const count = getNumberArg(tc.args, "count");
          if (!channelId || count === null) {
            result = { ok: false, error: "Channel ID or message count missing." };
          } else {
            await api.discordDeleteMessages(channelId, count);
            result = { ok: true };
          }
        } else if (tc.tool === "discord_assign_role") {
          const guildId = getStringArg(tc.args, "guild_id");
          const userId = getStringArg(tc.args, "user_id");
          const roleId = getStringArg(tc.args, "role_id");
          if (!guildId || !userId || !roleId) {
            result = { ok: false, error: "Guild ID, User ID, or Role ID missing." };
          } else {
            await api.discordAssignRole(guildId, userId, roleId);
            result = { ok: true };
          }
        } else if (tc.tool === "discord_remove_role") {
          const guildId = getStringArg(tc.args, "guild_id");
          const userId = getStringArg(tc.args, "user_id");
          const roleId = getStringArg(tc.args, "role_id");
          if (!guildId || !userId || !roleId) {
            result = { ok: false, error: "Guild ID, User ID, or Role ID missing." };
          } else {
            await api.discordRemoveRole(guildId, userId, roleId);
            result = { ok: true };
          }
        } else if (tc.tool === "discord_get_guilds") {
          const guilds = await api.discordGetGuilds();
          result = { ok: true, guilds };
        } else if (tc.tool === "discord_send_dm") {
          const userId = getStringArg(tc.args, "user_id");
          const message = getStringArg(tc.args, "message");
          if (!userId || !message) {
            result = { ok: false, error: "User ID or message missing." };
          } else {
            const status = await api.discordSendDm(userId, message);
            result = { ok: true, message: status };
          }
        } else if (tc.tool === "discord_send_channel_message") {
          const guildId = getStringArg(tc.args, "guild_id");
          const channelName = getStringArg(tc.args, "channel_name");
          const message = getStringArg(tc.args, "message");
          if (!guildId || !channelName || !message) {
            result = { ok: false, error: "Guild ID, channel name, or message missing." };
          } else {
            const status = await api.discordSendChannelMessage(guildId, channelName, message);
            result = { ok: true, message: status };
          }
        } else if (tc.tool === "discord_get_channels") {
          const guildId = getStringArg(tc.args, "guild_id");
          if (!guildId) {
            result = { ok: false, error: "Guild ID missing." };
          } else {
            const channelsVal = await api.discordGetChannels(guildId);
            if (Array.isArray(channelsVal)) {
              let list = "Here are the channels in this server:\n";
              for (const c of channelsVal) {
                if (c.name) {
                  const typeStr = c.type === 0 ? "text" : c.type === 2 ? "voice" : c.type === 4 ? "category" : c.type === 5 ? "announcement" : "other";
                  list += `- **#${c.name}** (ID: \`${c.id}\`, Type: ${typeStr})\n`;
                }
              }
              result = { ok: true, message: list };
            } else {
              result = { ok: true, message: "Could not retrieve channel list." };
            }
          }
        } else if (tc.tool === "set_discord_behaviour_channel") {
          const channelId = getStringArg(tc.args, "channel_id");
          if (!channelId) {
            result = { ok: false, error: "Channel ID missing." };
          } else {
            const status = await api.setDiscordBehaviourChannel(channelId);
            result = { ok: true, message: status };
          }
        } else if (tc.tool === "get_user_behaviour") {
          const userId = getStringArg(tc.args, "user_id");
          if (!userId) {
            result = { ok: false, error: "User ID missing." };
          } else {
            const analysis = await api.getUserBehaviour(userId);
            result = { ok: true, message: analysis };
          }
        } else if (tc.tool === "get_status") {
          const status = await api.getSystemStatus();
          result = { ok: true, message: status };
        } else if (tc.tool === "send_to_cli_agent") {
          const agentName = getStringArg(tc.args, "agent_name");
          const prompt = getStringArg(tc.args, "prompt");
          const projectName = getStringArg(tc.args, "project_name") || undefined;
          if (!agentName || !prompt) {
            result = { ok: false, error: "Agent name or prompt missing." };
          } else {
            try {
              const projectSuffix = projectName ? ` in project "${projectName}"` : "";
              await api.sendToCLIAgent(agentName, prompt, projectName);
              result = { ok: true, message: `Task sent to ${agentName}${projectSuffix}. I'll notify you when it completes.` };
            } catch (e) {
              result = { ok: false, error: getErrorMessage(e) };
            }
          }
        } else if (tc.tool === "get_cli_agents_status") {
          try {
            const agents = await api.getCLIAgentsStatus();
            const lines = agents.map((a) => {
              const statusIcon =
                a.status === "running"
                  ? "🔄"
                  : a.status === "completed"
                    ? "✅"
                    : a.status === "failed"
                      ? "❌"
                      : a.status === "not_found"
                        ? "⚠️"
                        : "💤";
              const taskStr = a.current_task ? ` (working on: ${a.current_task.slice(0, 60)})` : "";
              return `${statusIcon} **${a.display_name}**: ${a.status}${taskStr}`;
            });
            result = { ok: true, message: `**CLI Agent Status:**\n${lines.join("\n")}` };
          } catch (e) {
            result = { ok: false, error: getErrorMessage(e) };
          }
        } else {
          result = { ok: false, error: `Tool "${tc.tool}" is not implemented.` };
        }

followUpMessages.push({
          role: "assistant",
          content: buildToolReply(tc, result),
        });
        if (result.ok) {
          lastToolResultRef.current = {
            tool: tc.tool,
            status: `${tc.tool} succeeded`,
          };
          // Record tool usage for learning — fire-and-forget
          api.recordToolUsage(
            tc.tool,
            JSON.stringify(tc.args).slice(0, 200),
          ).catch((e) => console.warn("[LEARNER] Failed to record usage:", e));
        }
      } catch (error) {
        console.error(`[TOOL] Tool "${tc.tool}" threw an error:`, error);
        console.error(
          `[TOOL] Error details:`,
          JSON.stringify(error, Object.getOwnPropertyNames(error)),
        );
        const reason = getErrorMessage(error);
        const errorMessage =
          tc.tool === "send_whatsapp_message"
            ? `Failed to send WhatsApp message to ${getStringArg(tc.args, "recipient") || "recipient"}: ${reason}`
            : reason;
        followUpMessages.push({
          role: "assistant",
          content: errorMessage,
        });
      }
    }

    setCurrentTask(null);
    if (successfulWhatsAppRecipients.length > 0 && successfulWhatsAppMessage) {
      chatActionMemoryRef.current = {
        ...chatActionMemoryRef.current,
        whatsapp: {
          recipients: [...new Set(successfulWhatsAppRecipients)],
          message: successfulWhatsAppMessage,
        },
      };
    }
    setMessages((prev) => {
      const nextMessages = [
        ...replacePendingToolMessage(prev),
        ...followUpMessages,
      ];
      messagesRef.current = nextMessages;
      return nextMessages;
    });
    setIsGenerating(false);

    if (needsConfigRefresh && onConfigUpdate) {
      try {
        await onConfigUpdate();
      } catch {
        // Ignore refresh failures; the save already completed.
      }
    }
  };

  const handleSend = async (overrideInput?: string) => {
    const textToSend = overrideInput !== undefined ? overrideInput : input;
    if (!textToSend.trim() || isGenerating) return;

    isVoiceSessionRef.current = overrideInput !== undefined;

    // Reset last spoken reference on new query submission
    if (typeof lastSpokenRef !== "undefined") {
      lastSpokenRef.current = null;
    }
    if (typeof stopSpeaking !== "undefined") {
      stopSpeaking();
    }

    const trimmedInput = textToSend.trim();
    console.log("[CHAT] User prompt:", trimmedInput);
    if (/^(clear|clear chat)$/i.test(trimmedInput)) {
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
      // Also wipe the persisted summary so the next session starts clean
      const clearedMemory = { ...userMemory, conversation_summary: "" };
      setUserMemory(clearedMemory);
      try {
        await api.updateUserMemory(clearedMemory);
      } catch (e) {
        console.error("[MEMORY] Failed to clear conversation summary:", e);
      }
      return;
    }

    if (
      pendingToolExecutionRef.current &&
      /^(yes|yeah|yep|ok|okay|sure|do it|go ahead|send|yes send|please do)\s*$/i.test(
        trimmedInput,
      )
    ) {
      await handleToolBatch(pendingToolExecutionRef.current);
      pendingToolExecutionRef.current = null;
      setInput("");
      return;
    }

    lastExecutedToolCallRef.current = null;
    emptyResponseRetryCountRef.current = 0;
    // Clear the tool result ref after consuming — it was already used in the
    // previous buildConversationHistory call. Keeping it poisons the next turn
    // because the model sees stale tool results alongside earlier assistant text.
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
    } else if (/^(?:clear|reset) my name$/i.test(trimmedInput)) {
      const updatedMemory = { ...userMemory, name: null };
      setUserMemory(updatedMemory);
      memoryForTurn = updatedMemory;
      await api.updateUserMemory(updatedMemory);
      console.log("[MEMORY] Cleared user name.");
    }

    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput("");

    const textarea = document.querySelector(
      ".chat-input",
    ) as HTMLTextAreaElement;
    if (textarea) textarea.style.height = "auto";

    setIsGenerating(true);
    setCurrentTask(null);

    const latestIntent = detectActionIntent(trimmedInput, messagesRef.current);
    latestIntentRef.current = latestIntent;

    // We no longer do manual extraction here.
    // We let the model handle the intent and tool generation.
    try {
      // Fetch relevant skills based on user input — fire but don't block
      let relevantSkills: import("../lib/api").Skill[] = [];
      try {
        relevantSkills = await api.findRelevantSkills(trimmedInput);
      } catch (_) { /* non-critical */ }

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

      // Update the user message in React state to include the context (keeps cache matching across turns)
      if (historyResult.messages.length > 0) {
        const lastModifiedMsg = historyResult.messages[historyResult.messages.length - 1];
        if (lastModifiedMsg.role === "user") {
          setMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i -= 1) {
              if (next[i].role === "user") {
                next[i] = {
                  ...next[i],
                  content: lastModifiedMsg.content,
                };
                break;
              }
            }
            messagesRef.current = next;
            return next;
          });
        }
      }

      console.log(
        "[DEBUG] Sending conversation history to model (omitted system prompt for readability)."
      );
      awaitingModelResponseRef.current = true;
      await api.sendChatMessage(config.selected_model, historyResult.messages);
    } catch (e) {
      console.error("[CHAT] sendChatMessage threw an error:", e);
      awaitingModelResponseRef.current = false;
      setCurrentTask(null);
      setIsGenerating(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    setInput(textarea.value);
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

  // Speak assistant response when generation is finished
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
    <div className="chat-main">
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

            if (msg.role === "assistant" && !assistantContent) {
              return null;
            }

            return (
              <div key={i} className={`message ${msg.role}`}>
                {msg.role === "assistant" ? assistantContent : cleanUserMessageForDisplay(msg.content)}
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
              aria-label={isListening ? "Stop listening" : "Start voice command"}
            >
              {isListening ? <Mic size={16} /> : <MicOff size={16} />}
            </button>
          )}
          <textarea
            className="chat-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={isListening ? "Listening to command…" : "Ask a question..."}
            rows={1}
            style={{ height: "auto", minHeight: "24px" }}
          />
          <button
            type="button"
            className="send-btn"
            onClick={() => handleSend()}
            disabled={(!input.trim() && !isListening) || isGenerating}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
