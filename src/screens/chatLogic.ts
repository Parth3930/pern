import { ChatMessage, UserMemory, Skill, WhatsAppContact } from "../lib/api";
import {
  buildActionSystemPrompt,
  getActionFewShots,
  parsePlanToToolCalls,
  ToolName,
  ToolArgs,
  ToolCall,
  cleanToolName,
  isToolName,
} from "../tools";
export type { ToolName, ToolArgs, ToolCall };

export interface ToolResult {
  ok?: boolean;
  status?: string;
  message?: string;
  error?: string;
  resolved_name?: string;
  to?: string;
  guilds?: [string, string][];
  /**
   * Optional structured payload that the renderer can use to draw a
   * tool-specific UI (currently only used for memory tools). The text reply
   * stays in `message` so existing text rendering still works.
   */
  memory_result?: import("../lib/api").MemoryToolResult;
}

export interface ChatActionMemory {
  whatsapp?: {
    recipients: string[];
    message: string;
  };
}

export type ActionIntent = "action" | "chat";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


function extractPromptFromUserMessage(userMessage: string): string | null {
  const msg = userMessage.trim();

  // 1. Matches "send hi", "send hello", etc.
  if (msg.toLowerCase().includes("send hi") || msg.toLowerCase().includes("send hello") || msg.toLowerCase().endsWith(" send hi") || msg.toLowerCase().endsWith(" send hello")) {
    return "hi";
  }

  // 2. Matches "send <prompt>" or "and send <prompt>" at the end or anywhere
  const sendMatch = msg.match(/(?:and\s+)?send\s+["']?([^"']+)["']?$/i) || msg.match(/(?:and\s+)?send\s+["']?([^"']+)["']?/i);
  if (sendMatch) return sendMatch[1].trim();

  // 3. Matches "execute <prompt> in/using/on <agent>"
  const executeInMatch = msg.match(/execute\s+(?:the\s+)?["']?([^"']+)["']?\s+(?:in|using|on)\b/i);
  if (executeInMatch) return executeInMatch[1].trim();

  // 4. Matches "run <prompt> in/using/on <agent>"
  const runInMatch = msg.match(/run\s+(?:the\s+)?["']?([^"']+)["']?\s+(?:in|using|on)\b/i);
  if (runInMatch) {
    const val = runInMatch[1].trim();
    return val.toLowerCase().startsWith("run") ? val : "run " + val;
  }

  // 5. Matches "tell <agent> to <prompt>" or "ask <agent> to <prompt>"
  const tellMatch = msg.match(/(?:tell|ask)\s+\w+\s+to\s+(.+)$/i);
  if (tellMatch) return tellMatch[1].trim();

  // 6. Matches "fire a command in <agent> of <prompt>"
  const fireMatch = msg.match(/fire\s+(?:a\s+)?command\s+in\s+\w+\s+of\s+(.+)$/i);
  if (fireMatch) return fireMatch[1].trim();

  // 6b. Matches "fire <agent> in project <project> (to|and) <prompt>"
  const fireAgentMatch = msg.match(/fire\s+\w+\s+(?:in|on)\s+(?:project\s+)?\w+\s+(?:to|and)\s+(.+)$/i);
  if (fireAgentMatch) return fireAgentMatch[1].trim();

  // 6c. Matches "fire <agent> (to|and) <prompt>"
  const fireAgentDirectMatch = msg.match(/fire\s+\w+\s+(?:to|and)\s+(.+)$/i);
  if (fireAgentDirectMatch) return fireAgentDirectMatch[1].trim();

  // 7. Matches "run <agent> on <project> to <prompt>"
  const runToMatch = msg.match(/run\s+\w+\s+on\s+\w+\s+to\s+(.+)$/i);
  if (runToMatch) return runToMatch[1].trim();

  // 8. Matches "use <agent> to <prompt>"
  const useToMatch = msg.match(/use\s+\w+\s+to\s+(.+?)(?:\s+in\s+\w+|\s+on\s+\w+)?$/i);
  if (useToMatch) return useToMatch[1].trim();

  return null;
}

export function extractToolCalls(content: string, userMessage?: string): ToolCall[] {
  const parsed = parsePlanToToolCalls(content, "");
  const toolCalls: ToolCall[] = [];
  const seenSignatures = new Set<string>();

  for (let call of parsed) {
    // Filter out hallucinated tool names not in ALL_TOOL_NAMES
    if (!isToolName(call.tool)) {
      console.warn(`[CHAT] Ignoring hallucinated tool "${call.tool}" - not a known tool.`);
      continue;
    }

    // Post-process to correct hallucinated example prompts from small models
    if (userMessage && call.tool === "send_to_cli_agent" && typeof call.args.prompt === "string") {
      const currentPrompt = call.args.prompt.trim();
      const examplePrompts = [
        "write a python script to download all images from a url",
        "check the server logs and report any errors",
        "update the readme file",
        "review the pull request",
        "explain the failing build",
        "run the status command",
        "refactor the authentication module to use jwt tokens",
        "fix the build errors",
        "add a readme.md file"
      ];

      const isExamplePrompt = examplePrompts.includes(currentPrompt.toLowerCase());
      const userMentionsPrompt = userMessage.toLowerCase().includes(currentPrompt.toLowerCase());

      if (isExamplePrompt && !userMentionsPrompt) {
        const extracted = extractPromptFromUserMessage(userMessage);
        if (extracted) {
          call = {
            ...call,
            args: {
              ...call.args,
              prompt: extracted
            }
          };
        }
      }
    }

    const signature = `${call.tool}:${JSON.stringify(call.args)}`;
    if (!seenSignatures.has(signature)) {
      toolCalls.push(call as unknown as ToolCall);
      seenSignatures.add(signature);
    }
  }

  return toolCalls;
}

