/// Shared tool definitions used across all platforms (Discord, WhatsApp, Frontend, Tests).
/// Mirrors src-tauri/src/tools.rs

export type ToolName =
  | "launch_app"
  | "close_app"
  | "send_whatsapp_message"
  | "set_whatsapp_auto_reply"
  | "toggle_whatsapp_auto_reply"
  | "set_discord_status"
  | "discord_get_channels"
  | "discord_send_channel_message"
  | "send_email"
  | "save_email_config"
  | "add_whatsapp_contact"
  | "set_whatsapp_contact_auto_reply"
  | "toggle_whatsapp"
  | "discord_kick"
  | "discord_ban"
  | "discord_unban"
  | "discord_mute"
  | "discord_unmute"
  | "discord_warn"
  | "discord_delete_messages"
  | "discord_assign_role"
  | "discord_remove_role"
  | "discord_send_dm"
  | "discord_get_guilds"
  | "get_status"
  | "set_discord_behaviour_channel"
  | "get_user_behaviour"
  | "send_to_cli_agent"
  | "get_cli_agents_status"
  | "restart_system"
  | "shutdown_system";

export type ToolArgs = Record<string, unknown>;

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/** All canonical tool names */
export const ALL_TOOL_NAMES: ToolName[] = [
  "launch_app",
  "close_app",
  "send_whatsapp_message",
  "set_whatsapp_auto_reply",
  "toggle_whatsapp_auto_reply",
  "set_discord_status",
  "discord_get_channels",
  "discord_send_channel_message",
  "send_email",
  "save_email_config",
  "add_whatsapp_contact",
  "set_whatsapp_contact_auto_reply",
  "toggle_whatsapp",
  "discord_kick",
  "discord_ban",
  "discord_unban",
  "discord_mute",
  "discord_unmute",
  "discord_warn",
  "discord_delete_messages",
  "discord_assign_role",
  "discord_remove_role",
  "discord_send_dm",
  "discord_get_guilds",
  "get_status",
  "set_discord_behaviour_channel",
  "get_user_behaviour",
  "send_to_cli_agent",
  "get_cli_agents_status",
  "restart_system",
  "shutdown_system",
];

/** Discord tools that automatically get guild_id injected */
export const DISCORD_TOOLS_WITH_GUILD_ID: string[] = [
  "discord_get_channels",
  "discord_send_channel_message",
  "discord_kick",
  "discord_ban",
  "discord_unban",
  "discord_mute",
  "discord_unmute",
  "discord_warn",
  "discord_assign_role",
  "discord_remove_role",
];

/** Tool descriptions for the action system prompt */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  launch_app: 'Opens an app by name ("calculator", "notepad", "chrome", "discord").',
  close_app: 'Closes an app by name.',
  send_whatsapp_message: 'Sends WhatsApp message.',
  set_whatsapp_auto_reply: 'Enables (true) or disables (false) WhatsApp auto reply for recipient.',
  toggle_whatsapp_auto_reply: 'Toggles WhatsApp auto reply for recipient.',
  toggle_whatsapp: 'Toggles global WhatsApp auto-reply on/off.',
  set_discord_status: 'Sets bot status and activity.',
  discord_get_channels: 'Lists channels in a server.',
  discord_send_channel_message: 'Sends message to a server channel.',
  send_email: 'Sends email.',
  save_email_config: 'Saves SMTP config.',
  add_whatsapp_contact: 'Adds a contact to the allowed auto-reply list.',
  set_whatsapp_contact_auto_reply: 'Sets auto-reply for a WhatsApp contact.',
  discord_kick: 'Kicks user from server.',
  discord_ban: 'Bans user from server.',
  discord_unban: 'Unbans user.',
  discord_mute: 'Mutes user.',
  discord_unmute: 'Unmutes user.',
  discord_warn: 'Warns user via DM.',
  discord_delete_messages: 'Purges last count messages.',
  discord_assign_role: 'Assigns role to user.',
  discord_remove_role: 'Removes role from user.',
  discord_send_dm: 'Sends Discord DM to user.',
  discord_get_guilds: 'Lists Discord servers.',
  get_status: 'Gets system uptime and health.',
  set_discord_behaviour_channel: 'Sets behaviour log channel.',
  get_user_behaviour: 'Gets user behaviour log.',
  send_to_cli_agent: 'Runs CLI agent (agy, claude-code, codex, hermes, freebuff).',
  get_cli_agents_status: 'Gets CLI agents status.',
  restart_system: 'Restarts the system (computer).',
  shutdown_system: 'Shuts down the system (computer).',
};

