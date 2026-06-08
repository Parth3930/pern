// AUTO-GENERATED from tools.json. DO NOT EDIT DIRECTLY.

export interface ToolDefinition {
  name: string;
  category: string;
  description: string;
  params: string[];
  signature: string;
}

export interface FewShotExample {
  categories: string[];
  text: string;
}

export interface RuleDefinition {
  text: string;
  categories: string[];
}

export const TOOLS = [
  {
    name: "launch_app",
    category: "system",
    description: "Opens an app by name (\"calculator\", \"notepad\", \"chrome\", \"discord\").",
    params: ["app_name"],
    signature: "- launch_app(app_name: string) -> Opens an app by name (\"calculator\", \"notepad\", \"chrome\", \"discord\")."
  },
  {
    name: "close_app",
    category: "system",
    description: "Closes an app by name.",
    params: ["app_name"],
    signature: "- close_app(app_name: string) -> Closes an app by name."
  },
  {
    name: "send_whatsapp_message",
    category: "whatsapp",
    description: "Sends WhatsApp message.",
    params: ["recipient", "message"],
    signature: "- send_whatsapp_message(recipient: string, message: string) -> Sends WhatsApp message."
  },
  {
    name: "set_whatsapp_auto_reply",
    category: "whatsapp",
    description: "Enables (true) or disables (false) WhatsApp auto reply for recipient.",
    params: ["recipient", "enabled"],
    signature: "- set_whatsapp_auto_reply(recipient: string, enabled: boolean) -> Enables (true) or disables (false) WhatsApp auto reply for recipient."
  },
  {
    name: "toggle_whatsapp_auto_reply",
    category: "whatsapp",
    description: "Toggles WhatsApp auto reply for recipient.",
    params: ["recipient"],
    signature: "- toggle_whatsapp_auto_reply(recipient: string) -> Toggles WhatsApp auto reply for recipient."
  },
  {
    name: "toggle_whatsapp",
    category: "whatsapp",
    description: "Toggles global WhatsApp auto-reply on/off.",
    params: ["enabled"],
    signature: "- toggle_whatsapp(enabled: boolean) -> Toggles global WhatsApp auto-reply on/off."
  },
  {
    name: "set_discord_status",
    category: "discord",
    description: "Sets bot status and activity.",
    params: ["status", "activity"],
    signature: "- set_discord_status(status: string, activity: string) -> Sets bot status and activity."
  },
  {
    name: "discord_get_channels",
    category: "discord",
    description: "Lists channels in a server.",
    params: [],
    signature: "- discord_get_channels() -> Lists channels in a server."
  },
  {
    name: "discord_send_channel_message",
    category: "discord",
    description: "Sends message to a server channel.",
    params: ["channel_name", "message"],
    signature: "- discord_send_channel_message(channel_name: string, message: string) -> Sends message to a server channel."
  },
  {
    name: "send_email",
    category: "email",
    description: "Sends email.",
    params: ["to", "subject", "body"],
    signature: "- send_email(to: string, subject: string, body: string) -> Sends email."
  },
  {
    name: "save_email_config",
    category: "email",
    description: "Saves SMTP config.",
    params: ["smtp_host", "smtp_port", "sender_email", "smtp_password"],
    signature: "- save_email_config(smtp_host: string, smtp_port: number, sender_email: string, smtp_password: string) -> Saves SMTP config."
  },
  {
    name: "add_whatsapp_contact",
    category: "whatsapp",
    description: "Adds a contact to the allowed auto-reply list.",
    params: ["name", "number"],
    signature: "- add_whatsapp_contact(name: string, number: string) -> Adds a contact to the allowed auto-reply list."
  },
  {
    name: "discord_kick",
    category: "discord",
    description: "Kicks user from server.",
    params: ["user_id", "reason"],
    signature: "- discord_kick(user_id: string, reason: string) -> Kicks user from server."
  },
  {
    name: "discord_ban",
    category: "discord",
    description: "Bans user from server.",
    params: ["user_id", "reason", "delete_message_seconds"],
    signature: "- discord_ban(user_id: string, reason: string, delete_message_seconds: number) -> Bans user from server."
  },
  {
    name: "discord_unban",
    category: "discord",
    description: "Unbans user.",
    params: ["user_id"],
    signature: "- discord_unban(user_id: string) -> Unbans user."
  },
  {
    name: "discord_mute",
    category: "discord",
    description: "Mutes user.",
    params: ["user_id", "duration_mins", "reason"],
    signature: "- discord_mute(user_id: string, duration_mins: number, reason: string) -> Mutes user."
  },
  {
    name: "discord_unmute",
    category: "discord",
    description: "Unmutes user.",
    params: ["user_id"],
    signature: "- discord_unmute(user_id: string) -> Unmutes user."
  },
  {
    name: "discord_warn",
    category: "discord",
    description: "Warns user via DM.",
    params: ["user_id", "reason"],
    signature: "- discord_warn(user_id: string, reason: string) -> Warns user via DM."
  },
  {
    name: "discord_delete_messages",
    category: "discord",
    description: "Purges last count messages.",
    params: ["channel_id", "count"],
    signature: "- discord_delete_messages(channel_id: string, count: number) -> Purges last count messages."
  },
  {
    name: "discord_assign_role",
    category: "discord",
    description: "Assigns role to user.",
    params: ["user_id", "role_id"],
    signature: "- discord_assign_role(user_id: string, role_id: string) -> Assigns role to user."
  },
  {
    name: "discord_remove_role",
    category: "discord",
    description: "Removes role from user.",
    params: ["user_id", "role_id"],
    signature: "- discord_remove_role(user_id: string, role_id: string) -> Removes role from user."
  },
  {
    name: "discord_send_dm",
    category: "discord",
    description: "Sends Discord DM to user.",
    params: ["user_id", "message"],
    signature: "- discord_send_dm(user_id: string, message: string) -> Sends Discord DM to user."
  },
  {
    name: "discord_get_guilds",
    category: "discord",
    description: "Lists Discord servers.",
    params: [],
    signature: "- discord_get_guilds() -> Lists Discord servers."
  },
  {
    name: "get_status",
    category: "system",
    description: "Gets system uptime and health.",
    params: [],
    signature: "- get_status() -> Gets system uptime and health."
  },
  {
    name: "set_discord_behaviour_channel",
    category: "discord",
    description: "Sets behaviour log channel.",
    params: ["channel_id"],
    signature: "- set_discord_behaviour_channel(channel_id: string) -> Sets behaviour log channel."
  },
  {
    name: "get_user_behaviour",
    category: "discord",
    description: "Gets user behaviour log.",
    params: ["user_id"],
    signature: "- get_user_behaviour(user_id: string) -> Gets user behaviour log."
  },
  {
    name: "send_to_cli_agent",
    category: "agents",
    description: "Runs CLI agent (agy, claude-code, codex, hermes, freebuff).",
    params: ["agent_name", "prompt", "project_name"],
    signature: "- send_to_cli_agent(agent_name: string, prompt: string, project_name: string) -> Runs CLI agent (agy, claude-code, codex, hermes, freebuff)."
  },
  {
    name: "get_cli_agents_status",
    category: "agents",
    description: "Gets CLI agents status.",
    params: [],
    signature: "- get_cli_agents_status() -> Gets CLI agents status."
  },
  {
    name: "restart_system",
    category: "system",
    description: "Restarts the system (computer).",
    params: [],
    signature: "- restart_system() -> Restarts the system (computer)."
  },
  {
    name: "shutdown_system",
    category: "system",
    description: "Shuts down the system (computer).",
    params: [],
    signature: "- shutdown_system() -> Shuts down the system (computer)."
  },
  {
    name: "add_todo",
    category: "todos",
    description: "Adds a new todo task/reminder. time is optional local ISO string without 'Z' (e.g., '2026-06-05T12:00:00'). repeat_hours is optional.",
    params: ["text", "time", "repeat_hours"],
    signature: "- add_todo(text: string, time?: string, repeat_hours?: number) -> Adds a new todo task/reminder. time is optional local ISO string without 'Z' (e.g., '2026-06-05T12:00:00'). repeat_hours is optional."
  }
] as const;

