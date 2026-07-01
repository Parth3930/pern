// AUTO-GENERATED from tools.json. DO NOT EDIT DIRECTLY.

#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub params: &'static [&'static str],
    pub signature: &'static str,
}

#[derive(Debug, Clone)]
pub struct FewShotExample {
    pub categories: &'static [&'static str],
    pub text: &'static str,
}

#[derive(Debug, Clone)]
pub struct RuleDefinition {
    pub text: &'static str,
    pub categories: &'static [&'static str],
}

pub const TOOLS: &[ToolDefinition] = &[
    ToolDefinition {
        name: "launch_app",
        category: "apps",
        description: "Opens an app by name (\"calculator\", \"notepad\", \"chrome\", \"discord\", \"whatsapp\").",
        params: &["app_name"],
        signature: "- launch_app(app_name: string) -> Opens an app by name (\"calculator\", \"notepad\", \"chrome\", \"discord\", \"whatsapp\").",
    },
    ToolDefinition {
        name: "close_app",
        category: "apps",
        description: "Closes an app by name.",
        params: &["app_name"],
        signature: "- close_app(app_name: string) -> Closes an app by name.",
    },
    ToolDefinition {
        name: "send_whatsapp_message",
        category: "whatsapp",
        description: "Sends WhatsApp message.",
        params: &["recipient", "message"],
        signature: "- send_whatsapp_message(recipient: string, message: string) -> Sends WhatsApp message.",
    },
    ToolDefinition {
        name: "set_whatsapp_auto_reply",
        category: "whatsapp",
        description: "Enables (true) or disables (false) WhatsApp auto reply for recipient.",
        params: &["recipient", "enabled"],
        signature: "- set_whatsapp_auto_reply(recipient: string, enabled: boolean) -> Enables (true) or disables (false) WhatsApp auto reply for recipient.",
    },
    ToolDefinition {
        name: "toggle_whatsapp_auto_reply",
        category: "whatsapp",
        description: "Toggles WhatsApp auto reply for recipient.",
        params: &["recipient"],
        signature: "- toggle_whatsapp_auto_reply(recipient: string) -> Toggles WhatsApp auto reply for recipient.",
    },
    ToolDefinition {
        name: "toggle_whatsapp",
        category: "whatsapp",
        description: "Toggles global WhatsApp auto-reply on/off.",
        params: &["enabled"],
        signature: "- toggle_whatsapp(enabled: boolean) -> Toggles global WhatsApp auto-reply on/off.",
    },
    ToolDefinition {
        name: "set_discord_status",
        category: "discord",
        description: "Sets bot status and activity.",
        params: &["status", "activity"],
        signature: "- set_discord_status(status: string, activity: string) -> Sets bot status and activity.",
    },
    ToolDefinition {
        name: "discord_get_channels",
        category: "discord",
        description: "Lists channels in a server.",
        params: &[],
        signature: "- discord_get_channels() -> Lists channels in a server.",
    },
    ToolDefinition {
        name: "discord_send_channel_message",
        category: "discord",
        description: "Sends message to a server channel.",
        params: &["channel_name", "message"],
        signature: "- discord_send_channel_message(channel_name: string, message: string) -> Sends message to a server channel.",
    },
    ToolDefinition {
        name: "send_email",
        category: "email",
        description: "Sends email.",
        params: &["to", "subject", "body"],
        signature: "- send_email(to: string, subject: string, body: string) -> Sends email.",
    },
    ToolDefinition {
        name: "save_email_config",
        category: "email",
        description: "Saves SMTP config.",
        params: &["smtp_host", "smtp_port", "sender_email", "smtp_password"],
        signature: "- save_email_config(smtp_host: string, smtp_port: number, sender_email: string, smtp_password: string) -> Saves SMTP config.",
    },
    ToolDefinition {
        name: "add_whatsapp_contact",
        category: "whatsapp",
        description: "Adds a contact to the allowed auto-reply list.",
        params: &["name", "number"],
        signature: "- add_whatsapp_contact(name: string, number: string) -> Adds a contact to the allowed auto-reply list.",
    },
    ToolDefinition {
        name: "discord_kick",
        category: "discord",
        description: "Kicks user from server.",
        params: &["user_id", "reason"],
        signature: "- discord_kick(user_id: string, reason: string) -> Kicks user from server.",
    },
    ToolDefinition {
        name: "discord_ban",
        category: "discord",
        description: "Bans user from server.",
        params: &["user_id", "reason", "delete_message_seconds"],
        signature: "- discord_ban(user_id: string, reason: string, delete_message_seconds: number) -> Bans user from server.",
    },
    ToolDefinition {
        name: "discord_unban",
        category: "discord",
        description: "Unbans user.",
        params: &["user_id"],
        signature: "- discord_unban(user_id: string) -> Unbans user.",
    },
    ToolDefinition {
        name: "discord_mute",
        category: "discord",
        description: "Mutes user.",
        params: &["user_id", "duration_mins", "reason"],
        signature: "- discord_mute(user_id: string, duration_mins: number, reason: string) -> Mutes user.",
    },
    ToolDefinition {
        name: "discord_unmute",
        category: "discord",
        description: "Unmutes user.",
        params: &["user_id"],
        signature: "- discord_unmute(user_id: string) -> Unmutes user.",
    },
    ToolDefinition {
        name: "discord_warn",
        category: "discord",
        description: "Warns user via DM.",
        params: &["user_id", "reason"],
        signature: "- discord_warn(user_id: string, reason: string) -> Warns user via DM.",
    },
    ToolDefinition {
        name: "discord_delete_messages",
        category: "discord",
        description: "Purges last count messages.",
        params: &["channel_id", "count"],
        signature: "- discord_delete_messages(channel_id: string, count: number) -> Purges last count messages.",
    },
    ToolDefinition {
        name: "discord_assign_role",
        category: "discord",
        description: "Assigns role to user.",
        params: &["user_id", "role_id"],
        signature: "- discord_assign_role(user_id: string, role_id: string) -> Assigns role to user.",
    },
    ToolDefinition {
        name: "discord_remove_role",
        category: "discord",
        description: "Removes role from user.",
        params: &["user_id", "role_id"],
        signature: "- discord_remove_role(user_id: string, role_id: string) -> Removes role from user.",
    },
    ToolDefinition {
        name: "discord_send_dm",
        category: "discord",
        description: "Sends Discord DM to user.",
        params: &["user_id", "message"],
        signature: "- discord_send_dm(user_id: string, message: string) -> Sends Discord DM to user.",
    },
    ToolDefinition {
        name: "discord_get_guilds",
        category: "discord",
        description: "Lists Discord servers.",
        params: &[],
        signature: "- discord_get_guilds() -> Lists Discord servers.",
    },
    ToolDefinition {
        name: "get_status",
        category: "system",
        description: "Gets system uptime and health.",
        params: &[],
        signature: "- get_status() -> Gets system uptime and health.",
    },
    ToolDefinition {
        name: "set_discord_behaviour_channel",
        category: "discord",
        description: "Sets behaviour log channel.",
        params: &["channel_id"],
        signature: "- set_discord_behaviour_channel(channel_id: string) -> Sets behaviour log channel.",
    },
    ToolDefinition {
        name: "get_user_behaviour",
        category: "discord",
        description: "Gets user behaviour log.",
        params: &["user_id"],
        signature: "- get_user_behaviour(user_id: string) -> Gets user behaviour log.",
    },
    ToolDefinition {
        name: "send_to_cli_agent",
        category: "agents",
        description: "Runs CLI agent (agy, claude-code, codex, hermes, freebuff).",
        params: &["agent_name", "prompt", "project_name"],
        signature: "- send_to_cli_agent(agent_name: string, prompt: string, project_name: string) -> Runs CLI agent (agy, claude-code, codex, hermes, freebuff).",
    },
    ToolDefinition {
        name: "get_cli_agents_status",
        category: "agents",
        description: "Gets CLI agents status.",
        params: &[],
        signature: "- get_cli_agents_status() -> Gets CLI agents status.",
    },
    ToolDefinition {
        name: "restart_system",
        category: "system",
        description: "Restarts the system (computer).",
        params: &[],
        signature: "- restart_system() -> Restarts the system (computer).",
    },
    ToolDefinition {
        name: "shutdown_system",
        category: "system",
        description: "Shuts down the system (computer).",
        params: &[],
        signature: "- shutdown_system() -> Shuts down the system (computer).",
    },
    ToolDefinition {
        name: "add_todo",
        category: "todos",
        description: "Adds a new todo task/reminder. time is optional local ISO string without 'Z' (e.g., '2026-06-05T12:00:00'). repeat_hours is optional.",
        params: &["text", "time", "repeat_hours"],
        signature: "- add_todo(text: string, time?: string, repeat_hours?: number) -> Adds a new todo task/reminder. time is optional local ISO string without 'Z' (e.g., '2026-06-05T12:00:00'). repeat_hours is optional.",
    },
    ToolDefinition {
        name: "remember_fact",
        category: "memory",
        description: "Stores a fact in long-term memory. category is one of: person, project, preference, recurring_task, other. key is the canonical lookup name (e.g. 'robert'). value is the fact itself. aliases is an optional list of alternate names that should also resolve to this fact (e.g. ['Bob','Bobby'] for robert).",
        params: &["category", "key", "value", "aliases"],
        signature: "- remember_fact(category: string, key: string, value: string, aliases?: string[]) -> Stores a fact in long-term memory. category is one of: person, project, preference, recurring_task, other. key is the canonical lookup name (e.g. 'robert'). value is the fact itself. aliases is an optional list of alternate names that should also resolve to this fact (e.g. ['Bob','Bobby'] for robert).",
    },
    ToolDefinition {
        name: "recall_fact",
        category: "memory",
        description: "Searches long-term memory for facts matching the query. Returns up to k (default 10) hits sorted by relevance, each shown as 'key: value (category)'.",
        params: &["query", "k"],
        signature: "- recall_fact(query: string, k?: number) -> Searches long-term memory for facts matching the query. Returns up to k (default 10) hits sorted by relevance, each shown as 'key: value (category)'.",
    },
    ToolDefinition {
        name: "forget_fact",
        category: "memory",
        description: "Removes a fact from long-term memory. key is the canonical name or any known alias of the fact to forget.",
        params: &["key"],
        signature: "- forget_fact(key: string) -> Removes a fact from long-term memory. key is the canonical name or any known alias of the fact to forget.",
    },
    ToolDefinition {
        name: "list_automations",
        category: "automation",
        description: "Lists the user's saved automations. Returns a list of 'name: trigger description (N actions, last run ok/failed/never)' lines. Use this to discover what automations already exist before suggesting changes or running one. query is optional free-text filter (substring match on name + trigger); k defaults to 10 and caps the result count.",
        params: &["query", "k"],
        signature: "- list_automations(query?: string, k?: number) -> Lists the user's saved automations. Returns a list of 'name: trigger description (N actions, last run ok/failed/never)' lines. Use this to discover what automations already exist before suggesting changes or running one. query is optional free-text filter (substring match on name + trigger); k defaults to 10 and caps the result count.",
    },
    ToolDefinition {
        name: "run_automation",
        category: "automation",
        description: "Runs a saved automation by name immediately. Use list_automations first to discover the right name. Returns a confirmation line with the run id and overall ok/failed status.",
        params: &["name"],
        signature: "- run_automation(name: string) -> Runs a saved automation by name immediately. Use list_automations first to discover the right name. Returns a confirmation line with the run id and overall ok/failed status.",
    },
    ToolDefinition {
        name: "join_minecraft_world",
        category: "minecraft",
        description: "Spawns a bot player named Pern to join a Minecraft Java edition world (cracked servers supported via offline auth). host is the IP/domain of the server (defaults to 'localhost'), port is optional (defaults to auto-detect or 25565), version defaults to '1.20.4'.",
        params: &["port", "host", "version"],
        signature: "- join_minecraft_world(port?: number, host?: string, version?: string) -> Spawns a bot player named Pern to join a Minecraft Java edition world (cracked servers supported via offline auth). host is the IP/domain of the server (defaults to 'localhost'), port is optional (defaults to auto-detect or 25565), version defaults to '1.20.4'.",
    },
    ToolDefinition {
        name: "disconnect_minecraft_world",
        category: "minecraft",
        description: "Disconnects the Pern bot player from the Minecraft world.",
        params: &[],
        signature: "- disconnect_minecraft_world() -> Disconnects the Pern bot player from the Minecraft world.",
    },
    ToolDefinition {
        name: "read_file",
        category: "files",
        description: "Reads the contents of a file in the project.",
        params: &["path"],
        signature: "- read_file(path: string) -> Reads the contents of a file in the project.",
    },
    ToolDefinition {
        name: "list_dir",
        category: "files",
        description: "Lists the contents of a directory in the project.",
        params: &["path"],
        signature: "- list_dir(path: string) -> Lists the contents of a directory in the project.",
    },
    ToolDefinition {
        name: "web_search",
        category: "web",
        description: "Performs a web search through Chrome (Playwright) and returns a compact answer.",
        params: &["query"],
        signature: "- web_search(query: string) -> Performs a web search through Chrome (Playwright) and returns a compact answer.",
    }
];