export function stripToolCalls(content: string): string {
  let lines = content.split("\n");
  lines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith("[TOOL_RESULT] ")) {
      return trimmed.slice("[TOOL_RESULT] ".length);
    }
    return line;
  });
  lines = lines.filter(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith("Plan:") && !trimmed.startsWith("-") && trimmed !== "<plan>" && trimmed !== "</plan>";
  });
  return lines.join("\n").trim();
}

function sanitizeMessageForModel(
  message: ChatMessage,
): ChatMessage | null {
  if (message.role === "system" && message.content.startsWith("Tool Result:")) {
    return null;
  }
  if (message.role !== "assistant") {
    return message;
  }

  const content = message.content;
  const hasToolCalls = content.split("\n").some(line => line.trim().startsWith("-"));

  if (hasToolCalls) {
    // Keep only the tool call/plan lines, strip UI/tool results
    let lines = content.split("\n");
    lines = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith("Plan:") || trimmed.startsWith("-") || trimmed === "<plan>" || trimmed === "</plan>";
    });
    const cleanContent = lines.join("\n").trim();
    return cleanContent ? { ...message, content: cleanContent } : null;
  } else {
    // Conversational assistant message: keep as-is, just strip [TOOL_RESULT] prefix if any
    let clean = content;
    if (clean.startsWith("[TOOL_RESULT] ")) {
      clean = clean.slice("[TOOL_RESULT] ".length).trim();
    }
    return clean ? { ...message, content: clean } : null;
  }
}

export interface CompactionResult {
  messages: ChatMessage[];
  summary: string;
  wrappedUserMessage?: string;
}

function summarizeMessages(messages: ChatMessage[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    const content = message.content.replace(/\s+/g, " ").trim();
    if (!content) continue;

    const shortened =
      content.length > 180 ? `${content.slice(0, 177).trimEnd()}...` : content;
    const speaker = message.role === "assistant" ? "Assistant" : "User";
    lines.push(`${speaker}: ${shortened}`);
  }

  return lines.join("\n");
}

function mergeSummary(existingSummary: string, freshSummary: string): string {
  const mergedLines = [
    ...existingSummary.split("\n"),
    ...freshSummary.split("\n"),
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of mergedLines) {
    const key = line.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(line);
    }
  }

  return deduped.join("\n");
}

function compactConversationMessages(
  messages: ChatMessage[],
  memory: UserMemory,
): CompactionResult {
  const existingSummary = memory.conversation_summary.trim();
  // Keep more recent messages so follow-up actions have full context
  const MAX_RECENT_MESSAGES = 8;
  const MIN_MESSAGES_TO_COMPACT = 5;

  if (messages.length <= MAX_RECENT_MESSAGES) {
    return {
      messages,
      summary: existingSummary,
    };
  }

  const compactUntil = messages.length - MAX_RECENT_MESSAGES;
  if (compactUntil < MIN_MESSAGES_TO_COMPACT) {
    return {
      messages,
      summary: existingSummary,
    };
  }

  const toCompact = messages.slice(0, compactUntil);
  const recent = messages.slice(compactUntil);
  const freshSummary = summarizeMessages(toCompact);

  const mergedSummary = mergeSummary(existingSummary, freshSummary).trim();

  const trimmedSummary =
    mergedSummary.length > 1800
      ? mergedSummary.slice(mergedSummary.length - 1800)
      : mergedSummary;

  return {
    messages: recent,
    summary: trimmedSummary,
  };
}

export interface ChatActionMemoryArg {
  whatsapp?: {
    recipients: string[];
    message: string;
  };
}

export const TOOL_CATEGORIES = {
  system: ["launch_app", "close_app", "get_status", "restart_system", "shutdown_system"],
  whatsapp: ["send_whatsapp_message", "set_whatsapp_auto_reply", "toggle_whatsapp_auto_reply", "toggle_whatsapp", "add_whatsapp_contact", "set_whatsapp_contact_auto_reply"],
  discord: ["set_discord_status", "discord_get_channels", "discord_send_channel_message", "discord_kick", "discord_ban", "discord_unban", "discord_mute", "discord_unmute", "discord_warn", "discord_delete_messages", "discord_assign_role", "discord_remove_role", "discord_send_dm", "discord_get_guilds", "set_discord_behaviour_channel", "get_user_behaviour"],
  email: ["send_email", "save_email_config"],
  agents: ["send_to_cli_agent", "get_cli_agents_status"],
  todos: ["add_todo"],
  banter: []
} as const;

function getCategoryForTool(toolName: string): string | null {
  const cleaned = cleanToolName(toolName);
  for (const [cat, tools] of Object.entries(TOOL_CATEGORIES)) {
    if ((tools as readonly string[]).includes(cleaned)) {
      return cat;
    }
  }
  return null;
}