export const ALIAS_MAP = {
  "open_app": "launch_app",
  "open_application": "launch_app",
  "run_app": "launch_app",
  "start_app": "launch_app",
  "discord_launch_app": "launch_app",
  "close_application": "close_app",
  "stop_app": "close_app",
  "exit_app": "close_app",
  "kill_app": "close_app",
  "discord_close_app": "close_app",
  "whatsapp_message": "send_whatsapp_message",
  "send_whatsapp": "send_whatsapp_message",
  "discord_send_whatsapp_message": "send_whatsapp_message",
  "whatsapp_auto_reply": "set_whatsapp_auto_reply",
  "whatsapp_auto": "set_whatsapp_auto_reply",
  "discord_set_whatsapp_auto_reply": "set_whatsapp_auto_reply",
  "send_whatsapp_auto_reply": "toggle_whatsapp_auto_reply",
  "discord_toggle_whatsapp_auto_reply": "toggle_whatsapp_auto_reply",
  "discord_set_status": "set_discord_status",
  "discord_set_discord_status": "set_discord_status",
  "get_channels": "discord_get_channels",
  "send_channel_message": "discord_send_channel_message",
  "email": "send_email",
  "send_mail": "send_email",
  "discord_send_email": "send_email",
  "kick": "discord_kick",
  "ban": "discord_ban",
  "unban": "discord_unban",
  "mute": "discord_mute",
  "unmute": "discord_unmute",
  "warn": "discord_warn",
  "delete_messages": "discord_delete_messages",
  "assign_role": "discord_assign_role",
  "remove_role": "discord_remove_role",
  "send_dm": "discord_send_dm",
  "get_guilds": "discord_get_guilds",
  "discord_get_status": "get_status",
  "discord_set_discord_behaviour_channel": "set_discord_behaviour_channel",
  "discord_get_user_behaviour": "get_user_behaviour",
  "discord_send_to_cli_agent": "send_to_cli_agent",
  "discord_get_cli_agents_status": "get_cli_agents_status",
  "restart": "restart_system",
  "reboot": "restart_system",
  "shutdown": "shutdown_system",
  "poweroff": "shutdown_system"
} as const;

