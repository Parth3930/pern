/// Shared tool definitions used across all platforms (Discord, WhatsApp, Frontend, Tests).
/// Mirrors src-tauri/src/tools.rs
import {
  TOOLS,
  ALIAS_MAP,
  FEW_SHOTS,
  RULES,
  DISCORD_TOOLS_WITH_GUILD_ID,
  TOOL_DESCRIPTIONS,
  TOOL_PARAMS,
} from "./tools_data";

export type ToolName = typeof TOOLS[number]["name"];
export type ToolArgs = Record<string, unknown>;

export interface ToolCall {
  tool: ToolName | string;
  args: Record<string, unknown>;
}

/** All canonical tool names */
export const ALL_TOOL_NAMES: ToolName[] = TOOLS.map((t) => t.name) as ToolName[];

export { DISCORD_TOOLS_WITH_GUILD_ID, TOOL_DESCRIPTIONS, TOOL_PARAMS };

/** Tool signatures for the action prompt */
function getToolSignatures(categories?: string[]): string {
  const filtered =
    !categories || categories.length === 0
      ? TOOLS
      : TOOLS.filter((t) => categories.includes(t.category));

  return filtered.map((t) => t.signature).join("\n");
}

/**
 * Clean a potentially hallucinated tool name into its canonical form.
 * Mirrors src-tauri/src/tools.rs clean_tool_name
 */
export function cleanToolName(tool: string): string {
  const t = tool.trim().toLowerCase();

  if (t in ALIAS_MAP) {
    return ALIAS_MAP[t as keyof typeof ALIAS_MAP];
  }

  // Fuzzy matches
  if (t.includes("behaviour_channel")) return "set_discord_behaviour_channel";
  if (t.includes("user_behaviour")) return "get_user_behaviour";
  if (t.includes("cli_agents_status")) return "get_cli_agents_status";
  if (t.includes("cli_agent") && t.startsWith("send_"))
    return "send_to_cli_agent";
  if (t === "whatsapp_message" || t === "send_whatsapp")
    return "send_whatsapp_message";
  if (/^send_message_to_/.test(t) || /^ask_/.test(t)) return "send_whatsapp_message";
  if (t === "email" || t === "send_mail") return "send_email";
  if (t === "whatsapp_auto_reply" || t === "whatsapp_auto")
    return "set_whatsapp_auto_reply";

  // If it's a known discord tool without the prefix
  for (const suffix of DISCORD_TOOLS_WITH_GUILD_ID) {
    const shortSuffix = suffix.startsWith("discord_") ? suffix.slice(8) : suffix;
    if (t === shortSuffix || t === suffix) {
      return suffix;
    }
  }

  return tool;
}

/** Parse value string to appropriate type (bool, null, number, or string) */
function parseValue(valStr: string): unknown {
  const trimmed = valStr.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null" || lower === "none" || trimmed === "") return null;
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") return num;
  return trimmed;
}

function hasUnquotedEquals(s: string): boolean {
  let inQuotes = false;
  let quoteChar = " ";
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
    } else if (c === "\\" && inQuotes) {
      escaped = true;
    } else if ((c === '"' || c === "'") && (!inQuotes || c === quoteChar)) {
      inQuotes = !inQuotes;
      quoteChar = inQuotes ? c : " ";
    } else if (!inQuotes && c === "=") {
      return true;
    }
  }
  return false;
}

/**
 * Parse plan-format response (lines starting with "- tool(args)") into typed tool calls.
 * Mirrors src-tauri/src/tools.rs parse_plan_to_tool_calls
 */