function detectRequiredToolCategories(
  userMessage: string,
  messages: ChatMessage[],
  whatsappContacts?: { name: string }[],
  lastToolResult?: { tool: string; status: string },
): string[] {
  const categories = new Set<string>();
  const normalized = userMessage.toLowerCase().replace(/[.?!\s]+$/, "").trim();

  // 1. WhatsApp Matcher
  const hasWhatsAppTermsOtherThanApp = /\b(message|msg|text|contact|auto[- ]?reply|auto[- ]?replies)\b/i.test(normalized) ||
                                       /\b(tell|ask|say|send|msg|message|text)\b.{0,30}\b(him|her|them|mom|dad|brother|sister|friend|parth|samarth|rahul|chirag|rover)\b/i.test(normalized) ||
                                       (whatsappContacts && whatsappContacts.some(c => normalized.includes(c.name.toLowerCase())));
  const onlyWhatsAppAsApp = /\b(open|launch|start|run|close|quit|exit)\b.{0,50}\bwhatsapp\b/i.test(normalized) && !hasWhatsAppTermsOtherThanApp;
  const isWhatsApp = (/\b(whatsapp|message|msg|text|contact|auto[- ]?reply|auto[- ]?replies)\b/i.test(normalized) ||
                      /\b(tell|ask|say|send|msg|message|text)\b.{0,30}\b(him|her|them|mom|dad|brother|sister|friend|parth|samarth|rahul|chirag|rover)\b/i.test(normalized) ||
                      (whatsappContacts && whatsappContacts.some(c => normalized.includes(c.name.toLowerCase())))) && !onlyWhatsAppAsApp;
  if (isWhatsApp) {
    categories.add("whatsapp");
  }

  // 2. Discord Matcher
  const hasDiscordTermsOtherThanApp = /\b(guild|channel|server|role|kick|ban|unban|mute|unmute|warn|purge|dm|logs|behaviour|behave)\b/i.test(normalized) ||
                                      /<@!?\d+>/.test(normalized);
  const onlyDiscordAsApp = /\b(open|launch|start|run|close|quit|exit)\b.{0,50}\bdiscord\b/i.test(normalized) && !hasDiscordTermsOtherThanApp;
  const isDiscord = (/\b(discord|guild|channel|server|role|kick|ban|unban|mute|unmute|warn|purge|dm|logs|behaviour|behave)\b/i.test(normalized) ||
                     /<@!?\d+>/.test(normalized)) && !onlyDiscordAsApp;
  if (isDiscord) {
    categories.add("discord");
  }

  // 3. Email Matcher
  const hasEmailTermsOtherThanApp = /\b(send|write|draft|smtp|subject|body)\b/i.test(normalized) || /\S+@\S+/.test(normalized);
  const onlyEmailAsApp = /\b(open|launch|start|run|close|quit|exit)\b.{0,50}\b(gmail|mail|email)\b/i.test(normalized) && !hasEmailTermsOtherThanApp;
  const isEmail = (/\b(email|mail|smtp|subject|body)\b/i.test(normalized) ||
                   /\S+@\S+/.test(normalized)) && !onlyEmailAsApp;
  if (isEmail) {
    categories.add("email");
  }

  // 4. System Matcher
  const isSystem = /\b(launch|open|close|start|run|quit|exit|chrome|notepad|calculator|app|system|pc|computer|uptime|health|restart|reboot|shut[- ]?down|shutdown|power[- ]?off|poweroff|drive|obsidian|discord|vscode|terminal|browser|excel|word|powerpoint|file manager|filemanager|files|explorer)\b/i.test(normalized);
  if (isSystem) {
    categories.add("system");
  }

  // 5. Agents Matcher
  const isAgents = /\b(cli|agent|agy|claude|hermes|codex|freebuff|freebuf)\b/i.test(normalized);
  if (isAgents) {
    categories.add("agents");
  }

  // 5.5 Todos Matcher
  const isTodos = /\b(to[- ]do|todos?|remind(er)?s?)\b/i.test(normalized);
  if (isTodos) {
    categories.add("todos");
  }

  // 5.6 Banter Matcher
  const isBanter = /\b(pickup\s*line|pick\s*up\s*line|joke|jokes|flirt|flirty|friendly|romantic|compliment|pickup|tease|teasing|playful|humor|humorous|fun)\b/i.test(normalized);
  if (isBanter) {
    categories.add("banter");
  }

  // 6. Contextual confirmations/pronouns check
  const isConfirmationOrPronoun = /^(yes|yeah|yep|ok|okay|sure|do it|go ahead|send|yes send|please do|again|send it|do that|send him|send her|send them|send to him|send to her|send to them|send on whatsapp|send it on whatsapp|send him on whatsapp|send her on whatsapp)\s*$/i.test(normalized.trim()) ||
                                  /\b(again|it|them|him|her)\b/i.test(normalized);

  if (isConfirmationOrPronoun) {
    // Check last tool result
    if (lastToolResult?.tool) {
      const cat = getCategoryForTool(lastToolResult.tool);
      if (cat) categories.add(cat);
    }

    // Inspect recent messages for tool names
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.content) {
        const lines = msg.content.split("\n");
        for (const line of lines) {
          const match = line.trim().match(/^(?:-\s*)?([\w_]+)\s*\(/);
          if (match) {
            const toolName = match[1];
            const cat = getCategoryForTool(toolName);
            if (cat) categories.add(cat);
          }
        }
      }
    }
  }

  return Array.from(categories);
}

function getTodosContext(categories: string[]): string | null {
  if (!categories.includes("todos")) return null;
  try {
    const storedTodos = localStorage.getItem("pern_todos");
    if (!storedTodos) return null;
    const todosList = JSON.parse(storedTodos);
    const active = todosList.filter((t: any) => !t.completed);
    if (active.length > 0) {
      const formattedTodos = active.map((t: any) => {
        const timeStr = t.time ? ` (due: ${new Date(t.time).toLocaleString()})` : "";
        return `- ${t.text}${timeStr}`;
      }).join("\n");
      return `Active Todos:\n${formattedTodos}`;
    }
    return `Active Todos: None. All caught up!`;
  } catch (e) {
    console.error("Failed to parse todos for chat context:", e);
    return null;
  }
}

