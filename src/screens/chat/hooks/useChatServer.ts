import { useEffect } from "react";
import { api, AppConfig } from "../../../lib/api";

/**
 * Initializes the local llama.cpp AI server on mount and when the
 * selected model changes. Handles health-check, auto-start, and
 * fallback to onboarding if the engine is not installed.
 */
export function useChatServer(
  config: AppConfig,
  onConfigUpdate?: () => void,
) {
  useEffect(() => {
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
}