/** Tool signatures for the action prompt */
export function getToolSignatures(categories?: string[]): string {
  const entries = [
    ["launch_app", "app_name: string", "system"],
    ["close_app", "app_name: string", "system"],
    ["send_whatsapp_message", "recipient: string, message: string", "whatsapp"],
    ["set_whatsapp_auto_reply", "recipient: string, enabled: boolean", "whatsapp"],
    ["toggle_whatsapp_auto_reply", "recipient: string", "whatsapp"],
    ["toggle_whatsapp", "enabled: boolean", "whatsapp"],
    ["set_discord_status", "status: string, activity: string", "discord"],
    ["discord_get_channels", "", "discord"],
    ["discord_send_channel_message", "channel_name: string, message: string", "discord"],
    ["send_email", "to: string, subject: string, body: string", "email"],
    ["save_email_config", "smtp_host: string, smtp_port: number, sender_email: string, smtp_password: string", "email"],
    ["add_whatsapp_contact", "name: string, number: string", "whatsapp"],
    ["discord_kick", "user_id: string, reason: string", "discord"],
    ["discord_ban", "user_id: string, reason: string, delete_message_seconds: number", "discord"],
    ["discord_unban", "user_id: string", "discord"],
    ["discord_mute", "user_id: string, duration_mins: number, reason: string", "discord"],
    ["discord_unmute", "user_id: string", "discord"],
    ["discord_warn", "user_id: string, reason: string", "discord"],
    ["discord_delete_messages", "channel_id: string, count: number", "discord"],
    ["discord_assign_role", "user_id: string, role_id: string", "discord"],
    ["discord_remove_role", "user_id: string, role_id: string", "discord"],
    ["discord_send_dm", "user_id: string, message: string", "discord"],
    ["discord_get_guilds", "", "discord"],
    ["get_status", "", "system"],
    ["set_discord_behaviour_channel", "channel_id: string", "discord"],
    ["get_user_behaviour", "user_id: string", "discord"],
    ["send_to_cli_agent", "agent_name: string, prompt: string, project_name: string", "agents"],
    ["get_cli_agents_status", "", "agents"],
    ["restart_system", "", "system"],
    ["shutdown_system", "", "system"],
  ] as const;

  const filtered = (!categories || categories.length === 0)
    ? entries
    : entries.filter(([, , cat]) => categories.includes(cat));

  return filtered
    .map(([name, args]) => `- ${name}(${args}) -> ${TOOL_DESCRIPTIONS[name]}`)
    .join("\n");
}

/**
 * Clean a potentially hallucinated tool name into its canonical form.
 * Mirrors src-tauri/src/tools.rs clean_tool_name
 */