function resolveAppPronouns(userMessage: string, messages: ChatMessage[]): string {
  const normalized = userMessage.toLowerCase();
  
  const isClose = /\b(close|quit|exit|stop|terminate)\b/i.test(normalized);
  const isOpen = /\b(open|launch|start|run|show)\b/i.test(normalized);
  const hasPronoun = /\b(both|them|it|all)\b/i.test(normalized);

  if ((!isClose && !isOpen) || !hasPronoun) {
    return userMessage;
  }

  // Trace opened and closed apps
  const openedApps = new Map<string, string>();
  const closedApps = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.content) {
      const lines = msg.content.split("\n");
      for (const line of lines) {
        const launchMatch = line.match(/launch_app\s*\(\s*app_name\s*=\s*"([^"]+)"\s*\)/i) ||
                            line.match(/launch_app\s*\(\s*"([^"]+)"\s*\)/i);
        if (launchMatch) {
          const app = launchMatch[1].trim();
          openedApps.set(app.toLowerCase(), app);
          closedApps.delete(app.toLowerCase());
        }
        
        const closeMatch = line.match(/close_app\s*\(\s*app_name\s*=\s*"([^"]+)"\s*\)/i) ||
                           line.match(/close_app\s*\(\s*"([^"]+)"\s*\)/i);
        if (closeMatch) {
          const app = closeMatch[1].trim();
          openedApps.delete(app.toLowerCase());
          closedApps.set(app.toLowerCase(), app);
        }
      }
    }
  }

  // Determine target apps depending on the verb
  let targetApps: string[] = [];
  if (isClose) {
    targetApps = Array.from(openedApps.values());
  } else if (isOpen) {
    targetApps = Array.from(closedApps.values());
    // Fallback to openedApps if closedApps is empty
    if (targetApps.length === 0) {
      targetApps = Array.from(openedApps.values());
    }
  }

  if (targetApps.length === 0) {
    return userMessage;
  }

  const appsStr = targetApps.join(" and ");

  if (isClose) {
    const closePronounRegex = /\b(close|quit|exit|stop|terminate)\s+(?:both|them|it|all)(?:\s+apps)?(?:\s+of\s+them)?(?:\s+all)?\b/i;
    if (closePronounRegex.test(userMessage)) {
      return userMessage.replace(closePronounRegex, (_match, verb) => {
        return `${verb} ${appsStr}`;
      });
    }
  }

  if (isOpen) {
    const openPronounRegex = /\b(open|launch|start|run|show)\s+(?:both|them|it|all)(?:\s+apps)?(?:\s+of\s+them)?(?:\s+all)?\b/i;
    if (openPronounRegex.test(userMessage)) {
      return userMessage.replace(openPronounRegex, (_match, verb) => {
        return `${verb} ${appsStr}`;
      });
    }
  }

  return userMessage;
}

