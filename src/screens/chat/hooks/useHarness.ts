import { useRef, useCallback } from "react";
import { api, AppConfig, ChatMessage } from "../../../lib/api";
import { TaskPlan, TaskStep } from "../taskPlanner";
import { buildActionSystemPrompt, getActionFewShots } from "../../../tools";
import { extractToolCalls, ToolCall } from "../../chatLogic";
import { executeSingleTool } from "../toolExecutor";

export function useHarness(config: AppConfig) {
  const abortRef = useRef(false);

  const executePlan = useCallback(
    async (
      plan: TaskPlan,
      onStepUpdate: (plan: TaskPlan) => void,
      onChatMessage: (msg: string) => void,
    ): Promise<void> => {
      abortRef.current = false;

      const live: TaskPlan = {
        ...plan,
        steps: plan.steps.map((s) => ({ ...s })),
        generatedContent: { ...plan.generatedContent },
      };

      // Phase 1: Generation steps (sequential due to frontend LLM event listener constraints)
      for (let i = 0; i < live.steps.length; i++) {
        if (abortRef.current) break;
        const step = live.steps[i];
        if (step.category !== "generation") continue;

        live.steps[i] = { ...step, status: "running" };
        onStepUpdate({ ...live, steps: [...live.steps] });

        try {
          const result = await runGenerationStep(step, config);
          const key = extractContentKey(step.prompt);
          live.generatedContent[key] = result;
          live.steps[i] = { ...step, status: "done", result };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          live.steps[i] = { ...step, status: "error", result: msg };
          onChatMessage(`✗ ${step.label}: ${msg}`);
        }
        onStepUpdate({ ...live, steps: [...live.steps] });
      }

      if (abortRef.current) return;

      // Phase 2: Action steps (Batched into a single LLM call for speed!)
      const actionIndices = live.steps
        .map((s, i) => (s.category !== "generation" ? i : -1))
        .filter((i) => i !== -1);
      const actionSteps = actionIndices.map((i) => live.steps[i]);

      if (actionSteps.length > 0) {
        for (const i of actionIndices) {
          live.steps[i] = { ...live.steps[i], status: "running" };
        }
        onStepUpdate({ ...live, steps: [...live.steps] });

        try {
          const result = await runActionSteps(actionSteps, live, config);
          if (!result.ok) {
            for (const i of actionIndices) {
              live.steps[i] = { ...live.steps[i], status: "error", result: result.message };
            }
            onChatMessage(`✗ Actions: ${result.message || "failed"}`);
          } else {
            // Execute the resulting tools sequentially
            for (const call of result.toolCalls) {
              if (abortRef.current) break;
              const res = await executeTool(call);
              if (!res.ok) {
                onChatMessage(`✗ ${call.tool}: ${res.message || "failed"}`);
              }
            }
            // Mark all action steps as done
            for (const i of actionIndices) {
              live.steps[i] = { ...live.steps[i], status: "done", result: "Completed" };
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          for (const i of actionIndices) {
            live.steps[i] = { ...live.steps[i], status: "error", result: msg };
          }
          onChatMessage(`✗ Actions failed: ${msg}`);
        }
        onStepUpdate({ ...live, steps: [...live.steps] });
      }
    },
    [config],
  );

  return { executePlan };
}

// ---- Helpers ----

/** Extract a short key from a generation instruction for storing in generatedContent */
function extractContentKey(prompt: string): string {
  const m = prompt.match(
    /\b(haiku|poem|rhyme|joke|quote|story|caption|note|essay|song|rap|letter|limerick|pun)\b/i,
  );
  return m ? m[1].toLowerCase() : "content";
}

/**
 * Generation step: minimal 2-message call.
 * System: "output only the content"
 * User: the instruction from the plan
 */
async function runGenerationStep(
  step: TaskStep,
  config: AppConfig,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a creative writing assistant. Output ONLY the requested content itself. No preamble, no explanation, no quotes.",
    },
    { role: "user", content: step.prompt },
  ];
  return callLLM(config.selected_model, messages);
}

/**
 * Batched Action steps: One LLM call for all actions to save time.
 */
async function runActionSteps(
  steps: TaskStep[],
  plan: TaskPlan,
  config: AppConfig,
): Promise<{ ok: boolean; message?: string; toolCalls: ToolCall[] }> {
  const categories = Array.from(new Set(steps.map((s) => s.category)));
  const systemPrompt = buildActionSystemPrompt("", categories);
  const fewShots = getActionFewShots(categories);

  const generatedStr = Object.values(plan.generatedContent).join("\n\n");
  const needsGeneratedContent = steps.some(
    (s) => !!generatedStr && /\b(send|post|email|message|dm)\b/i.test(s.prompt),
  );

  const contextBlock = needsGeneratedContent
    ? `[Generated content:\n${generatedStr}]\n\nIMPORTANT: If the task is to send or post the generated content, you MUST use the exact string "{generated_content}" as the message argument. Do NOT write out the text itself. Example: message="{generated_content}"\n\n`
    : "";

  const taskPrompt = steps
    .map((s) => {
      const needs = !!generatedStr && /\b(send|post|email|message|dm)\b/i.test(s.prompt);
      return needs
        ? `${s.prompt} (CRITICAL: Use the exact string "{generated_content}" for the message/post argument!)`
        : s.prompt;
    })
    .join("\nAND\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `${contextBlock}${fewShots}\n\nTask: ${taskPrompt}\nPlan:\n`,
    },
  ];

  const response = await callLLM(config.selected_model, messages);
  const toolCalls = extractToolCalls(response, plan.originalRequest);

  if (toolCalls.length === 0) {
    return { ok: false, message: `No tool calls found for the requested actions.`, toolCalls: [] };
  }

  if (needsGeneratedContent) {
    for (const call of toolCalls) {
      for (const key in call.args) {
        if (
          typeof call.args[key] === "string" &&
          call.args[key] === "{generated_content}"
        ) {
          call.args[key] = generatedStr;
        }
      }
    }
  }

  return { ok: true, toolCalls };
}

async function executeTool(
  call: ToolCall,
): Promise<{ ok: boolean; message?: string }> {
  const ctx = {
    successfulWhatsAppRecipients: [] as string[],
    successfulWhatsAppMessageRef: { current: "" },
    needsConfigRefreshRef: { current: false },
  };
  try {
    const result = await executeSingleTool(call, ctx);
    return { ok: result.ok ?? false, message: result.message || result.error };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** One-shot LLM call: resolves with the full response text. */
function callLLM(model: string, messages: ChatMessage[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    let settled = false;

    api
      .onChatToken((t) => {
        text += t;
      })
      .then((unsubToken) => {
        api
          .onChatComplete(() => {
            unsubToken();
            if (!settled) {
              settled = true;
              resolve(text.trim());
            }
          })
          .then((unsubComplete) => {
            api.sendChatMessage(model, messages).catch((e) => {
              unsubComplete();
              if (!settled) {
                settled = true;
                reject(e);
              }
            });
          })
          .catch(reject);
      })
      .catch(reject);
  });
}
