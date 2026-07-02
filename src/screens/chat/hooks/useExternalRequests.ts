import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { api, AppConfig, ChatMessage, UserMemory } from "../../../lib/api";
import {
  buildConversationHistory,
  buildToolReply,
  detectActionIntent,
  extractToolCalls,
  stripToolCalls,
} from "../../chatLogic";
import { executeSingleTool } from "../toolExecutor";
import { mightBeMultiStep, decomposeTask } from "../taskPlanner";
import { useHarness } from "./useHarness";

/**
 * Listens for `request-external-reply` events (incoming WhatsApp / Discord
 * messages that need an AI-generated reply) and submits the response back
 * to the backend via `submit_external_reply`.
 */
export function useExternalRequests(
  userMemoryRef: React.MutableRefObject<UserMemory>,
  configRef: React.MutableRefObject<AppConfig>,
  onConfigUpdateRef: React.MutableRefObject<(() => void) | undefined>,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  messagesRef: React.MutableRefObject<ChatMessage[]>,
) {
  const { executePlan } = useHarness(configRef.current);

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
        const { request_id, platform, contact_name, user_message, is_owner } =
          event.payload;

        console.log(
          `[EXTERNAL_REQUEST] Received request ${request_id} from ${platform} (sender: ${contact_name}, is_owner: ${is_owner})`,
        );

        try {
          if (is_owner && mightBeMultiStep(user_message)) {
            const plan = await decomposeTask(user_message);
            if (plan) {
              console.log("[EXTERNAL_REQUEST] Using planner for:", user_message);
              let finalReply = "";
              await executePlan(
                plan,
                (_updatedPlan) => {},
                (msg) => {
                  finalReply += msg + "\n";
                }
              );
              
              if (onConfigUpdateRef.current) {
                try {
                  await onConfigUpdateRef.current();
                } catch {}
              }

              const planReply = finalReply.trim() || "✓ All tasks completed.";
              
              const newMessages: ChatMessage[] = [
                { role: "user", content: `[${platform}] ${contact_name}: ${user_message}` },
                { role: "assistant", content: planReply }
              ];
              setMessages(prev => {
                const next = [...prev, ...newMessages];
                messagesRef.current = next;
                return next;
              });

              await invoke("submit_external_reply", {
                requestId: request_id,
                reply: planReply,
              });
              return;
            }
          }

          const latestIntent = detectActionIntent(user_message);

          let relevantSkills: import("../../../lib/api").Skill[] = [];
          try {
            relevantSkills = await api.findRelevantSkills(user_message);
          } catch (_) {}

          const tempMessages: ChatMessage[] = [
            { role: "user", content: user_message },
          ];

          const historyResult = buildConversationHistory(
            tempMessages,
            userMemoryRef.current,
            latestIntent,
            undefined,
            {},
            relevantSkills.length > 0 ? relevantSkills : undefined,
            configRef.current.whatsapp_contacts,
          );

          const msgs = historyResult.messages;
          const msgCount = msgs.length;
          const totalChars = msgs.reduce((acc, m) => acc + (m.content?.length || 0), 0);
          const roles = msgs.map(m => m.role);
          await invoke("print_diag", { message: `[CHAT][DIAG] Command received: model=local, messages=${msgCount}, total_chars=${totalChars}, est_tokens=${Math.floor(totalChars / 4)}` });
          await invoke("print_diag", { message: `[CHAT][DIAG] Message roles: ${JSON.stringify(roles)}` });
          if (msgs.length > 0 && msgs[0].role === "system") {
              const sysContent = msgs[0].content || "";
              await invoke("print_diag", { message: `[CHAT][DIAG] System prompt length: ${sysContent.length} chars, preview: ${sysContent.slice(0, 150)}...` });
          }
          const usrMsg = msgs.find(m => m.role === "user");
          if (usrMsg) {
              await invoke("print_diag", { message: `[CHAT][DIAG] User message: ${usrMsg.content}` });
          }

          const response = await fetch(
            "http://127.0.0.1:4891/v1/chat/completions",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "local",
                messages: historyResult.messages,
                temperature: 0.7,
                stream: false,
              }),
            },
          );

          if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
          }
          
          await invoke("print_diag", { message: `[CHAT][DIAG] Response received, status=${response.status}, not streaming` });

          const data = await response.json();
          const rawReply = data.choices?.[0]?.message?.content || "";
          
          await invoke("print_diag", { message: `[CHAT][DIAG] Emitting chat-complete. Bot answered: ${rawReply}` });
          await invoke("print_diag", { message: `[CHAT][DIAG] Command finished OK` });
          console.log("[EXTERNAL_REQUEST] Raw reply:", rawReply);

          const toolCalls =
            latestIntent === "action"
              ? extractToolCalls(rawReply, user_message)
              : [];

          let finalReply = "";

          if (toolCalls.length > 0) {
            console.log(
              "[EXTERNAL_REQUEST] Action intent + tools found → executing tools",
            );
            const toolResults: string[] = [];
            const context = {
              successfulWhatsAppRecipients: [] as string[],
              successfulWhatsAppMessageRef: { current: "" },
              needsConfigRefreshRef: { current: false },
            };

            for (const tc of toolCalls) {
              try {
                await emit("app-log", {
                  level: "info",
                  message: `[DISCORD] Executing injected tool: ${tc.tool}`,
                });
                const res = await executeSingleTool(tc, context);
                await emit("app-log", {
                  level: "info",
                  message: `[DISCORD] Tool ${tc.tool} completed.`,
                });
                toolResults.push(buildToolReply(tc, res));
              } catch (err) {
                await emit("app-log", {
                  level: "error",
                  message: `[DISCORD] Error executing ${tc.tool}: ${err}`,
                });
                toolResults.push(`Error executing ${tc.tool}: ${err}`);
              }
            }

            if (
              context.needsConfigRefreshRef.current &&
              onConfigUpdateRef.current
            ) {
              try {
                await onConfigUpdateRef.current();
              } catch {}
            }

            finalReply = toolResults.join("\n");
          } else {
            finalReply = stripToolCalls(rawReply).trim();
          }

          const newMessages: ChatMessage[] = [
            { role: "user", content: `[${platform}] ${contact_name}: ${user_message}` },
            { role: "assistant", content: finalReply }
          ];
          setMessages(prev => {
            const next = [...prev, ...newMessages];
            messagesRef.current = next;
            return next;
          });

          await invoke("submit_external_reply", {
            requestId: request_id,
            reply: finalReply,
          });
        } catch (err) {
          console.error(
            "[EXTERNAL_REQUEST] Failed to process request:",
            err,
          );
          try {
            await invoke("submit_external_reply", {
              requestId: request_id,
              reply:
                "Sorry, I encountered an error while processing that request.",
            });
          } catch (invokeErr) {
            console.error(
              "[EXTERNAL_REQUEST] Failed to submit error reply:",
              invokeErr,
            );
          }
        }
      });
      if (!active) {
        u();
      } else {
        unsubExternal = u;
      }
    };

    setupExternalListener();

    return () => {
      active = false;
      if (unsubExternal) unsubExternal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