pub const ALIAS_MAP: &[(&str, &str)] = &[
    ("open_app", "launch_app"),
    ("open_application", "launch_app"),
    ("run_app", "launch_app"),
    ("start_app", "launch_app"),
    ("discord_launch_app", "launch_app"),
    ("close_application", "close_app"),
    ("stop_app", "close_app"),
    ("exit_app", "close_app"),
    ("kill_app", "close_app"),
    ("discord_close_app", "close_app"),
    ("whatsapp_message", "send_whatsapp_message"),
    ("send_whatsapp", "send_whatsapp_message"),
    ("discord_send_whatsapp_message", "send_whatsapp_message"),
    ("whatsapp_auto_reply", "set_whatsapp_auto_reply"),
    ("whatsapp_auto", "set_whatsapp_auto_reply"),
    ("discord_set_whatsapp_auto_reply", "set_whatsapp_auto_reply"),
    ("send_whatsapp_auto_reply", "toggle_whatsapp_auto_reply"),
    ("discord_toggle_whatsapp_auto_reply", "toggle_whatsapp_auto_reply"),
    ("discord_set_status", "set_discord_status"),
    ("discord_set_discord_status", "set_discord_status"),
    ("get_channels", "discord_get_channels"),
    ("send_channel_message", "discord_send_channel_message"),
    ("email", "send_email"),
    ("send_mail", "send_email"),
    ("discord_send_email", "send_email"),
    ("kick", "discord_kick"),
    ("ban", "discord_ban"),
    ("unban", "discord_unban"),
    ("mute", "discord_mute"),
    ("unmute", "discord_unmute"),
    ("warn", "discord_warn"),
    ("delete_messages", "discord_delete_messages"),
    ("assign_role", "discord_assign_role"),
    ("remove_role", "discord_remove_role"),
    ("send_dm", "discord_send_dm"),
    ("get_guilds", "discord_get_guilds"),
    ("discord_get_status", "get_status"),
    ("discord_set_discord_behaviour_channel", "set_discord_behaviour_channel"),
    ("discord_get_user_behaviour", "get_user_behaviour"),
    ("discord_send_to_cli_agent", "send_to_cli_agent"),
    ("discord_get_cli_agents_status", "get_cli_agents_status"),
    ("restart", "restart_system"),
    ("reboot", "restart_system"),
    ("shutdown", "shutdown_system"),
    ("poweroff", "shutdown_system"),
    ("remember", "remember_fact"),
    ("memorize", "remember_fact"),
    ("save_fact", "remember_fact"),
    ("store_fact", "remember_fact"),
    ("remember_query", "recall_fact"),
    ("search_memory", "recall_fact"),
    ("find_fact", "recall_fact"),
    ("forget", "forget_fact"),
    ("delete_fact", "forget_fact"),
    ("remove_fact", "forget_fact"),
    ("list_automation", "list_automations"),
    ("show_automations", "list_automations"),
    ("get_automations", "list_automations"),
    ("trigger_automation", "run_automation"),
    ("execute_automation", "run_automation"),
    ("fire_automation", "run_automation"),
    ("minecraft_join", "join_minecraft_world"),
    ("join_minecraft", "join_minecraft_world"),
    ("join_world", "join_minecraft_world"),
    ("connect_minecraft", "join_minecraft_world"),
    ("minecraft_disconnect", "disconnect_minecraft_world"),
    ("disconnect_minecraft", "disconnect_minecraft_world"),
    ("leave_minecraft", "disconnect_minecraft_world"),
    ("read", "read_file"),
    ("view_file", "read_file"),
    ("ls", "list_dir"),
    ("dir", "list_dir"),
    ("list", "list_dir"),
    ("search_web", "web_search"),
    ("search", "web_search")
];