export const FEW_SHOTS = [
  {
    categories: [],
    text: "User Request: what is the capital of France?\\nPlan:\\n- conversational()"
  },
  {
    categories: ["system"],
    text: "User Request: open chrome and notepad\\nPlan:\\n- launch_app(app_name=\"chrome\")\\n- launch_app(app_name=\"notepad\")"
  },
  {
    categories: ["system"],
    text: "User Request: open both\\nPlan:\\n- conversational()"
  },
  {
    categories: ["system"],
    text: "User Request: open whatsapp and close notepad\\nPlan:\\n- launch_app(app_name=\"whatsapp\")\\n- close_app(app_name=\"notepad\")"
  },
  {
    categories: ["system"],
    text: "User Request: close chrome and notepad\\nPlan:\\n- close_app(app_name=\"chrome\")\\n- close_app(app_name=\"notepad\")"
  },
  {
    categories: ["system"],
    text: "User Request: shut down my computer\\nPlan:\\n- shutdown_system()"
  },
  {
    categories: ["system"],
    text: "User Request: restart the system\\nPlan:\\n- restart_system()"
  },
  {
    categories: ["whatsapp"],
    text: "User Request: message Dave and ask if he is free, and send same message to Frank, and open whatsapp, and turn auto reply on for both of them\\nPlan:\\n- send_whatsapp_message(recipient=\"Dave\", message=\"Hey Dave, are you free?\")\\n- send_whatsapp_message(recipient=\"Frank\", message=\"Hey Frank, are you free?\")\\n- launch_app(app_name=\"whatsapp\")\\n- set_whatsapp_auto_reply(recipient=\"Dave\", enabled=true)\\n- set_whatsapp_auto_reply(recipient=\"Frank\", enabled=true)"
  },
  {
    categories: ["discord"],
    text: "User Request: warn <@456> for toxicity, then mute them for 10 minutes, then assign role 888 to them, then log this in channel logs saying warned and muted user 456\\nPlan:\\n- discord_warn(user_id=\"456\", reason=\"toxicity\")\\n- discord_mute(user_id=\"456\", duration_mins=10, reason=\"toxicity\")\\n- discord_assign_role(user_id=\"456\", role_id=\"888\")\\n- discord_send_channel_message(channel_name=\"logs\", message=\"warned and muted user 456\")"
  },
  {
    categories: ["discord"],
    text: "User Request: dm <@123> asking if they can review the change\\nPlan:\\n- discord_send_dm(user_id=\"123\", message=\"Hey, can you review the change?\")"
  },
  {
    categories: ["discord"],
    text: "User Request: send a message to general channel saying hello everyone\\nPlan:\\n- discord_send_channel_message(channel_name=\"general\", message=\"hello everyone\")"
  },
  {
    categories: ["email", "discord"],
    text: "User Request: save email config with host smtp.gmail.com port 587 sender me@gmail.com and password pass123, then send email to alice@gmail.com with subject Report and say hello, then dm <@456> asking if they can check it\\nPlan:\\n- save_email_config(smtp_host=\"smtp.gmail.com\", smtp_port=587, sender_email=\"me@gmail.com\", smtp_password=\"pass123\")\\n- send_email(to=\"alice@gmail.com\", subject=\"Report\", body=\"hello\")\\n- discord_send_dm(user_id=\"456\", message=\"Hey, can you check it?\")"
  },
  {
    categories: ["agents", "whatsapp"],
    text: "User Request: run agy on project Pern to build it, then run freebuff to run tests, and if both are done message Bob saying all good, and toggle auto reply for him\\nPlan:\\n- send_to_cli_agent(agent_name=\"agy\", prompt=\"build it\", project_name=\"Pern\")\\n- send_to_cli_agent(agent_name=\"freebuff\", prompt=\"run tests\", project_name=\"Pern\")\\n- send_whatsapp_message(recipient=\"Bob\", message=\"all good\")\\n- toggle_whatsapp_auto_reply(recipient=\"Bob\")"
  },
  {
    categories: ["system", "discord"],
    text: "User Request: open chrome, check status of cli agents, and set my discord status to idle with activity away\\nPlan:\\n- launch_app(app_name=\"chrome\")\\n- get_cli_agents_status()\\n- set_discord_status(status=\"idle\", activity=\"away\")"
  },
  {
    categories: ["whatsapp"],
    text: "User Request: add contact Alice with number +9876543, then message Alice saying hello, then do that message again, then message Dave on WhatsApp saying hi Alice joined, then do the Dave message twice more\\nPlan:\\n- add_whatsapp_contact(name=\"Alice\", number=\"+9876543\")\\n- send_whatsapp_message(recipient=\"Alice\", message=\"hello\")\\n- send_whatsapp_message(recipient=\"Alice\", message=\"hello\")\\n- send_whatsapp_message(recipient=\"Dave\", message=\"hi Alice joined\")\\n- send_whatsapp_message(recipient=\"Dave\", message=\"hi Alice joined\")\\n- send_whatsapp_message(recipient=\"Dave\", message=\"hi Alice joined\")"
  },
  {
    categories: ["discord"],
    text: "User Request: ban <@789> for raiding, delete 30 messages in channel 888888, then set behaviour log channel to 888888, then get behaviour logs for <@789> to verify\\nPlan:\\n- discord_ban(user_id=\"789\", reason=\"raiding\", delete_message_seconds=0)\\n- discord_delete_messages(channel_id=\"888888\", count=30)\\n- set_discord_behaviour_channel(channel_id=\"888888\")\\n- get_user_behaviour(user_id=\"789\")"
  },
  {
    categories: ["whatsapp", "email"],
    text: "User Request: send a whatsapp message to Alice asking if she can check the report, then email her at alice@gmail.com with subject Report Review and body please check the report, then do that email again, then tell her on whatsapp that it is sent\\nPlan:\\n- send_whatsapp_message(recipient=\"Alice\", message=\"Hey Alice, can you check the report?\")\\n- send_email(to=\"alice@gmail.com\", subject=\"Report Review\", body=\"please check the report\")\\n- send_email(to=\"alice@gmail.com\", subject=\"Report Review\", body=\"please check the report\")\\n- send_whatsapp_message(recipient=\"Alice\", message=\"it is sent\")"
  },
  {
    categories: ["whatsapp", "discord"],
    text: "User Request: turn global whatsapp auto reply off, then unban <@111> on discord\\nPlan:\\n- toggle_whatsapp(enabled=false)\\n- discord_unban(user_id=\"111\")"
  },
  {
    categories: ["whatsapp"],
    text: "User Request: message Charlie on WhatsApp asking how he is, and toggle auto reply for him\\nPlan:\\n- send_whatsapp_message(recipient=\"Charlie\", message=\"Hey Charlie, how are you?\")\\n- toggle_whatsapp_auto_reply(recipient=\"Charlie\")"
  },
  {
    categories: ["whatsapp"],
    text: "User Request: message Alice\\nPlan:\\n- conversational()"
  },
  {
    categories: ["whatsapp"],
    text: "User Request: send the same message to Parth\\nPlan:\\n- conversational()"
  },
  {
    categories: ["whatsapp"],
    text: "[Owner context: Recent WhatsApp details: ### LAST WHATSAPP\\nRecipient(s): Rahul\\nMessage: this is a test]\\n\\nUser Request: send the same message to Parth\\nPlan:\\n- send_whatsapp_message(recipient=\"Parth\", message=\"this is a test\")"
  },
  {
    categories: ["banter"],
    text: "User Request: tell me a joke\\nPlan:\\n- conversational()"
  },
  {
    categories: ["banter"],
    text: "User Request: give me a flirty pickup line\\nPlan:\\n- conversational()"
  }
] as const;