export function buildConversationHistory(
  messages: ChatMessage[],
  memory: UserMemory,
  latestIntent: ActionIntent,
  lastToolResult?: { tool: string; status: string },
  chatActionMemory?: ChatActionMemoryArg,
  relevantSkills?: Skill[],
  whatsappContacts?: WhatsAppContact[],
): CompactionResult {

  // Resolve pronouns in the user messages first
  const resolvedMessages = [...messages];
  for (let i = resolvedMessages.length - 1; i >= 0; i--) {
    if (resolvedMessages[i].role === "user") {
      resolvedMessages[i] = {
        ...resolvedMessages[i],
        content: resolveAppPronouns(resolvedMessages[i].content, messages.slice(0, i))
      };
      break;
    }
  }

  // Inject relevant skills into the system prompt
  let skillsSection = "";
  if (relevantSkills && relevantSkills.length > 0) {
    skillsSection = "\n\n### RELEVANT SKILLS\nYou know these recurring workflows for this user:\n";
    for (const skill of relevantSkills) {
      skillsSection += `\n**${skill.name}**: ${skill.description}\n`;
      if (skill.trigger_patterns.length > 0) {
        skillsSection += `  Triggers: ${skill.trigger_patterns.join(", ")}\n`;
      }
      skillsSection += `${skill.content}\n`;
    }
  }

  // 1. Sanitize all messages
  const sanitized = resolvedMessages
    .map(sanitizeMessageForModel)
    .filter((msg): msg is ChatMessage => msg !== null);

  // 2. Combine consecutive messages of the same role
  const combined: ChatMessage[] = [];
  for (const msg of sanitized) {
    const last = combined[combined.length - 1];
    if (last && last.role === msg.role) {
      last.content = `${last.content}\n\n${msg.content}`;
    } else {
      combined.push({ ...msg });
    }
  }

  const compacted = compactConversationMessages(combined, memory);
  const summarySection = compacted.summary
    ? `\n### CONVERSATION SUMMARY\n${compacted.summary}`
    : "";

  const toolResultSection = lastToolResult
    ? `\n### RECENT ACTION\nTool: ${lastToolResult.tool}\nResult: ${lastToolResult.status}`
    : "";

  // Build last-action context so model can resolve pronouns like "him"/"her"
  let lastWhatsAppSection = "";
  if (chatActionMemory?.whatsapp) {
    const { recipients, message } = chatActionMemory.whatsapp;
    lastWhatsAppSection = `\n### LAST WHATSAPP\nRecipient(s): ${recipients.join(", ")}\nMessage: ${message}`;
  }

  let systemPrompt: string;
  let dynamicContext = "";

  const userMsg = getLatestUserMessage(resolvedMessages);
  const categories = detectRequiredToolCategories(
    userMsg,
    resolvedMessages,
    whatsappContacts || undefined,
    lastToolResult || undefined
  );
  console.log("[CHAT][DIAG] buildConversationHistory", { intent: latestIntent, inputLength: userMsg.length, inputPreview: userMsg.slice(0, 80), categories, messagesIn: resolvedMessages.length, contactsCount: whatsappContacts?.length ?? 0 });

  if (latestIntent === "action") {
    console.log("[CHAT][DIAG] Building ACTION prompt (system + few-shots + tool sigs)");
    let memoryContext = "";
    const now = new Date();
    memoryContext += `Current time is ${now.toLocaleString()} (ISO: ${now.toISOString()}). `;
    if (memory.name) {
      memoryContext += `The owner of the device you are running on is ${memory.name}. `;
    }
    if (memory.persona && memory.persona.length > 0) {
      memoryContext += `Information about the owner: ${memory.persona.join("; ")}. `;
    }
    if (whatsappContacts && whatsappContacts.length > 0) {
      const contactNames = whatsappContacts.map((c) => c.name).join(", ");
      memoryContext += `Allowed WhatsApp contacts: ${contactNames}. `;
    }
    if (compacted.summary) {
      memoryContext += `Recent conversation context: ${compacted.summary}. `;
    }
    if (toolResultSection) {
      memoryContext += `Recent tool action status: ${toolResultSection.trim()}. `;
    }
    if (lastWhatsAppSection) {
      memoryContext += `Recent WhatsApp details: ${lastWhatsAppSection.trim()}. `;
    }

    systemPrompt = buildActionSystemPrompt("", categories);
    dynamicContext = memoryContext;
  } else {
    // Chat mode: zero mention of JSON or tools — keeps small models from hallucinating JSON
    const banterRule = categories.includes("banter")
      ? "\n5. BANTER & FUN: When responding to a conversational request for a joke, pickup line, or friendly/flirtatious banter, be highly cooperative, warm, and humorous. Provide a fun and lighthearted response instead of declining or being overly formal. Let's make sure the pickup lines/jokes are playful and engaging!"
      : "";

    systemPrompt = `You are Pern, a friendly and intelligent personal assistant acting on behalf of the device owner. You are responding AS the assistant, not as the user.
Never speak from the user's perspective or say things like "I would love some ideas" as if you are the user — you are the one providing ideas, information, and help.

STRICT RULES:
1. Always address the user by their name when appropriate to keep the conversation personal.
2. Keep responses concise, natural, and warm. Use plain text only.
3. DO NOT attempt to use any tools or output JSON. Your output must only be plain natural text.
4. PRIVACY & KNOWLEDGE: Never discuss other contacts, leak private chats, or make up information.${banterRule}

CRITICAL: If the user says "Yes", "Okay", "Sure" or agrees after you asked them a question, follow through immediately. For example:
- If you asked "Would you like me to suggest some ideas?" and they say "Yes" — GIVE them the ideas right away.
- If you offered to help with something and they say "Sure" — DO it, don't ask again.`;
  }

  // Calculate wrapped version of ONLY the current user message (without prepended previous messages)
  const lastUserMsgInInput = [...resolvedMessages].reverse().find(m => m.role === "user");
  const originalUserContent = lastUserMsgInInput ? lastUserMsgInInput.content : "";
  let wrappedUserMessage = originalUserContent;

  if (originalUserContent) {
    if (latestIntent === "action") {
      const fewShots = getActionFewShots(categories);
      const contextStr = dynamicContext ? `[Owner context: ${dynamicContext.trim()}]\n\n` : "";
      wrappedUserMessage = `${contextStr}${fewShots}\n\nUser Request: ${originalUserContent}\nPlan:\n`;
    } else {
      const contextParts: string[] = [];
      if (memory.name) {
        contextParts.push(`The user's name is ${memory.name}.`);
      }
      if (summarySection) {
        contextParts.push(summarySection.trim());
      }
      if (skillsSection) {
        contextParts.push(skillsSection.trim());
      }
      const todosCtx = getTodosContext(categories);
      if (todosCtx) {
        contextParts.push(todosCtx);
      }
      if (contextParts.length > 0) {
        wrappedUserMessage = `[Context:\n${contextParts.join("\n")}]\n\n${originalUserContent}`;
      }
    }
  }

  let finalMessages = compacted.messages;

  // 3. Ensure the first message after system is 'user'
  if (finalMessages.length > 0 && finalMessages[0].role === "assistant") {
    finalMessages = [{ role: "user", content: "Hello" }, ...finalMessages];
  }

  // 4. Ensure the last message is 'user'
  if (
    finalMessages.length > 0 &&
    finalMessages[finalMessages.length - 1].role === "assistant"
  ) {
    finalMessages = [...finalMessages, { role: "user", content: "Go ahead." }];
  }

  // Inject the dynamic contexts to the final user message
  if (finalMessages.length > 0) {
    const lastMsg = finalMessages[finalMessages.length - 1];
    if (lastMsg.role === "user") {
      if (latestIntent === "action") {
        const fewShots = getActionFewShots(categories);
        const contextStr = dynamicContext ? `[Owner context: ${dynamicContext.trim()}]\n\n` : "";
        lastMsg.content = `${contextStr}${fewShots}\n\nUser Request: ${lastMsg.content}\nPlan:\n`;
      } else {
        const contextParts: string[] = [];
        if (memory.name) {
          contextParts.push(`The user's name is ${memory.name}.`);
        }
        if (summarySection) {
          contextParts.push(summarySection.trim());
        }
        if (skillsSection) {
          contextParts.push(skillsSection.trim());
        }
        const todosCtx = getTodosContext(categories);
        if (todosCtx) {
          contextParts.push(todosCtx);
        }
        if (contextParts.length > 0) {
          lastMsg.content = `[Context:\n${contextParts.join("\n")}]\n\n${lastMsg.content}`;
        }
      }
    }
  }

  const result = {
    messages: [{ role: "system", content: systemPrompt }, ...finalMessages],
    summary: compacted.summary,
    wrappedUserMessage,
  };
  const resultTotalChars = result.messages.reduce((sum, m) => sum + m.content.length, 0);
  console.log("[CHAT][DIAG] buildConversationHistory DONE", { messagesOut: result.messages.length, totalChars: resultTotalChars, estTokens: Math.round(resultTotalChars / 4), systemPromptLen: systemPrompt.length, lastUserMsgLen: finalMessages[finalMessages.length - 1]?.content.length ?? 0 });
  return result;
}

