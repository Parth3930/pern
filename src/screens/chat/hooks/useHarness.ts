/**
 * useHarness.ts
 * Executes a TaskPlan step by step with surgical context.
 *
 * Each step gets ONLY what it needs:
 * - generation steps: tiny creative prompt, no tools, no history
 * - action steps: just that category's tool signatures + generated content
 *
 * ponytail: no state machine, no graph. Sequential async loop.
 */

import { useRef, useCallback } from "react";
import { api, AppConfig, ChatMessage } from "../../../lib/api";
import { TaskPlan, TaskStep } from "../taskPlanner";
import { buildActionSystemPrompt, getActionFewShots } from "../../../tools";
import { extractToolCalls, ToolCall } from "../../chatLogic";
import { executeSingleTool } from "../toolExecutor";

export function useHarness(config: AppConfig) {
  const abortRef = useRef(false);

  const executePlan = useCallback(async (
    plan: TaskPlan,
    onStepUpdate: (plan: TaskPlan) => void,
    onChatMessage: (msg: string) => void,
  ): Promise<void> => {
    abortRef.current = false;

    const live: TaskPlan = {
      ...plan,
      steps: plan.steps.map(s => ({ ...s })),
      generatedContent: { ...plan.generatedContent },
    };

    for (let i = 0; i < live.steps.length; i++) {
      if (abortRef.current) break;

      const step = live.steps[i];
      live.steps[i] = { ...step, status: "running" };
      onStepUpdate({ ...live, steps: [...live.steps] });

      try {
        if (step.category === "generation") {
          const result = await runGenerationStep(step, config);
          const key = extractContentKey(step.prompt);
          live.generatedContent[key] = result;
          live.steps[i] = { ...step, status: "done", result };
        } else {
          const result = await runActionStep(step, live, config);
          live.steps[i] = { ...step, status: result.ok ? "done" : "error", result: result.message };
          if (!result.ok) {
            onChatMessage(`✗ ${step.label}: ${result.message || "failed"}`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        live.steps[i] = { ...step, status: "error", result: msg };
        onChatMessage(`✗ ${step.label}: ${msg}`);
      }

      onStepUpdate({ ...live, steps: [...live.steps] });
    }
  }, [config]);

  return { executePlan };
}

// ---- Helpers ----

/** Extract a short key from a generation instruction for storing in generatedContent */
function extractContentKey(prompt: string): string {
  const m = prompt.match(/\b(haiku|poem|rhyme|joke|quote|story|caption|note|essay|song|rap|letter|limerick|pun)\b/i);
  return m ? m[1].toLowerCase() : "content";
}

/**
 * Generation step: minimal 2-message call.
 * System: "output only the content"
 * User: the instruction from the plan
 */
async function runGenerationStep(step: TaskStep, config: AppConfig): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "You are a creative writing assistant. Output ONLY the requested content itself. No preamble, no explanation, no quotes.",
    },
    { role: "user", content: step.prompt },
  ];
  return callLLM(config.selected_model, messages);
}

/**
 * Action step: LLM gets only the relevant category's tool signatures + generated content.
 * No conversation history. No unrelated tools.
 */
async function runActionStep(
  step: TaskStep,
  plan: TaskPlan,
  config: AppConfig,
): Promise<{ ok: boolean; message?: string }> {
  const systemPrompt = buildActionSystemPrompt("", [step.category]);
  const fewShots = getActionFewShots([step.category]);

  // Inject generated content so the model can reference it (just the values)
  const generatedStr = Object.values(plan.generatedContent).join("\n\n");
  const needsGeneratedContent = !!generatedStr && /\b(send|post|email|message|dm)\b/i.test(step.prompt);
  const contextBlock = needsGeneratedContent
    ? `[Generated content:\n${generatedStr}]\n\nIMPORTANT: If the task is to send or post the generated content, you MUST use the exact string "{generated_content}" as the message argument. Do NOT write out the text itself. Example: message="{generated_content}"\n\n`
    : "";
  const taskPrompt = needsGeneratedContent
    ? `${step.prompt} (CRITICAL: Use the exact string "{generated_content}" for the message/post argument!)`
    : step.prompt;

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
    return { ok: false, message: `No tool call found for: ${step.label}` };
  }

  const call = toolCalls[0];
  
  if (needsGeneratedContent) {
    for (const key in call.args) {
      if (typeof call.args[key] === "string" && call.args[key] === "{generated_content}") {
        call.args[key] = generatedStr;
      }
    }
  }

  return executeTool(call);
}

async function executeTool(call: ToolCall): Promise<{ ok: boolean; message?: string }> {
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

    api.onChatToken((t) => { text += t; }).then((unsubToken) => {
      api.onChatComplete(() => {
        unsubToken();
        if (!settled) { settled = true; resolve(text.trim()); }
      }).then((unsubComplete) => {
        api.sendChatMessage(model, messages).catch((e) => {
          unsubComplete();
          if (!settled) { settled = true; reject(e); }
        });
      }).catch(reject);
    }).catch(reject);
  });
}