export const RULES = [
  {
    text: "You are Pern's AI Agent. Your job is to translate user requests directly into a list of tool actions starting with \"- \".",
    categories: []
  },
  {
    text: "If the request is conversational (e.g. greetings, questions with no tool mapping), output exactly: Plan:\\n- conversational()",
    categories: []
  },
  {
    text: "1. If input contains action keywords (message, send, email, discord, whatsapp, app, auto reply, agents, open, close, shutdown, restart), it is NOT conversational.",
    categories: []
  },
  {
    text: "2. Resolve pronouns (it, them) to their original referents. Always output actions in the exact chronological order requested.",
    categories: []
  },
  {
    text: "3. Do not output guild_id; it's auto-injected.",
    categories: ["discord"]
  },
  {
    text: "4. MESSAGE FORMATTING:",
    categories: ["whatsapp", "discord", "email"]
  },
  {
    text: "   a. \"saying [text]\" or \"say [text]\" -> use that exact text as message. This overrides any prefix rule.",
    categories: ["whatsapp", "discord"]
  },
  {
    text: "   b. Convert indirect requests (\"ask if he is available\") to direct speech: \"Hey [name], are you available?\"",
    categories: ["whatsapp", "discord"]
  },
  {
    text: "   c. \"message Bob to open discord\" = send_whatsapp_message(\"Bob\", \"open discord\"), NOT launch_app. Do not execute actions inside a message.",
    categories: ["whatsapp"]
  },
  {
    text: "   d. \"dm <@123> asking...\" -> discord_send_dm(user_id, \"Hey, can you...\"). Prefix DMs for mentions with \"Hey, \".",
    categories: ["discord"]
  },
  {
    text: "   e. For named contacts, ALWAYS prefix messages with \"Hey [name], \" unless rule 4a applies. For <@mentions>, use \"Hey, \" instead.",
    categories: ["whatsapp", "discord"]
  },
  {
    text: "   g. Preserve the exact spelling and casing of all names as written in the request.",
    categories: ["whatsapp", "discord"]
  },
  {
    text: "   f. Preserve the exact spelling and casing of all names and recipients as written in the request.",
    categories: ["email"]
  },
  {
    text: "5. AUTO-REPLY: \"turn auto reply on/off\" = set_whatsapp_auto_reply(recipient, enabled). Only use toggle_whatsapp_auto_reply when \"toggle\" is explicitly used.",
    categories: ["whatsapp"]
  },
  {
    text: "6. BAN VS DELETE: discord_ban's delete_message_seconds is ONLY for deleting the banned user's history. Channel message purging MUST use discord_delete_messages.",
    categories: ["discord"]
  },
  {
    text: "7. NO CODE: NEVER output code blocks, if/else, loops, variables, or comments. Output ONLY a flat list of tool calls starting with \"- \".",
    categories: []
  },
  {
    text: "8. NO HALLUCINATED TOOLS: Only use the allowed tools listed below.",
    categories: []
  },
  {
    text: "9. REASON PROPAGATION: If a reason is given for the first action in a chain (e.g. \"warn for spamming, then mute\"), propagate it to subsequent relevant actions.",
    categories: ["discord"]
  },
  {
    text: "10. DISCORD VS WHATSAPP: Channel/role/ban/mute/unban/<@mentions> map to Discord tools. Do NOT use send_whatsapp_message for Discord.",
    categories: ["whatsapp", "discord"]
  },
  {
    text: "11. For 3+ actions, output a \"Todo:\" section before \"Plan:\". For simple requests, omit Todo.",
    categories: []
  },
  {
    text: "12. STRICT ACTION MATCHING: Only generate tools that correspond directly to actions explicitly requested by the user. DO NOT launch/open any app unless the user explicitly requests to open, launch, start, run, or show it. DO NOT close/exit any app unless the user explicitly requests to close, quit, exit, or terminate it. NEVER close an app immediately after launching it unless specifically instructed.",
    categories: []
  },
  {
    text: "13. BANTER & FUN: When responding to a conversational request for a joke, pickup line, or friendly/flirtatious banter, be highly cooperative, warm, and humorous. Provide a fun and lighthearted response instead of declining or being overly formal.",
    categories: ["banter"]
  },
  {
    text: "14. AMBIGUOUS OR MISSING CONTEXT: If a request is ambiguous or missing required parameters (e.g., \"message Bob\" without a message body, or \"send the same message\" when there is no previous message in context, or \"open both\" when no apps have been launched), DO NOT guess, assume, or hallucinate parameters from the few-shot examples. Instead, map it to: Plan:\\n- conversational() so that the assistant can ask the user for clarification.",
    categories: []
  }
] as const;