export function getStringArg(args: ToolArgs, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

export function getExactStringArg(args: ToolArgs, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

export function getNumberArg(args: ToolArgs, key: string): number | null {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (!isNaN(parsed) && value.trim() !== "") {
      return parsed;
    }
  }
  return null;
}

export function getBooleanArg(args: ToolArgs, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean === "true" || clean === "1") return true;
    if (clean === "false" || clean === "0") return false;
  }
  return !!value;
}

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "The action failed unexpectedly.";
}

export function getCurrentTaskLabel(toolCall: ToolCall): string {
  const args = toolCall.args;
  switch (toolCall.tool) {
    case "launch_app":
      return `Opening ${getStringArg(args, "app_name") || "app"}...`;
    case "close_app":
      return `Closing ${getStringArg(args, "app_name") || "app"}...`;
    case "restart_system":
      return "Restarting system...";
    case "shutdown_system":
      return "Shutting down system...";
    case "send_email":
      return `Sending email to ${getStringArg(args, "to")}...`;
    case "add_whatsapp_contact":
      return `Adding WhatsApp contact ${getStringArg(args, "name")}...`;
    case "set_whatsapp_contact_auto_reply":
      return `Updating auto-reply for ${getStringArg(args, "name")}...`;
    case "toggle_whatsapp":
      return `${args.enabled ? "Enabling" : "Disabling"} WhatsApp...`;
    case "send_whatsapp_message":
      return `Sending WhatsApp message to ${getStringArg(args, "recipient")}...`;
    case "save_email_config":
      return "Saving email settings...";
    case "discord_kick":
      return "Kicking user from Discord...";
    case "discord_ban":
      return "Banning user from Discord...";
    case "discord_unban":
      return "Unbanning user from Discord...";
    case "discord_mute":
      return "Muting user in Discord...";
    case "discord_unmute":
      return "Unmuting user in Discord...";
    case "discord_warn":
      return "Warning user via Discord DM...";
    case "set_discord_status":
      return "Updating Discord status...";
    case "discord_delete_messages":
      return "Purging Discord messages...";
    case "discord_assign_role":
      return "Assigning Discord role...";
    case "discord_remove_role":
      return "Removing Discord role...";
    case "discord_get_guilds":
      return            "Retrieving Discord servers list...";
    case "send_to_cli_agent":
      return `Sending task to ${getStringArg(args, "agent_name") || "agent"}...`;
    case "get_cli_agents_status":
      return "Checking CLI agents status...";
    default:
      return "Processing...";
  }
}

export function validateEmailToolArgs(args: ToolArgs): string | null {
  const to = getStringArg(args, "to");
  const subject = getStringArg(args, "subject");
  const body = getExactStringArg(args, "body");
  if (!to || !EMAIL_REGEX.test(to)) return "Invalid recipient email.";
  if (!subject) return "Subject is required.";
  if (!body) return "Email body is empty.";
  return null;
}