export function parsePlanToToolCalls(
  planText: string,
  guildId: string,
): ToolCall[] {
  let contentToParse = planText;

  // Try <plan> tags first
  const planStartTag = planText.indexOf("<plan>");
  const planEndTag = planText.indexOf("</plan>");
  if (planStartTag !== -1 && planEndTag !== -1 && planEndTag > planStartTag) {
    contentToParse = planText.slice(planStartTag + 6, planEndTag).trim();
  } else if (planStartTag !== -1) {
    contentToParse = planText.slice(planStartTag + 6).trim();
  } else {
    const planHeader = planText.indexOf("Plan:");
    if (planHeader !== -1) {
      contentToParse = planText.slice(planHeader + 5).trim();
    }
  }

  const toolCalls: ToolCall[] = [];
  if (
    contentToParse.includes("conversational") &&
    !contentToParse.includes("(")
  ) {
    return [];
  }

  // Preprocess single-line multi-tool calls into multiple lines
  contentToParse = contentToParse.replace(
    /\)\s*(?:,\s*|;\s*|and\s+)?-?\s*([a-zA-Z_]\w*)\(/g,
    ")\n- $1(",
  );

  const lines = contentToParse.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:-\s*)?([\w_]+)\s*\((.*)\)/);
    if (!match) continue;

    const tool = cleanToolName(match[1]);
    if (tool === "conversational") continue;

    // Detect multiplier at the end of the line (e.g. (x3) or (×2))
    const multMatch = trimmed.match(
      /\((?:[x×\*\s]*|times\s*|repeat\s*)(\d+)\s*\)\s*$/i,
    );
    const count = multMatch ? parseInt(multMatch[1], 10) : 1;

    const argsText = match[2].replace(
      /\s*\((?:[x×\*\s]*|times\s*|repeat\s*)\d+\s*\)\s*$/i,
      "",
    );
    const args: Record<string, unknown> = {};

    if (hasUnquotedEquals(argsText)) {
      // Parse "key = value" pairs
      const argRegex =
        /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|True|False|null|None|none|\d+)/g;
      let argMatch;
      while ((argMatch = argRegex.exec(argsText)) !== null) {
        const key = argMatch[1];
        let valStr = argMatch[2];
        let val: unknown;

        if (valStr.startsWith('"') && valStr.endsWith('"')) {
          val = valStr.slice(1, -1).replace(/\\"/g, '"');
        } else if (valStr.startsWith("'") && valStr.endsWith("'")) {
          val = valStr.slice(1, -1).replace(/\\'/g, "'");
        } else {
          val = parseValue(valStr);
        }
        // Clean user_id if present
        if (key === "user_id" && typeof val === "string") {
          val = val.replace(/[<@>]/g, "");
        }
        args[key] = val;
      }
    } else {
      // Positional fallback
      const valueRegex =
        /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|True|False|null|None|none|[+-]?\d+(?:\.\d+)?|[a-zA-Z_]\w*/g;
      let valMatch;
      const posValues: unknown[] = [];
      while ((valMatch = valueRegex.exec(argsText)) !== null) {
        const valStr = valMatch[0];
        let val: unknown;
        if (valStr.startsWith('"') && valStr.endsWith('"')) {
          val = valStr.slice(1, -1).replace(/\\"/g, '"');
        } else if (valStr.startsWith("'") && valStr.endsWith("'")) {
          val = valStr.slice(1, -1).replace(/\\'/g, "'");
        } else {
          val = parseValue(valStr);
        }
        posValues.push(val);
      }

      const paramNames = (TOOL_PARAMS as Record<string, readonly string[]>)[tool] || [];
      for (let i = 0; i < posValues.length && i < paramNames.length; i++) {
        let val = posValues[i];
        const key = paramNames[i];
        if (key === "user_id" && typeof val === "string") {
          val = val.replace(/[<@>]/g, "");
        }
        args[key] = val;
      }
    }

    // Auto-inject guild_id for Discord tools that need it
    if ((DISCORD_TOOLS_WITH_GUILD_ID as readonly string[]).includes(tool)) {
      args.guild_id = guildId;
    }

    // Default missing optional values
    if (tool === "discord_kick" && !("reason" in args)) args.reason = null;
    if (tool === "discord_ban") {
      if (!("reason" in args)) args.reason = null;
      if (!("delete_message_seconds" in args)) args.delete_message_seconds = 0;
    }
    if (tool === "discord_mute" && !("reason" in args)) args.reason = null;

    for (let c = 0; c < count; c++) {
      toolCalls.push({ tool, args: { ...args } });
    }
  }

  // Expand block repetitions such as "again", "do that {n} more times",
  // "repeat {n} times", "do once more", etc.
  const expanded: ToolCall[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    expanded.push(toolCalls[i]);
  }

  const firstTool = expanded[0];
  if (firstTool && firstTool.tool === "conversational" && expanded.length > 1) {
    return expanded.slice(1);
  }

  return expanded;
}

/**
 * Build the shared action system prompt used by all platforms.
 * Mirrors src-tauri/src/tools.rs build_action_system_prompt
 */
export function buildActionSystemPrompt(
  memoryContext: string,
  categories?: string[],
): string {
  const cats = categories || [];
  const has = (c: string) => cats.includes(c);

  const rules: string[] = [];
  
  // Header rules (first two rules)
  const headerRules = RULES.slice(0, 2);
  for (const rule of headerRules) {
    rules.push(rule.text);
  }
  
  rules.push("");
  rules.push("IMPORTANT RULES:");

  // Remaining rules
  const remainingRules = RULES.slice(2);
  for (const rule of remainingRules) {
    const isApplicable = rule.categories.length === 0 || rule.categories.some((cat) => cats.includes(cat));
    if (isApplicable) {
      rules.push(rule.text);
    }
  }

  if (has("todos")) {
    const now = new Date();
    const formatLocalISO = (d: Date) => {
      const pad = (num: number) => num.toString().padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const localNow = formatLocalISO(now);
    const localPlus2 = formatLocalISO(
      new Date(now.getTime() + 2 * 60 * 60 * 1000),
    );
    const localPlus1 = formatLocalISO(
      new Date(now.getTime() + 1 * 60 * 60 * 1000),
    );
    const tomorrow9 = new Date();
    tomorrow9.setDate(tomorrow9.getDate() + 1);
    tomorrow9.setHours(9, 0, 0, 0);
    const localTomorrow9 = formatLocalISO(tomorrow9);

    rules.push(`13. TODO TIME AND REPEAT RULES:`);
    rules.push(
      `    - When resolving relative times like "in next 2 hrs", "in 30 mins", calculate the target local time by adding that duration to the current local time.`,
    );
    rules.push(
      `    - Remove relative time expressions (e.g., "in next 2 hrs", "tomorrow at 9am", "in 30 mins") from the todo text, keeping only the clean task description.`,
    );
    rules.push(
      `    - NEVER set repeat_hours for relative offsets like "in next X hrs" or "in Y mins". repeat_hours must ONLY be set when the user explicitly requests a repeating interval, such as "every 2 hours" or "daily".`,
    );
    rules.push(
      `    - Output the time in local ISO format WITHOUT timezone suffix/offset (do NOT append 'Z' or '+05:30'). For example, given the current local time is "${localNow}":`,
    );
    rules.push(
      `      * "add a todo for drinking water in next 2 hrs" -> add_todo(text="drinking water", time="${localPlus2}", repeat_hours=null)`,
    );
    rules.push(
      `      * "remind me to check emails in 1 hour" -> add_todo(text="check emails", time="${localPlus1}", repeat_hours=null)`,
    );
    rules.push(
      `      * "add a repeating todo to walk the dog every 24 hours starting tomorrow at 9 AM" -> add_todo(text="walk the dog", time="${localTomorrow9}", repeat_hours=24)`,
    );
  }

  return [
    ...rules,
    "",
    getToolSignatures(categories),
    ``,
    `Owner context: ${memoryContext}`,
  ].join("\n");
}

/** Check if a tool name is a valid canonical tool name */
export function isToolName(value: unknown): value is ToolName {
  return (
    typeof value === "string" && ALL_TOOL_NAMES.includes(value as ToolName)
  );
}


/** Get the unified action few-shot examples as a string. */
export function getActionFewShots(categories?: string[]): string {
  if (!categories || categories.length === 0) {
    return FEW_SHOTS.slice(0, 4).map((e) => e.text).join("\n\n");
  }
  
  const selected: any[] = [];
  const added = new Set<string>();

  // 1. Force at least one example for each requested category
  for (const cat of categories) {
    const example = FEW_SHOTS.find(e => (e.categories as readonly string[]).includes(cat) && !added.has(e.text));
    if (example) {
      selected.push(example);
      added.add(example.text);
    }
  }

  // 2. Fill the remaining slots up to 4 with other matching examples,
  // but ONLY include category-specific ones (ignore length === 0 filler)
  for (const e of FEW_SHOTS) {
    if (selected.length >= 4) break;
    if (!added.has(e.text) && (e.categories as readonly string[]).some(c => categories.includes(c))) {
      selected.push(e);
      added.add(e.text);
    }
  }

  return selected.map((e) => e.text).join("\n\n");
}