export const DISCORD_TOOLS_WITH_GUILD_ID = [
  "discord_get_channels",
  "discord_send_channel_message",
  "discord_kick",
  "discord_ban",
  "discord_unban",
  "discord_mute",
  "discord_unmute",
  "discord_warn",
  "discord_assign_role",
  "discord_remove_role"
] as const;

export const TOOL_DESCRIPTIONS = {
  "launch_app": "Opens an app by name (\"calculator\", \"notepad\", \"chrome\", \"discord\").",
  "close_app": "Closes an app by name.",
  "send_whatsapp_message": "Sends WhatsApp message.",
  "set_whatsapp_auto_reply": "Enables (true) or disables (false) WhatsApp auto reply for recipient.",
  "toggle_whatsapp_auto_reply": "Toggles WhatsApp auto reply for recipient.",
  "toggle_whatsapp": "Toggles global WhatsApp auto-reply on/off.",
  "set_discord_status": "Sets bot status and activity.",
  "discord_get_channels": "Lists channels in a server.",
  "discord_send_channel_message": "Sends message to a server channel.",
  "send_email": "Sends email.",
  "save_email_config": "Saves SMTP config.",
  "add_whatsapp_contact": "Adds a contact to the allowed auto-reply list.",
  "discord_kick": "Kicks user from server.",
  "discord_ban": "Bans user from server.",
  "discord_unban": "Unbans user.",
  "discord_mute": "Mutes user.",
  "discord_unmute": "Unmutes user.",
  "discord_warn": "Warns user via DM.",
  "discord_delete_messages": "Purges last count messages.",
  "discord_assign_role": "Assigns role to user.",
  "discord_remove_role": "Removes role from user.",
  "discord_send_dm": "Sends Discord DM to user.",
  "discord_get_guilds": "Lists Discord servers.",
  "get_status": "Gets system uptime and health.",
  "set_discord_behaviour_channel": "Sets behaviour log channel.",
  "get_user_behaviour": "Gets user behaviour log.",
  "send_to_cli_agent": "Runs CLI agent (agy, claude-code, codex, hermes, freebuff).",
  "get_cli_agents_status": "Gets CLI agents status.",
  "restart_system": "Restarts the system (computer).",
  "shutdown_system": "Shuts down the system (computer).",
  "add_todo": "Adds a new todo task/reminder. time is optional local ISO string without 'Z' (e.g., '2026-06-05T12:00:00'). repeat_hours is optional."
} as const;