export function buildToolReply(toolCall: ToolCall, result: ToolResult): string {
  if (result.ok) {
    const args = toolCall.args;
    switch (toolCall.tool) {
      case "launch_app":
        return `Opened ${result.resolved_name || getStringArg(args, "app_name") || "the app"}.`;
      case "close_app":
        return `Closed ${getStringArg(args, "app_name") || "the app"}.`;
      case "restart_system":
        return "System is restarting...";
      case "shutdown_system":
        return "System is shutting down...";
      case "send_email":
        return `Email sent to ${getStringArg(args, "to")}.`;
      case "add_whatsapp_contact":
        return `Added ${getStringArg(args, "name")} to contacts.`;
      case "set_whatsapp_contact_auto_reply":
        return `${args.enabled ? "Enabled" : "Disabled"} auto-reply for ${getStringArg(args, "name")}.`;
      case "set_whatsapp_auto_reply":
        return result.status || `Auto-reply ${args.enabled ? "enabled" : "disabled"} for ${getStringArg(args, "recipient") || getStringArg(args, "name") || "contact"}.`;
      case "toggle_whatsapp_auto_reply":
        return result.status || `Toggled auto-reply for ${getStringArg(args, "recipient") || getStringArg(args, "name") || "contact"}.`;
      case "toggle_whatsapp":
        return `WhatsApp auto-reply has been ${args.enabled ? "turned on" : "turned off"}.`;
      case "send_whatsapp_message":
        return `Message sent to ${getStringArg(args, "recipient")}.`;
      case "save_email_config":
        return "Email settings saved.";
      case "discord_kick":
        return `Kicked user ${getStringArg(args, "user_id")} from server ${getStringArg(args, "guild_id")}.`;
      case "discord_ban":
        return `Banned user ${getStringArg(args, "user_id")} from server ${getStringArg(args, "guild_id")}.`;
      case "discord_unban":
        return `Unbanned user ${getStringArg(args, "user_id")} from server ${getStringArg(args, "guild_id")}.`;
      case "discord_mute":
        return `Muted user ${getStringArg(args, "user_id")} for ${args.duration_mins} minutes in server ${getStringArg(args, "guild_id")}.`;
      case "discord_unmute":
        return `Unmuted user ${getStringArg(args, "user_id")} in server ${getStringArg(args, "guild_id")}.`;
      case "discord_warn":
        return `Warned user ${getStringArg(args, "user_id")} via Discord DM.`;
      case "set_discord_status":
        return result.message || "Updated Discord status.";
      case "discord_delete_messages":
        return `Deleted ${args.count} messages in channel ${getStringArg(args, "channel_id")}.`;
      case "discord_assign_role":
        return `Assigned role ${getStringArg(args, "role_id")} to user ${getStringArg(args, "user_id")}.`;
      case "discord_remove_role":
        return `Removed role ${getStringArg(args, "role_id")} from user ${getStringArg(args, "user_id")}.`;
      case "discord_get_guilds": {
        const guilds = result.guilds;
        if (!guilds || guilds.length === 0) return "I am not in any Discord servers currently.";
        return `I am currently in these Discord servers:\n${guilds.map(([id, name]) => `- **${name}** (ID: ${id})`).join("\n")}`;
      }
      case "send_to_cli_agent":
        return result.message || `Task sent to ${getStringArg(args, "agent_name") || "agent"}.`;
      case "get_cli_agents_status":
        return result.message || "Checked CLI agent status.";
    }
  }
  return result.error || result.message || "The action failed.";
}

export function removeTrailingAssistantMessage(
  messages: ChatMessage[],
): ChatMessage[] {
  const nextMessages = [...messages];
  if (
    nextMessages.length > 0 &&
    nextMessages[nextMessages.length - 1].role === "assistant"
  ) {
    nextMessages.pop();
  }
  return nextMessages;
}

function getLatestUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return messages[i].content;
    }
  }
  return "";
}