pub const FEW_SHOTS: &[FewShotExample] = &[
    FewShotExample {
        categories: &[],
        text: "User Request: what is the capital of France?\\nPlan:\\n- conversational()",
    },
    FewShotExample {
        categories: &["apps"],
        text: "User Request: open chrome and notepad\\nPlan:\\n- launch_app(app_name=\"chrome\")\\n- launch_app(app_name=\"notepad\")",
    },
    FewShotExample {
        categories: &["apps"],
        text: "User Request: open both\\nPlan:\\n- conversational()",
    },
    FewShotExample {
        categories: &["apps"],
        text: "User Request: open calculator and close notepad\\nPlan:\\n- launch_app(app_name=\"calculator\")\\n- close_app(app_name=\"notepad\")",
    },
    FewShotExample {
        categories: &["apps"],
        text: "User Request: close chrome and notepad\\nPlan:\\n- close_app(app_name=\"chrome\")\\n- close_app(app_name=\"notepad\")",
    },
    FewShotExample {
        categories: &["system"],
        text: "User Request: shut down my computer\\nPlan:\\n- shutdown_system()",
    },
    FewShotExample {
        categories: &["system"],
        text: "User Request: restart the system\\nPlan:\\n- restart_system()",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: ask rahul how he doing on whatsapp\nPlan:\n- send_whatsapp_message(recipient=\"Rahul\", message=\"Hey Rahul, how are you doing?\")",
    },
    FewShotExample {
        categories: &["discord"],
        text: "User Request: warn <@456> for toxicity, then mute them for 10 minutes, then assign role 888 to them, then log this in channel logs saying warned and muted user 456\\nPlan:\\n- discord_warn(user_id=\"456\", reason=\"toxicity\")\\n- discord_mute(user_id=\"456\", duration_mins=10, reason=\"toxicity\")\\n- discord_assign_role(user_id=\"456\", role_id=\"888\")\\n- discord_send_channel_message(channel_name=\"logs\", message=\"warned and muted user 456\")",
    },
    FewShotExample {
        categories: &["discord"],
        text: "User Request: dm <@123> asking if they can review the change\\nPlan:\\n- discord_send_dm(user_id=\"123\", message=\"Hey, can you review the change?\")",
    },
    FewShotExample {
        categories: &["discord"],
        text: "User Request: send a message to general channel saying hello everyone\\nPlan:\\n- discord_send_channel_message(channel_name=\"general\", message=\"hello everyone\")",
    },
    FewShotExample {
        categories: &["email", "discord"],
        text: "User Request: save email config with host smtp.gmail.com port 587 sender me@gmail.com and password pass123, then send email to alice@gmail.com with subject Report and say hello, then dm <@456> asking if they can check it\\nPlan:\\n- save_email_config(smtp_host=\"smtp.gmail.com\", smtp_port=587, sender_email=\"me@gmail.com\", smtp_password=\"pass123\")\\n- send_email(to=\"alice@gmail.com\", subject=\"Report\", body=\"hello\")\\n- discord_send_dm(user_id=\"456\", message=\"Hey, can you check it?\")",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: send the poem to Rahul on whatsapp\\nPlan:\\n- send_whatsapp_message(recipient=\"Rahul\", message=\"{generated_content}\")",
    },
    FewShotExample {
        categories: &["discord"],
        text: "User Request: post it in general channel\\nPlan:\\n- discord_send_channel_message(channel_name=\"general\", message=\"{generated_content}\")",
    },
    FewShotExample {
        categories: &["email"],
        text: "User Request: email the poem to Bob\\nPlan:\\n- send_email(to=\"bob@gmail.com\", subject=\"Generated Poem\", body=\"{generated_content}\")",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: ask rahul how he doing on whatsapp\\nPlan:\\n- send_whatsapp_message(recipient=\"Rahul\", message=\"Hey Rahul, how are you doing?\")",
    },
    FewShotExample {
        categories: &["agents", "whatsapp"],
        text: "User Request: run agy on project Pern to build it, then run freebuff to run tests, and if both are done message Bob saying all good, and toggle auto reply for him\\nPlan:\\n- send_to_cli_agent(agent_name=\"agy\", prompt=\"build it\", project_name=\"Pern\")\\n- send_to_cli_agent(agent_name=\"freebuff\", prompt=\"run tests\", project_name=\"Pern\")\\n- send_whatsapp_message(recipient=\"Bob\", message=\"all good\")\\n- toggle_whatsapp_auto_reply(recipient=\"Bob\")",
    },
    FewShotExample {
        categories: &["system", "discord"],
        text: "User Request: open chrome, check status of cli agents, and set my discord status to idle with activity away\\nPlan:\\n- launch_app(app_name=\"chrome\")\\n- get_cli_agents_status()\\n- set_discord_status(status=\"idle\", activity=\"away\")",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: message Dave and ask if he is free, and send same message to Frank, and open whatsapp, and turn auto reply on for both of them\\nPlan:\\n- send_whatsapp_message(recipient=\"Dave\", message=\"Hey Dave, are you free?\")\\n- send_whatsapp_message(recipient=\"Frank\", message=\"Hey Frank, are you free?\")\\n- launch_app(app_name=\"whatsapp\")\\n- set_whatsapp_auto_reply(recipient=\"Dave\", enabled=true)\\n- set_whatsapp_auto_reply(recipient=\"Frank\", enabled=true)",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: add contact Alice with number +9876543, then message Alice saying hello, then do that message again, then message Dave on WhatsApp saying hi Alice joined, then do the Dave message twice more\\nPlan:\\n- add_whatsapp_contact(name=\"Alice\", number=\"+9876543\")\\n- send_whatsapp_message(recipient=\"Alice\", message=\"hello\")\\n- send_whatsapp_message(recipient=\"Alice\", message=\"hello\")\\n- send_whatsapp_message(recipient=\"Dave\", message=\"hi Alice joined\")\\n- send_whatsapp_message(recipient=\"Dave\", message=\"hi Alice joined\")\\n- send_whatsapp_message(recipient=\"Dave\", message=\"hi Alice joined\")",
    },
    FewShotExample {
        categories: &["discord"],
        text: "User Request: ban <@789> for raiding, delete 30 messages in channel 888888, then set behaviour log channel to 888888, then get behaviour logs for <@789> to verify\\nPlan:\\n- discord_ban(user_id=\"789\", reason=\"raiding\", delete_message_seconds=0)\\n- discord_delete_messages(channel_id=\"888888\", count=30)\\n- set_discord_behaviour_channel(channel_id=\"888888\")\\n- get_user_behaviour(user_id=\"789\")",
    },
    FewShotExample {
        categories: &["whatsapp", "email"],
        text: "User Request: send a whatsapp message to Alice asking if she can check the report, then email her at alice@gmail.com with subject Report Review and body please check the report, then do that email again, then tell her on whatsapp that it is sent\\nPlan:\\n- send_whatsapp_message(recipient=\"Alice\", message=\"Hey Alice, can you check the report?\")\\n- send_email(to=\"alice@gmail.com\", subject=\"Report Review\", body=\"please check the report\")\\n- send_email(to=\"alice@gmail.com\", subject=\"Report Review\", body=\"please check the report\")\\n- send_whatsapp_message(recipient=\"Alice\", message=\"it is sent\")",
    },
    FewShotExample {
        categories: &["whatsapp", "discord"],
        text: "User Request: turn global whatsapp auto reply off, then unban <@111> on discord\\nPlan:\\n- toggle_whatsapp(enabled=false)\\n- discord_unban(user_id=\"111\")",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: message Charlie on WhatsApp asking how he is, and toggle auto reply for him\\nPlan:\\n- send_whatsapp_message(recipient=\"Charlie\", message=\"Hey Charlie, how are you?\")\\n- toggle_whatsapp_auto_reply(recipient=\"Charlie\")",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: message Alice\\nPlan:\\n- conversational()",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: send the same message to Parth\\nPlan:\\n- conversational()",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "[Owner context: Recent WhatsApp details: ### LAST WHATSAPP\\nRecipient(s): Rahul\\nMessage: this is a test]\\n\\nUser Request: send the same message to Parth\\nPlan:\\n- send_whatsapp_message(recipient=\"Parth\", message=\"this is a test\")",
    },
    FewShotExample {
        categories: &["banter"],
        text: "User Request: tell me a joke\\nPlan:\\n- conversational()",
    },
    FewShotExample {
        categories: &["banter"],
        text: "User Request: give me a flirty pickup line\\nPlan:\\n- conversational()",
    },
    FewShotExample {
        categories: &["files"],
        text: "[Context: User is currently viewing project 'Pern']\nUser Request: whats in this project?\nPlan:\n- list_dir(path=\".\")\n- read_file(path=\"README.md\")\n- read_file(path=\"package.json\")\n- list_dir(path=\"src\")",
    },
    FewShotExample {
        categories: &["files"],
        text: "[Context: User is currently viewing project 'Pern']\nUser Request: read src/main.rs\nPlan:\n- read_file(path=\"src/main.rs\")",
    },
    FewShotExample {
        categories: &["web"],
        text: "User Request: search the web for latest trending foods\\nPlan:\\n- web_search(query=\"latest trending foods\")",
    }
];

pub const RULES: &[RuleDefinition] = &[
    RuleDefinition {
        text: "You are Pern's AI Agent. Your job is to translate user requests directly into a list of tool actions starting with \"- \".",
        categories: &[],
    },
    RuleDefinition {
        text: "If the request is conversational (e.g. greetings, questions with no tool mapping), output exactly: Plan:\\n- conversational()",
        categories: &[],
    },
    RuleDefinition {
        text: "1. If input contains action keywords (message, send, email, discord, whatsapp, app, auto reply, agents, open, close, shutdown, restart, search, web, lookup), it is NOT conversational.",
        categories: &[],
    },
    RuleDefinition {
        text: "2. Resolve pronouns (it, them) to their original referents. Always output actions in the exact chronological order requested.",
        categories: &[],
    },
    RuleDefinition {
        text: "3. Do not output guild_id; it's auto-injected.",
        categories: &["discord"],
    },
    RuleDefinition {
        text: "4. MESSAGE FORMATTING:",
        categories: &["whatsapp", "discord", "email"],
    },
    RuleDefinition {
        text: "   a. \"saying [text]\" or \"say [text]\" -> use that exact text as message. This overrides any prefix rule.",
        categories: &["whatsapp", "discord"],
    },
    RuleDefinition {
        text: "   b. Convert indirect requests (\"ask if he is available\") to direct speech: \"Hey [name], are you available?\"",
        categories: &["whatsapp", "discord"],
    },
    RuleDefinition {
        text: "   c. \"message Bob to open discord\" = send_whatsapp_message(\"Bob\", \"open discord\"), NOT launch_app. Do not execute actions inside a message.",
        categories: &["whatsapp"],
    },
    RuleDefinition {
        text: "   d. \"dm <@123> asking...\" -> discord_send_dm(user_id, \"Hey, can you...\"). Prefix DMs for mentions with \"Hey, \".",
        categories: &["discord"],
    },
    RuleDefinition {
        text: "   e. For named contacts, ALWAYS prefix messages with \"Hey [name], \" unless rule 4a applies. For <@mentions>, use \"Hey, \" instead.",
        categories: &["whatsapp", "discord"],
    },
    RuleDefinition {
        text: "   g. Preserve the exact spelling and casing of all names as written in the request.",
        categories: &["whatsapp", "discord"],
    },
    RuleDefinition {
        text: "   f. For email, only use send_email when the user explicitly says email/mail or provides an email address. If they name a person without an email address, prefer WhatsApp instead of guessing email.",
        categories: &["email"],
    },
    RuleDefinition {
        text: "5. AUTO-REPLY: \"turn auto reply on/off\" = set_whatsapp_auto_reply(recipient, enabled). Only use toggle_whatsapp_auto_reply when \"toggle\" is explicitly used.",
        categories: &["whatsapp"],
    },
    RuleDefinition {
        text: "6. BAN VS DELETE: discord_ban's delete_message_seconds is ONLY for deleting the banned user's history. Channel message purging MUST use discord_delete_messages.",
        categories: &["discord"],
    },
    RuleDefinition {
        text: "7. NO CODE: NEVER output code blocks, if/else, loops, variables, or comments. Output ONLY a flat list of tool calls starting with \"- \".",
        categories: &[],
    },
    RuleDefinition {
        text: "8. NO HALLUCINATED TOOLS: Only use the allowed tools listed below.",
        categories: &[],
    },
    RuleDefinition {
        text: "9. REASON PROPAGATION: If a reason is given for the first action in a chain (e.g. \"warn for spamming, then mute\"), propagate it to subsequent relevant actions.",
        categories: &["discord"],
    },
    RuleDefinition {
        text: "10. DISCORD VS WHATSAPP: Channel/role/ban/mute/unban/<@mentions> map to Discord tools. Do NOT use send_whatsapp_message for Discord.",
        categories: &["whatsapp", "discord"],
    },
    RuleDefinition {
        text: "11. For 3+ actions, output a \"Todo:\" section before \"Plan:\". For simple requests, omit Todo.",
        categories: &[],
    },
    RuleDefinition {
        text: "12. STRICT ACTION MATCHING: Only generate tools that correspond directly to actions explicitly requested by the user. DO NOT launch/open any app unless the user explicitly requests to open, launch, start, run, or show it. DO NOT close/exit any app unless the user explicitly requests to close, quit, exit, or terminate it. NEVER close an app immediately after launching it unless specifically instructed.",
        categories: &[],
    },
    RuleDefinition {
        text: "13. BANTER & FUN: When responding to a conversational request for a joke, pickup line, or friendly/flirtatious banter, be highly cooperative, warm, and humorous. Provide a fun and lighthearted response instead of declining or being overly formal.",
        categories: &["banter"],
    },
    RuleDefinition {
        text: "14. AMBIGUOUS OR MISSING CONTEXT: If a request is ambiguous or missing required parameters (e.g., \"message Bob\" without a message body, or \"send the same message\" when there is no previous message in context, or \"open both\" when no apps have been launched), DO NOT guess, assume, or hallucinate parameters from the few-shot examples. Instead, map it to: Plan:\\n- conversational() so that the assistant can ask the user for clarification.",
        categories: &[],
    },
    RuleDefinition {
        text: "15. STRICT NO HALLUCINATION: Do NOT generate unrequested actions. End the plan immediately after the user's requested actions. NEVER make up tools like ask_what_is_rajans_status().",
        categories: &[],
    },
    RuleDefinition {
        text: "16. SEQUENTIAL AGENTIC LOOP: When given multiple tasks, DO NOT output a massive plan with everything. Output a <plan> with only the FIRST immediate step. Once that tool is executed, the agent loop will automatically invoke you again to continue the plan. One task per response.",
        categories: &[],
    }
];

pub const DISCORD_TOOLS_WITH_GUILD_ID: &[&str] = &[
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
];