export const TOOL_PARAMS = {
  "launch_app": ["app_name"],
  "close_app": ["app_name"],
  "send_whatsapp_message": ["recipient", "message"],
  "set_whatsapp_auto_reply": ["recipient", "enabled"],
  "toggle_whatsapp_auto_reply": ["recipient"],
  "toggle_whatsapp": ["enabled"],
  "set_discord_status": ["status", "activity"],
  "discord_get_channels": [],
  "discord_send_channel_message": ["channel_name", "message"],
  "send_email": ["to", "subject", "body"],
  "save_email_config": ["smtp_host", "smtp_port", "sender_email", "smtp_password"],
  "add_whatsapp_contact": ["name", "number"],
  "discord_kick": ["user_id", "reason"],
  "discord_ban": ["user_id", "reason", "delete_message_seconds"],
  "discord_unban": ["user_id"],
  "discord_mute": ["user_id", "duration_mins", "reason"],
  "discord_unmute": ["user_id"],
  "discord_warn": ["user_id", "reason"],
  "discord_delete_messages": ["channel_id", "count"],
  "discord_assign_role": ["user_id", "role_id"],
  "discord_remove_role": ["user_id", "role_id"],
  "discord_send_dm": ["user_id", "message"],
  "discord_get_guilds": [],
  "get_status": [],
  "set_discord_behaviour_channel": ["channel_id"],
  "get_user_behaviour": ["user_id"],
  "send_to_cli_agent": ["agent_name", "prompt", "project_name"],
  "get_cli_agents_status": [],
  "restart_system": [],
  "shutdown_system": [],
  "add_todo": ["text", "time", "repeat_hours"]
} as const;