export function detectActionIntent(
  text: string,
  recentMessages: ChatMessage[] = [],
): ActionIntent {
  const normalized = text.toLowerCase().replace(/[.?!\s]+$/, "").trim();

  // 1. Check if user is asking to open/close apps using pronouns (both/them/it/all)
  // and we don't have any apps in the chat history to resolve them.
  const isAppPronoun = /\b(open|launch|start|run|close|quit|exit|stop|terminate)\s+(both|them|it|all)\b/i.test(normalized);
  if (isAppPronoun) {
    const openedApps = new Set<string>();
    const closedApps = new Set<string>();
    for (const msg of recentMessages) {
      if (msg.role === "assistant" && msg.content) {
        const lines = msg.content.split("\n");
        for (const line of lines) {
          const launchMatch = line.match(/launch_app\s*\(\s*app_name\s*=\s*"([^"]+)"\s*\)/i) ||
                              line.match(/launch_app\s*\(\s*"([^"]+)"\s*\)/i);
          if (launchMatch) {
            const app = launchMatch[1].trim().toLowerCase();
            openedApps.add(app);
            closedApps.delete(app);
          }
          const closeMatch = line.match(/close_app\s*\(\s*app_name\s*=\s*"([^"]+)"\s*\)/i) ||
                             line.match(/close_app\s*\(\s*"([^"]+)"\s*\)/i);
          if (closeMatch) {
            const app = closeMatch[1].trim().toLowerCase();
            openedApps.delete(app);
            closedApps.add(app);
          }
        }
      }
    }

    const isClose = /\b(close|quit|exit|stop|terminate)\b/i.test(normalized);
    const isOpen = /\b(open|launch|start|run)\b/i.test(normalized);

    if (isClose && openedApps.size === 0) {
      return "chat";
    }
    if (isOpen && closedApps.size === 0 && openedApps.size === 0) {
      return "chat";
    }
  }

  // 2. Check if user is asking to send "the same message" or "it" but we don't
  // have any preceding WhatsApp/email message in history.
  const isSameMessagePronoun = /\b(send|message|text|email)\s+(the\s+)?(same|it)\b/i.test(normalized);
  if (isSameMessagePronoun) {
    let hasPreviousMessage = false;
    for (const msg of recentMessages) {
      if (msg.role === "assistant" && msg.content) {
        if (msg.content.includes("send_whatsapp_message") || msg.content.includes("send_email")) {
          hasPreviousMessage = true;
          break;
        }
      }
    }
    if (!hasPreviousMessage) {
      return "chat";
    }
  }

  // 3. Check if user is only specifying a recipient to message or email,
  // without specifying what subject or message body to send.
  const isOnlyMessageRecipient = /^(?:message|send\s+(?:a\s+)?(?:whatsapp\s+)?message\s+to|tell|ask)\s+([a-zA-Z0-9]+)$/i.test(normalized);
  if (isOnlyMessageRecipient) {
    return "chat";
  }
  const isOnlyEmailRecipient = /^(?:email|send\s+(?:an\s+)?email\s+to)\s+(\S+@\S+|[a-zA-Z0-9]+)$/i.test(normalized);
  if (isOnlyEmailRecipient) {
    return "chat";
  }

const commandPatterns = [
  /\b[a-zA-Z\s]+-\s*\+?[0-9\s-]{8,}\b/i,
  /\b(open|launch|start|run|close|quit|exit)\b.{0,30}\b(app|apps|both|them|it|all|spotify|chrome|notepad|whatsapp|gmail|mail|drive|google drive|obsidian|discord|calculator|vscode|terminal|browser|excel|word|powerpoint|slack|zoom|teams|skype|photoshop|illustrator|steam|epic|gog|battle.net|minecraft|roblox|vlc|player|settings|control panel|explorer|file manager|filemanager|files|cmd|powershell|bash|git bash|youtube|netflix|twitter|facebook|instagram|reddit|github)\b/i,
  /\b(send|write|draft|message|text|tell|ask|say|fire|run|execute|trigger|instruct|prompt|give)\b.{0,30}\b(email|mail|whatsapp|message|msg|parth|samarth|him|her|them|rahul|mom|dad|brother|sister|friend|chirag|rover|claude|hermes|codex|agy|free.?bu\w*|agent)\b/i,
  /\b(add|save|create|configure|setup|set up)\b.{0,30}\b(contact|whatsapp contact|email config|smtp)\b/i,
  /\b(turn|set|toggle|enable|disable)\b.{0,30}\b(auto[- ]?reply|whatsapp|it)\b/i,
  /\b(turn|set|toggle|enable|disable)\b.{0,30}\b(mom|parth|samarth|him|her|them|rahul|chirag|rover)\b/i,
  /\b(set|change|update)\b.{0,30}\b(discord)\b.{0,30}\b(status|activity|presence)\b/i,
  /\b(is|check|what is|what's)\b.{0,20}(claude|hermes|codex|agy|free.?bu)\w*\b.{0,20}\b(running|status|doing|working|active|available|busy)\b/i,
  /\b(tell|ask|send|instruct|prompt|fire|run|execute|trigger|invoke|give)\b.{0,30}(claude|hermes|codex|agy|free.?bu)\w*\b.{0,60}\b(to|and|:|in|on|of|for|with)\b/i,
  /\b(fire|run|execute|trigger|invoke|launch|start|give)\b.{0,20}\b(command|task|prompt|agent|job|hi|hello)\b.{0,30}\b(in|on|to|with|for|at)\b.{0,20}(claude|hermes|codex|agy|free.?bu)\w*\b/i,
  /\b(agent|cli agent)\b.{0,20}\b(status|running|list|state|active|busy)\b/i,
  /(free.?bu\w*|hermes|claude.?code|codex|agy)\b.{0,30}\b(do|run|execute|perform|check|send|write|create|make|build|fix|update|install|configure|say|tell|message|fetch)\b/i,
  /\b(give|fire|send|run|execute|trigger|instruct|tell|ask)\b.{0,40}\b(a|the|this)\b.{0,30}(free.?bu\w*|hermes|claude.?code|codex|agy)\b.{0,50}\b(to|and|:)\b.{0,50}\b(task|prompt|command|hi|hello|say|do|run|execute|check|write|make|build|install|update)\b/i,
  /\b(can you|could you|please|pls|need|need you to|want|want you to|i need|i want|would you|could you please|can you please)\b.{0,50}\b(send|message|text|email|open|launch|close|ask|tell|say)\b/i,
  /\b(ask|tell|message|text)\b.{0,20}\b(him|her|them|parth|samarth|rahul|mom|dad|chirag|rover)\b/i,
  /\b(send|message|text|email)\b.{0,20}\b(the same|same|it|them|him|her)\b/i,
  /\b(shutdown|shut down|reboot|restart|power off|poweroff)\b/i,
  /\b(add|save|create|set|make|schedule)\b.{0,30}\b(to\s+do|todo|todos|reminder|reminders|task|tasks)\b/i,
  /\b(remind|reminder)\b/i,
];

  if (commandPatterns.some((pattern) => pattern.test(normalized))) {
    return "action";
  }

  const confirmationPattern =
    /^(yes|yeah|yep|ok|okay|sure|do it|go ahead|send|yes send|please do|again|send it|do that|send him|send her|send them|send to him|send to her|send to them|send on whatsapp|send it on whatsapp|send him on whatsapp|send her on whatsapp)\s*$/i;
  if (confirmationPattern.test(normalized)) {
    for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
      const message = recentMessages[i];
      if (message.role !== "assistant") continue;
      const assistantText = message.content.toLowerCase();
      if (
        /\b(send|message|email|open|launch|close|save|configure|add contact|ask|tell|reply|auto[- ]?reply)\b/.test(
          assistantText,
        )
      ) {
        return "action";
      }
      break;
    }
}

  // Query phrases that trigger action mode (status checks, lists, etc.)
  const queryPhrases = [
    "what servers",
    "list servers",
    "which servers",
    "what channels",
    "list channels",
    "which channels",
    "what is the uptime",
    "what's the uptime",
    "whats the uptime",
    "how long has the system",
    "how is everything",
    "how's everything",
    "what is the status",
    "what's the status",
    "whats the status",
    "status of my pc",
    "system status",
    "is claude code",
    "is hermes",
    "is codex",
    "is freebuff",
    "is agy",
    "agent status",
    "cli agent",
    "cli agents",
    "all agents",
    "what is freebuff",
    "what's freebuff",
    "what is hermes",
    "what's hermes",
    "what is claude",
    "what's claude",
    "what is codex",
    "what's codex",
    "what is agy",
    "what's agy",
  ];
  for (const q of queryPhrases) {
    if (normalized.startsWith(q)) {
      return "action";
    }
  }

  const likelyQuestion =
    /\b(what|why|how|when|where|who|explain|tell me|can you explain)\b/i;
  if (likelyQuestion.test(normalized)) {
    return "chat";
  }

  return "chat";
}