export function cleanToolName(tool: string): string {
  const t = tool.trim().toLowerCase();

  // Known prefix hallucinations or exact mappings
  const exactMap: Record<string, string> = {
    "discord_set_discord_behaviour_channel": "set_discord_behaviour_channel",
    "discord_get_cli_agents_status": "get_cli_agents_status",
    "discord_get_status": "get_status",
    "discord_launch_app": "launch_app",
    "discord_close_app": "close_app",
    "discord_send_email": "send_email",
    "discord_send_whatsapp_message": "send_whatsapp_message",
    "discord_set_whatsapp_auto_reply": "set_whatsapp_auto_reply",
    "discord_toggle_whatsapp_auto_reply": "toggle_whatsapp_auto_reply",
    "send_whatsapp_auto_reply": "toggle_whatsapp_auto_reply",
    "discord_send_to_cli_agent": "send_to_cli_agent",
    "discord_get_user_behaviour": "get_user_behaviour",
    "discord_set_status": "set_discord_status",
    "discord_set_discord_status": "set_discord_status",
    // Omitted prefixes (short forms used by models)
    "kick": "discord_kick",
    "ban": "discord_ban",
    "unban": "discord_unban",
    "mute": "discord_mute",
    "unmute": "discord_unmute",
    "warn": "discord_warn",
    "assign_role": "discord_assign_role",
    "remove_role": "discord_remove_role",
    "delete_messages": "discord_delete_messages",
    "send_dm": "discord_send_dm",
    "get_channels": "discord_get_channels",
    "send_channel_message": "discord_send_channel_message",
    "get_guilds": "discord_get_guilds",
    "restart": "restart_system",
    "reboot": "restart_system",
    "shutdown": "shutdown_system",
    "poweroff": "shutdown_system",
  };

  if (exactMap[t]) {
    return exactMap[t];
  }

  // Fuzzy matches
  if (t.includes("behaviour_channel")) return "set_discord_behaviour_channel";
  if (t.includes("user_behaviour")) return "get_user_behaviour";
  if (t.includes("cli_agents_status")) return "get_cli_agents_status";
  if (t.includes("cli_agent") && t.startsWith("send_")) return "send_to_cli_agent";
  if (t === "whatsapp_message" || t === "send_whatsapp") return "send_whatsapp_message";
  if (t === "email" || t === "send_mail") return "send_email";
  if (t === "whatsapp_auto_reply" || t === "whatsapp_auto") return "set_whatsapp_auto_reply";

  // If it's a known discord tool without the prefix
  const discordSuffixes = [
    "kick", "ban", "unban", "mute", "unmute", "warn",
    "delete_messages", "assign_role", "remove_role",
    "send_dm", "get_channels", "send_channel_message", "get_guilds",
  ];
  for (const suffix of discordSuffixes) {
    if (t === suffix || t === `discord_${suffix}`) {
      return `discord_${suffix}`;
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

/**
 * Parse plan-format response (lines starting with "- tool(args)") into typed tool calls.
 * Mirrors src-tauri/src/tools.rs parse_plan_to_tool_calls
 */
export function parsePlanToToolCalls(planText: string, guildId: string): ToolCall[] {
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
  if (contentToParse.includes("conversational") && !contentToParse.includes("(")) {
    return [];
  }

  // Preprocess single-line multi-tool calls into multiple lines
  contentToParse = contentToParse.replace(/\)\s*(?:,\s*|;\s*|and\s+)?-?\s*([a-zA-Z_]\w*)\(/g, ")\n- $1(");

  const lines = contentToParse.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:-\s*)?([\w_]+)\s*\((.*)\)/);
    if (!match) continue;

    const tool = cleanToolName(match[1]);
    if (tool === "conversational") continue;

    // Detect multiplier at the end of the line (e.g. (x3) or (×2))
    const multMatch = trimmed.match(/\((?:[x×\*\s]*|times\s*|repeat\s*)(\d+)\s*\)\s*$/i);
    const count = multMatch ? parseInt(multMatch[1], 10) : 1;

    const argsText = match[2].replace(/\s*\((?:[x×\*\s]*|times\s*|repeat\s*)\d+\s*\)\s*$/i, "");
    const args: Record<string, unknown> = {};

    // Parse "key = value" pairs
    const argRegex = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|True|False|null|None|none|\d+)/g;
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

    // Auto-inject guild_id for Discord tools that need it
    if (DISCORD_TOOLS_WITH_GUILD_ID.includes(tool)) {
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
export function buildActionSystemPrompt(memoryContext: string, categories?: string[]): string {
  return [
    `You are Pern's AI Agent. Your job is to translate user requests directly into a list of tool actions starting with "- ".`,
    `If the user request is conversational (e.g. general knowledge, greetings, chat, questions with no tool mapping), output exactly:`,
    `Plan:`,
    `- conversational()`,
    ``,
    `IMPORTANT RULES:`,
    `1. If input contains action keywords (status, online, message, send, email, discord, whatsapp, app, auto reply, agents, behave, open, close, running, shutdown, restart, reboot), it is NOT conversational.`,
    `2. Resolve pronouns (it, them) to their original referents. Always output actions in the exact chronological order requested by the user. When repeating an action (like "do that dm again" or "do the first part again"), look back to the exact original arguments of that action and write it out on a separate line.`,
    `3. Do not output guild_id; it's auto-injected.`,
    `4. MESSAGE FORMATTING & SPEECH CONVERSION:`,
    `   a. If the request specifies a message using "saying [text]" or "say [text]", use that exact text (e.g., saying "ping" -> message="ping"). Do not prefix or convert it. This overrides any "Hey [name]" prefix rule.`,
    `   b. Convert indirect requests (e.g. "ask if they are available", "ask if he is available", "asking if she can join", "ask how their morning is going") to friendly direct speech prefixed with "Hey [recipient_name], " (e.g. "Hey Alice, are you available?", "Hey rahul, are you available?").`,
    `   c. E.g. "message Bob to open discord" means send_whatsapp_message(recipient="Bob", message="open discord"), NOT launch_app(app_name="discord"). Do not execute actions inside a message.`,
    `   d. E.g. "dm <@123> asking if they can fix the server" -> discord_send_dm(user_id="123", message="Hey, can you fix the server?"). Prefix DMs for user mentions with "Hey, " and convert indirect speech to direct.`,
    `   e. For named contacts (like "Alice" or "rahul"), the name IS known, so ALWAYS prefix with "Hey [name], " (e.g., "Hey Alice, are you available?", "Hey rahul, are you available?") unless rule 4a applies. For user mentions (like <@123>), the name is not known, so ALWAYS prefix with "Hey, " instead (e.g., "Hey, can you check it?").`,
    `   f. Preserve the exact spelling and casing of all names and recipients as written in the user request (e.g., if the request says "rahul", use "rahul" in lowercase; if request says "Chirag", use "Chirag").`,
    `   g. If you generate a "Hey [name]" message, the [name] must match the recipient name exactly (no substitutions or mismatches).`,
    `5. AUTO-REPLY SETTINGS: "turn auto reply on/off" maps to set_whatsapp_auto_reply(recipient, enabled=true/false). Only use toggle_whatsapp_auto_reply when "toggle" is explicitly used.`,
    `6. BAN VS DELETE MESSAGES: discord_ban's delete_message_seconds argument is ONLY for deleting message history of the banned user (default is 0). It is NOT for purging messages in a channel. Deleting or purging messages in a channel MUST map to discord_delete_messages(channel_id, count).`,
    `7. NO CODE OR LOGIC: NEVER output code blocks, if/else statements, loops, conditions, brackets, variables, or comments. Output ONLY a flat list of tool calls starting with "- ".`,
    `8. NO HALLUCINATED TOOLS: Do not generate tool calls for description of general activities (e.g., "do some work", "do some math"). Ignore them. Only use the allowed tools.`,
    `9. REASON PROPAGATION: If a reason is specified for the first action in a chain (e.g. "warn user for spamming, then mute them"), propagate the same reason to subsequent relevant actions (like mute or ban) unless a different reason is specified.`,
    `10. DISCORD VS WHATSAPP: Any request with "channel", "role", "ban", "mute", "unban", or Discord mentions (<@ID>) maps to Discord tools. Use discord_send_channel_message for channels, and discord_send_dm for user mentions. Do NOT use send_whatsapp_message for Discord channels or mentions.`,
    `11. TODO FIRST FOR COMPLEX TASKS: If the request needs 3+ actions or is multi-step, output a "Todo:" section before "Plan:". Use numbered lines (1., 2., 3.). Keep the Todo human-readable (no tool names or args). For simple requests, omit Todo. Always include Plan.`,
    getToolSignatures(categories),
    ``,
    `Owner context: ${memoryContext}`,
  ].join("\n");
}

/** Check if a tool name is a valid canonical tool name */
export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && ALL_TOOL_NAMES.includes(value as ToolName);
}

/** Normalize a tool call object, handling known variations */
export function normalizeToolCall(value: unknown): ToolCall | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as { tool?: unknown; args?: unknown };
  if (typeof candidate.tool !== "string") return null;
  if (!candidate.args || typeof candidate.args !== "object") return null;

  const args = { ...(candidate.args as ToolArgs) };

  // Standardize agent_name for send_to_cli_agent
  if (candidate.tool === "send_to_cli_agent") {
    if ("agentName" in args && !("agent_name" in args)) {
      args.agent_name = args.agentName;
      delete args.agentName;
    }
    if (typeof args.agent_name === "string") {
      const lower = (args.agent_name as string).toLowerCase().trim();
      if (lower === "agy" || lower === "agye" || lower === "antigravity") args.agent_name = "agy";
      else if (lower === "claude" || lower === "claude-code" || lower === "claude_code" || lower === "claudecode") args.agent_name = "claude-code";
      else if (lower === "freebuff" || lower === "freebuf") args.agent_name = "freebuff";
    }
  }

  // Standardize status for set_discord_status
  if (candidate.tool === "set_discord_status") {
    if (typeof args.status === "string") {
      const lower = args.status.toLowerCase().trim();
      if (["online", "active", "run", "running"].includes(lower)) {
        args.status = "online";
      } else if (["dnd", "busy", "do not disturb", "do_not_disturb"].includes(lower)) {
        args.status = "dnd";
      } else if (["offline", "invisible", "hidden"].includes(lower)) {
        args.status = "invisible";
      } else {
        args.status = "idle";
      }
    }
  }

  return { tool: candidate.tool, args };
}

