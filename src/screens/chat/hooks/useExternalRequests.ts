import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api, AppConfig, ChatMessage, UserMemory } from "../../../lib/api";
import {
  buildConversationHistory,
  buildToolReply,
  detectActionIntent,
  extractToolCalls,
  stripToolCalls,
} from "../../chatLogic";
import { executeSingleTool } from "../toolExecutor";

/**
 * Listens for `request-external-reply` events (incoming WhatsApp / Discord
 * messages that need an AI-generated reply) and submits the response back
 * to the backend via `submit_external_reply`.
 */
export function useExternalRequests(
  userMemoryRef: React.MutableRefObject<UserMemory>,
  configRef: React.MutableRefObject<AppConfig>,
  onConfigUpdateRef: React.MutableRefObject<(() => void) | undefined>,
) {
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

          const data = await response.json();
          const rawReply = data.choices?.[0]?.message?.content || "";
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
                const res = await executeSingleTool(tc, context);
                toolResults.push(buildToolReply(tc, res));
              } catch (err) {
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
      unsubExternal = u;
    };

    setupExternalListener();

    return () => {
      active = false;
      if (unsubExternal) unsubExternal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