/** Format a test case to few-shot string for the model */
export function formatTestCaseToFewShot(tc: { input: string; expected: ToolCall[] }): string {
  let output = `User Request: ${tc.input}\nPlan:\n`;
  if (tc.expected.length === 0) {
    output += "- conversational()\n";
  } else {
    for (const ec of tc.expected) {
      const argsPart = Object.entries(ec.args)
        .filter(([k]) => k !== "guild_id")
        .map(([k, v]) => {
          if (typeof v === "string") return `${k}="${v}"`;
          if (v === null) return `${k}=null`;
          return `${k}=${v}`;
        })
        .join(", ");
      output += `- ${ec.tool}(${argsPart})\n`;
    }
  }
  return output;
}

interface FewShotExample {
  categories: string[];
  text: string;
}

const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    categories: [],
    text: `User Request: what is the capital of France?
Plan:
- conversational()`,
  },
  {
    categories: ["system"],
    text: `User Request: open whatsapp and close notepad
Plan:
- launch_app(app_name="whatsapp")
- close_app(app_name="notepad")`,
  },
  {
    categories: ["system"],
    text: `User Request: shut down my computer
Plan:
- shutdown_system()`,
  },
  {
    categories: ["system"],
    text: `User Request: restart the system
Plan:
- restart_system()`,
  },
  {
    categories: ["whatsapp"],
    text: `User Request: message Dave and ask if he is free, and send same message to Frank, and open whatsapp, and turn auto reply on for both of them
Plan:
- send_whatsapp_message(recipient="Dave", message="Hey Dave, are you free?")
- send_whatsapp_message(recipient="Frank", message="Hey Frank, are you free?")
- launch_app(app_name="whatsapp")
- set_whatsapp_auto_reply(recipient="Dave", enabled=true)
- set_whatsapp_auto_reply(recipient="Frank", enabled=true)`,
  },
  {
    categories: ["discord"],
    text: `User Request: warn <@456> for toxicity, then mute them for 10 minutes, then assign role 888 to them, then log this in channel logs saying warned and muted user 456
Plan:
- discord_warn(user_id="456", reason="toxicity")
- discord_mute(user_id="456", duration_mins=10, reason="toxicity")
- discord_assign_role(user_id="456", role_id="888")
- discord_send_channel_message(channel_name="logs", message="warned and muted user 456")`,
  },
  {
    categories: ["discord"],
    text: `User Request: dm <@123> asking if they can review the change
Plan:
- discord_send_dm(user_id="123", message="Hey, can you review the change?")`,
  },
  {
    categories: ["discord"],
    text: `User Request: send a message to general channel saying hello everyone
Plan:
- discord_send_channel_message(channel_name="general", message="hello everyone")`,
  },
  {
    categories: ["email", "discord"],
    text: `User Request: save email config with host smtp.gmail.com port 587 sender me@gmail.com and password pass123, then send email to alice@gmail.com with subject Report and say hello, then dm <@456> asking if they can check it
Plan:
- save_email_config(smtp_host="smtp.gmail.com", smtp_port=587, sender_email="me@gmail.com", smtp_password="pass123")
- send_email(to="alice@gmail.com", subject="Report", body="hello")
- discord_send_dm(user_id="456", message="Hey, can you check it?")`,
  },
  {
    categories: ["agents", "whatsapp"],
    text: `User Request: run agy on project Pern to build it, then run freebuff to run tests, and if both are done message Bob saying all good, and toggle auto reply for him
Plan:
- send_to_cli_agent(agent_name="agy", prompt="build it", project_name="Pern")
- send_to_cli_agent(agent_name="freebuff", prompt="run tests", project_name="Pern")
- send_whatsapp_message(recipient="Bob", message="all good")
- toggle_whatsapp_auto_reply(recipient="Bob")`,
  },
  {
    categories: ["system", "discord"],
    text: `User Request: open chrome and calculator, do some math, then close both chrome and calculator, get status of cli agents, and set my discord status to idle with activity away
Plan:
- launch_app(app_name="chrome")
- launch_app(app_name="calculator")
- close_app(app_name="chrome")
- close_app(app_name="calculator")
- get_cli_agents_status()
- set_discord_status(status="idle", activity="away")`,
  },
  {
    categories: ["whatsapp"],
    text: `User Request: add contact Alice with number +9876543, then message Alice saying hello, then do that message again, then message Dave on WhatsApp saying hi Alice joined, then do the Dave message twice more
Plan:
- add_whatsapp_contact(name="Alice", number="+9876543")
- send_whatsapp_message(recipient="Alice", message="hello")
- send_whatsapp_message(recipient="Alice", message="hello")
- send_whatsapp_message(recipient="Dave", message="hi Alice joined")
- send_whatsapp_message(recipient="Dave", message="hi Alice joined")
- send_whatsapp_message(recipient="Dave", message="hi Alice joined")`,
  },
  {
    categories: ["discord"],
    text: `User Request: ban <@789> for raiding, delete 30 messages in channel 888888, then set behaviour log channel to 888888, then get behaviour logs for <@789> to verify
Plan:
- discord_ban(user_id="789", reason="raiding", delete_message_seconds=0)
- discord_delete_messages(channel_id="888888", count=30)
- set_discord_behaviour_channel(channel_id="888888")
- get_user_behaviour(user_id="789")`,
  },
  {
    categories: ["whatsapp", "email"],
    text: `User Request: send a whatsapp message to Alice asking if she can check the report, then email her at alice@gmail.com with subject Report Review and body please check the report, then do that email again, then tell her on whatsapp that it is sent
Plan:
- send_whatsapp_message(recipient="Alice", message="Hey Alice, can you check the report?")
- send_email(to="alice@gmail.com", subject="Report Review", body="please check the report")
- send_email(to="alice@gmail.com", subject="Report Review", body="please check the report")
- send_whatsapp_message(recipient="Alice", message="it is sent")`,
  },
  {
    categories: ["whatsapp", "discord"],
    text: `User Request: turn global whatsapp auto reply off, then unban <@111> on discord
Plan:
- toggle_whatsapp(enabled=false)
- discord_unban(user_id="111")`,
  },
  {
    categories: ["whatsapp"],
    text: `User Request: message Charlie on WhatsApp asking how he is, and toggle auto reply for him
Plan:
- send_whatsapp_message(recipient="Charlie", message="Hey Charlie, how are you?")
- toggle_whatsapp_auto_reply(recipient="Charlie")`,
  },
];

export function getActionFewShots(categories?: string[]): string {
  if (!categories || categories.length === 0) {
    return FEW_SHOT_EXAMPLES.map((e) => e.text).join("\n\n");
  }
  return FEW_SHOT_EXAMPLES.filter(
    (e) => e.categories.length === 0 || e.categories.some((cat) => categories.includes(cat))
  )
    .map((e) => e.text)
    .join("\n\n");
}

