/// Shared tool definitions and utilities used across all platforms (Discord, WhatsApp, Frontend).

#[derive(serde::Deserialize, serde::Serialize, Debug)]
pub struct ToolCall {
    pub tool: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

/// Clean a potentially hallucinated tool name into its canonical form.
pub fn clean_tool_name(tool: &str) -> String {
    let t = tool.trim().to_lowercase();

    // Known prefix hallucinations or exact mappings
    match t.as_str() {
        "restart" => "restart_system".to_string(),
        "reboot" => "restart_system".to_string(),
        "shutdown" => "shutdown_system".to_string(),
        "poweroff" => "shutdown_system".to_string(),
        "discord_set_discord_behaviour_channel" => "set_discord_behaviour_channel".to_string(),
        "discord_get_cli_agents_status" => "get_cli_agents_status".to_string(),
        "discord_get_status" => "get_status".to_string(),
        "discord_launch_app" => "launch_app".to_string(),
        "discord_close_app" => "close_app".to_string(),
        "open_app" => "launch_app".to_string(),
        "open_application" => "launch_app".to_string(),
        "run_app" => "launch_app".to_string(),
        "start_app" => "launch_app".to_string(),
        "close_application" => "close_app".to_string(),
        "stop_app" => "close_app".to_string(),
        "exit_app" => "close_app".to_string(),
        "kill_app" => "close_app".to_string(),
        "discord_send_email" => "send_email".to_string(),
        "discord_send_whatsapp_message" => "send_whatsapp_message".to_string(),
        "discord_set_whatsapp_auto_reply" => "set_whatsapp_auto_reply".to_string(),
        "discord_toggle_whatsapp_auto_reply" => "toggle_whatsapp_auto_reply".to_string(),
        "send_whatsapp_auto_reply" => "toggle_whatsapp_auto_reply".to_string(),
        "discord_send_to_cli_agent" => "send_to_cli_agent".to_string(),
        "discord_get_user_behaviour" => "get_user_behaviour".to_string(),
        "discord_set_status" => "set_discord_status".to_string(),
        "discord_set_discord_status" => "set_discord_status".to_string(),

        // Omitted prefixes (short forms used by models)
        "kick" => "discord_kick".to_string(),
        "ban" => "discord_ban".to_string(),
        "unban" => "discord_unban".to_string(),
        "mute" => "discord_mute".to_string(),
        "unmute" => "discord_unmute".to_string(),
        "warn" => "discord_warn".to_string(),
        "assign_role" => "discord_assign_role".to_string(),
        "remove_role" => "discord_remove_role".to_string(),
        "delete_messages" => "discord_delete_messages".to_string(),
        "send_dm" => "discord_send_dm".to_string(),
        "get_channels" => "discord_get_channels".to_string(),
        "send_channel_message" => "discord_send_channel_message".to_string(),
        "get_guilds" => "discord_get_guilds".to_string(),
        _ => {
            // Fuzzy matches
            if t.contains("behaviour_channel") {
                "set_discord_behaviour_channel".to_string()
            } else if t.contains("user_behaviour") {
                "get_user_behaviour".to_string()
            } else if t.contains("cli_agents_status") {
                "get_cli_agents_status".to_string()
            } else if t.contains("cli_agent") && t.starts_with("send_") {
                "send_to_cli_agent".to_string()
            } else if t == "whatsapp_message" || t == "send_whatsapp" {
                "send_whatsapp_message".to_string()
            } else if t.starts_with("send_message_to_") {
                // Handle model hallucinating recipient name into tool name, e.g. "send_message_to_rover"
                "send_whatsapp_message".to_string()
            } else if t == "email" || t == "send_mail" {
                "send_email".to_string()
            } else if t == "whatsapp_auto_reply" || t == "whatsapp_auto" {
                "set_whatsapp_auto_reply".to_string()
            } else {
                // If it's a known discord tool without the prefix
                let discord_suffixes = [
                    "kick", "ban", "unban", "mute", "unmute", "warn",
                    "delete_messages", "assign_role", "remove_role",
                    "send_dm", "get_channels", "send_channel_message", "get_guilds"
                ];
                for suffix in &discord_suffixes {
                    if t == *suffix || t == format!("discord_{}", suffix) {
                        return format!("discord_{}", suffix);
                    }
                }
                tool.to_string()
            }
        }
    }
}

fn parse_value_str(val_str: &str) -> serde_json::Value {
    let trimmed = val_str.trim();
    let lower = trimmed.to_lowercase();
    if lower == "true" {
        serde_json::Value::Bool(true)
    } else if lower == "false" {
        serde_json::Value::Bool(false)
    } else if lower == "null" || lower == "none" || trimmed.is_empty() {
        serde_json::Value::Null
    } else if let Ok(num) = trimmed.parse::<i64>() {
        serde_json::Value::Number(num.into())
    } else if let Ok(num) = trimmed.parse::<f64>() {
        if let Some(n) = serde_json::Number::from_f64(num) {
            serde_json::Value::Number(n)
        } else {
            serde_json::Value::String(trimmed.to_string())
        }
    } else {
        serde_json::Value::String(trimmed.to_string())
    }
}

fn clean_user_id(val: serde_json::Value) -> serde_json::Value {
    if let serde_json::Value::String(ref s) = val {
        let cleaned: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        if !cleaned.is_empty() {
            return serde_json::Value::String(cleaned);
        }
    }
    val
}

fn has_unquoted_equals(s: &str) -> bool {
    let mut in_quotes = false;
    let mut quote_char = ' ';
    let mut escaped = false;
    for c in s.chars() {
        if escaped {
            escaped = false;
        } else if c == '\\' && in_quotes {
            escaped = true;
        } else if (c == '"' || c == '\'') && (!in_quotes || c == quote_char) {
            in_quotes = !in_quotes;
            quote_char = if in_quotes { c } else { ' ' };
        } else if !in_quotes && c == '=' {
            return true;
        }
    }
    false
}

pub fn get_tool_params(tool: &str) -> &'static [&'static str] {
    match tool {
        "launch_app" => &["app_name"],
        "close_app" => &["app_name"],
        "send_whatsapp_message" => &["recipient", "message"],
        "set_whatsapp_auto_reply" => &["recipient", "enabled"],
        "toggle_whatsapp_auto_reply" => &["recipient"],
        "toggle_whatsapp" => &["enabled"],
        "set_discord_status" => &["status", "activity"],
        "discord_get_channels" => &[],
        "discord_send_channel_message" => &["channel_name", "message"],
        "send_email" => &["to", "subject", "body"],
        "save_email_config" => &["smtp_host", "smtp_port", "sender_email", "smtp_password"],
        "add_whatsapp_contact" => &["name", "number"],
        "discord_kick" => &["user_id", "reason"],
        "discord_ban" => &["user_id", "reason", "delete_message_seconds"],
        "discord_unban" => &["user_id"],
        "discord_mute" => &["user_id", "duration_mins", "reason"],
        "discord_unmute" => &["user_id"],
        "discord_warn" => &["user_id", "reason"],
        "discord_delete_messages" => &["channel_id", "count"],
        "discord_assign_role" => &["user_id", "role_id"],
        "discord_remove_role" => &["user_id", "role_id"],
        "discord_send_dm" => &["user_id", "message"],
        "discord_get_guilds" => &[],
        "get_status" => &[],
        "set_discord_behaviour_channel" => &["channel_id"],
        "get_user_behaviour" => &["user_id"],
        "send_to_cli_agent" => &["agent_name", "prompt", "project_name"],
        "get_cli_agents_status" => &[],
        "restart_system" => &[],
        "shutdown_system" => &[],
        "add_todo" => &["text", "time", "repeat_hours"],
        _ => &[],
    }
}

/// Parse a plan-format response (lines starting with "- tool(args)") into typed tool calls.
pub fn parse_plan_to_tool_calls(plan_text: &str, guild_id: &str) -> Vec<ToolCall> {
    let mut content_to_parse = plan_text;

    // Try <plan> tags first
    if let Some(start_tag) = plan_text.find("<plan>") {
        if let Some(end_tag) = plan_text.find("</plan>") {
            if end_tag > start_tag {
                content_to_parse = &plan_text[start_tag + 6..end_tag];
            } else {
                content_to_parse = &plan_text[start_tag + 6..];
            }
        } else {
            content_to_parse = &plan_text[start_tag + 6..];
        }
    } else if let Some(plan_header) = plan_text.find("Plan:") {
        content_to_parse = &plan_text[plan_header + 5..];
    }

    let mut tool_calls = Vec::new();
    let content_to_parse = content_to_parse.trim();
    if content_to_parse.contains("conversational") && !content_to_parse.contains("(") {
        return Vec::new();
    }

    static RE_TOOL_SPLIT: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE_TOOL_SPLIT.get_or_init(|| {
        regex::Regex::new(r"\)\s*(?:,\s*|;\s*|and\s+)?-?\s*([a-zA-Z_]\w*)\(").unwrap()
    });
    let preprocessed = re.replace_all(content_to_parse, ")\n- $1(");

    for line in preprocessed.lines() {
        let mut trimmed = line.trim();
        if trimmed.starts_with('-') {
            trimmed = trimmed[1..].trim();
        }

        let mut count = 1;
        let mut cleaned_line = trimmed.to_string();
        static RE_MULTIPLIER: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let re_mult = RE_MULTIPLIER.get_or_init(|| {
            regex::Regex::new(r"\((?:[x×\*\s]*|times\s*|repeat\s*)(\d+)\s*\)\s*$").unwrap()
        });
        if let Some(captures) = re_mult.captures(trimmed) {
            if let Some(c_match) = captures.get(1) {
                if let Ok(c_val) = c_match.as_str().parse::<usize>() {
                    count = c_val;
                    cleaned_line = re_mult.replace(trimmed, "").trim().to_string();
                }
            }
        }
        let line_to_parse = cleaned_line.trim();

        let open_paren = match line_to_parse.find('(') {
            Some(idx) => idx,
            None => continue,
        };
        let close_paren = match line_to_parse.rfind(')') {
            Some(idx) => idx,
            None => continue,
        };
        if close_paren < open_paren {
            continue;
        }

        let raw_tool = &line_to_parse[..open_paren];
        let tool = clean_tool_name(raw_tool);
        if tool == "conversational" {
            continue;
        }

        let args_text = &line_to_parse[open_paren + 1..close_paren];

        // Parse key-value or positional arguments
        let mut args = serde_json::Map::new();

        if has_unquoted_equals(args_text) {
            // Parse key-value arguments: key = value
            let mut current_key = String::new();
            let mut current_val = String::new();
            let mut in_quotes = false;
            let mut quote_char = ' ';
            let mut escaped = false;
            let mut parsing_key = true;

            let chars: Vec<char> = args_text.chars().collect();
            let mut idx = 0;
            while idx < chars.len() {
                let c = chars[idx];
                if escaped {
                    current_val.push(c);
                    escaped = false;
                } else if c == '\\' && in_quotes {
                    escaped = true;
                } else if (c == '"' || c == '\'') && (!in_quotes || c == quote_char) {
                    in_quotes = !in_quotes;
                    quote_char = if in_quotes { c } else { ' ' };
                } else if !in_quotes {
                    if c == '=' {
                        parsing_key = false;
                    } else if c == ',' {
                        // Flush pair
                        let key = current_key.trim().to_string();
                        let val_str = current_val.trim().to_string();
                        if !key.is_empty() {
                            let mut parsed_val = parse_value_str(&val_str);
                            if key == "user_id" {
                                parsed_val = clean_user_id(parsed_val);
                            }
                            args.insert(key, parsed_val);
                        }
                        current_key.clear();
                        current_val.clear();
                        parsing_key = true;
                    } else {
                        if parsing_key {
                            current_key.push(c);
                        } else {
                            current_val.push(c);
                        }
                    }
                } else {
                    current_val.push(c);
                }
                idx += 1;
            }

            // Flush last pair
            let key = current_key.trim().to_string();
            let val_str = current_val.trim().to_string();
            if !key.is_empty() {
                let mut parsed_val = parse_value_str(&val_str);
                if key == "user_id" {
                    parsed_val = clean_user_id(parsed_val);
                }
                args.insert(key, parsed_val);
            }
        } else {
            // Positional fallback
            static RE_POS_VALS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
            let re_pos = RE_POS_VALS.get_or_init(|| {
                regex::Regex::new(r#""([^"\\]|\\.)*"|'([^'\\]|\\.)*'|true|false|True|False|null|None|none|[+-]?\d+(?:\.\d+)?|[a-zA-Z_]\w*"#).unwrap()
            });

            let mut pos_values = Vec::new();
            for cap in re_pos.find_iter(args_text) {
                let val_str = cap.as_str().trim();
                let val = if val_str.starts_with('"') && val_str.ends_with('"') {
                    serde_json::Value::String(val_str[1..val_str.len() - 1].replace(r#"\""#, r#"""#))
                } else if val_str.starts_with('\'') && val_str.ends_with('\'') {
                    serde_json::Value::String(val_str[1..val_str.len() - 1].replace(r#"\'"#, r#"'"#))
                } else {
                    parse_value_str(val_str)
                };
                pos_values.push(val);
            }

            let param_names = get_tool_params(&tool);
            for (i, val) in pos_values.into_iter().enumerate() {
                if i >= param_names.len() {
                    break;
                }
                let key = param_names[i].to_string();
                let mut final_val = val;
                if key == "user_id" {
                    final_val = clean_user_id(final_val);
                }
                args.insert(key, final_val);
            }
        }

        // Auto-inject guild_id for Discord tools that need it
        let discord_tools_with_guild_id = [
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

        if discord_tools_with_guild_id.contains(&tool.as_str()) && !guild_id.is_empty() {
            args.insert("guild_id".to_string(), serde_json::Value::String(guild_id.to_string()));
        }

        // Default missing optional values to avoid validation failures
        if tool == "discord_kick" && !args.contains_key("reason") {
            args.insert("reason".to_string(), serde_json::Value::Null);
        }
        if tool == "discord_ban" {
            if !args.contains_key("reason") {
                args.insert("reason".to_string(), serde_json::Value::Null);
            }
            if !args.contains_key("delete_message_seconds") {
                args.insert("delete_message_seconds".to_string(), serde_json::Value::Number(0.into()));
            }
        }
        if tool == "discord_mute" && !args.contains_key("reason") {
            args.insert("reason".to_string(), serde_json::Value::Null);
        }

        if tool == "add_todo" {
            if args.contains_key("reminder") && !args.contains_key("text") {
                if let Some(val) = args.remove("reminder") {
                    args.insert("text".to_string(), val);
                }
            }
            if args.contains_key("task") && !args.contains_key("text") {
                if let Some(val) = args.remove("task") {
                    args.insert("text".to_string(), val);
                }
            }
            if args.contains_key("todo") && !args.contains_key("text") {
                if let Some(val) = args.remove("todo") {
                    args.insert("text".to_string(), val);
                }
            }
        }

        for _ in 0..count {
            tool_calls.push(ToolCall {
                tool: tool.clone(),
                args: serde_json::Value::Object(args.clone()),
            });
        }
    }

    tool_calls
}

struct ToolDefinition {
    category: &'static str,
    signature: &'static str,
}

const TOOL_DEFINITIONS: &[ToolDefinition] = &[
    ToolDefinition { category: "system", signature: "- launch_app(app_name: string) -> Opens an app by name (\"calculator\", \"notepad\", \"chrome\", \"discord\")." },
    ToolDefinition { category: "system", signature: "- close_app(app_name: string) -> Closes an app by name." },
    ToolDefinition { category: "whatsapp", signature: "- send_whatsapp_message(recipient: string, message: string) -> Sends WhatsApp message." },
    ToolDefinition { category: "whatsapp", signature: "- set_whatsapp_auto_reply(recipient: string, enabled: boolean) -> Enables (true) or disables (false) WhatsApp auto reply for recipient." },
    ToolDefinition { category: "whatsapp", signature: "- toggle_whatsapp_auto_reply(recipient: string) -> Toggles WhatsApp auto reply for recipient." },
    ToolDefinition { category: "whatsapp", signature: "- toggle_whatsapp(enabled: boolean) -> Toggles global WhatsApp auto-reply on/off." },
    ToolDefinition { category: "discord", signature: "- set_discord_status(status: string, activity: string) -> Sets bot status and activity." },
    ToolDefinition { category: "discord", signature: "- discord_get_channels() -> Lists channels in a server." },
    ToolDefinition { category: "discord", signature: "- discord_send_channel_message(channel_name: string, message: string) -> Sends message to a server channel." },
    ToolDefinition { category: "email", signature: "- send_email(to: string, subject: string, body: string) -> Sends email." },
    ToolDefinition { category: "email", signature: "- save_email_config(smtp_host: string, smtp_port: number, sender_email: string, smtp_password: string) -> Saves SMTP config." },
    ToolDefinition { category: "whatsapp", signature: "- add_whatsapp_contact(name: string, number: string) -> Adds a contact to the allowed auto-reply list." },
    ToolDefinition { category: "discord", signature: "- discord_kick(user_id: string, reason: string) -> Kicks user from server." },
    ToolDefinition { category: "discord", signature: "- discord_ban(user_id: string, reason: string, delete_message_seconds: number) -> Bans user from server." },
    ToolDefinition { category: "discord", signature: "- discord_unban(user_id: string) -> Unbans user." },
    ToolDefinition { category: "discord", signature: "- discord_mute(user_id: string, duration_mins: number, reason: string) -> Mutes user." },
    ToolDefinition { category: "discord", signature: "- discord_unmute(user_id: string) -> Unmutes user." },
    ToolDefinition { category: "discord", signature: "- discord_warn(user_id: string, reason: string) -> Warns user via DM." },
    ToolDefinition { category: "discord", signature: "- discord_delete_messages(channel_id: string, count: number) -> Purges last count messages." },
    ToolDefinition { category: "discord", signature: "- discord_assign_role(user_id: string, role_id: string) -> Assigns role to user." },
    ToolDefinition { category: "discord", signature: "- discord_remove_role(user_id: string, role_id: string) -> Removes role from user." },
    ToolDefinition { category: "discord", signature: "- discord_send_dm(user_id: string, message: string) -> Sends Discord DM to user." },
    ToolDefinition { category: "discord", signature: "- discord_get_guilds() -> Lists Discord servers." },
    ToolDefinition { category: "system", signature: "- get_status() -> Gets system uptime and health." },
    ToolDefinition { category: "discord", signature: "- set_discord_behaviour_channel(channel_id: string) -> Sets behaviour log channel." },
    ToolDefinition { category: "discord", signature: "- get_user_behaviour(user_id: string) -> Gets user behaviour log." },
    ToolDefinition { category: "agents", signature: "- send_to_cli_agent(agent_name: string, prompt: string, project_name: string) -> Runs CLI agent (agy, claude-code, codex, hermes, freebuff)." },
    ToolDefinition { category: "agents", signature: "- get_cli_agents_status() -> Gets CLI agents status." },
    ToolDefinition { category: "system", signature: "- restart_system() -> Restarts the system (computer)." },
    ToolDefinition { category: "system", signature: "- shutdown_system() -> Shuts down the system (computer)." },
    ToolDefinition { category: "todos", signature: "- add_todo(text: string, time?: string, repeat_hours?: number) -> Adds a new todo task/reminder. time is optional local ISO string without 'Z' (e.g., '2026-06-05T12:00:00'). repeat_hours is optional." },
];

struct FewShotExample {
    categories: &'static [&'static str],
    text: &'static str,
}

const FEW_SHOT_EXAMPLES: &[FewShotExample] = &[
    FewShotExample {
        categories: &[],
        text: "User Request: what is the capital of France?\nPlan:\n- conversational()",
    },
    FewShotExample {
        categories: &["system"],
        text: "User Request: open whatsapp and close notepad\nPlan:\n- launch_app(app_name=\"whatsapp\")\n- close_app(app_name=\"notepad\")",
    },
    FewShotExample {
        categories: &["system"],
        text: "User Request: shut down my computer\nPlan:\n- shutdown_system()",
    },
    FewShotExample {
        categories: &["system"],
        text: "User Request: restart the system\nPlan:\n- restart_system()",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: message Dave and ask if he is free, and send same message to Frank, and open whatsapp, and turn auto reply on for both of them\nPlan:\n- send_whatsapp_message(recipient=\"Dave\", message=\"Hey Dave, are you free?\")\n- send_whatsapp_message(recipient=\"Frank\", message=\"Hey Frank, are you free?\")\n- launch_app(app_name=\"whatsapp\")\n- set_whatsapp_auto_reply(recipient=\"Dave\", enabled=true)\n- set_whatsapp_auto_reply(recipient=\"Frank\", enabled=true)",
    },
    FewShotExample {
        categories: &["discord"],
        text: "User Request: warn <@456> for toxicity, then mute them for 10 minutes, then assign role 888 to them, then log this in channel logs saying warned and muted user 456\nPlan:\n- discord_warn(user_id=\"456\", reason=\"toxicity\")\n- discord_mute(user_id=\"456\", duration_mins=10, reason=\"toxicity\")\n- discord_assign_role(user_id=\"456\", role_id=\"888\")\n- discord_send_channel_message(channel_name=\"logs\", message=\"warned and muted user 456\")",
    },
    FewShotExample {
        categories: &["discord"],
        text: "User Request: dm <@123> asking if they can review the change\nPlan:\n- discord_send_dm(user_id=\"123\", message=\"Hey, can you review the change?\")",
    },
    FewShotExample {
        categories: &["discord"],
        text: "User Request: send a message to general channel saying hello everyone\nPlan:\n- discord_send_channel_message(channel_name=\"general\", message=\"hello everyone\")",
    },
    FewShotExample {
        categories: &["email", "discord"],
        text: "User Request: save email config with host smtp.gmail.com port 587 sender me@gmail.com and password pass123, then send email to alice@gmail.com with subject Report and say hello, then dm <@456> asking if they can check it\nPlan:\n- save_email_config(smtp_host=\"smtp.gmail.com\", smtp_port=587, sender_email=\"me@gmail.com\", smtp_password=\"pass123\")\n- send_email(to=\"alice@gmail.com\", subject=\"Report\", body=\"hello\")\n- discord_send_dm(user_id=\"456\", message=\"Hey, can you check it?\")",
    },
    FewShotExample {
        categories: &["agents", "whatsapp"],
        text: "User Request: run agy on project Pern to build it, then run freebuff to run tests, and if both are done message Bob saying all good, and toggle auto reply for him\nPlan:\n- send_to_cli_agent(agent_name=\"agy\", prompt=\"build it\", project_name=\"Pern\")\n- send_to_cli_agent(agent_name=\"freebuff\", prompt=\"run tests\", project_name=\"Pern\")\n- send_whatsapp_message(recipient=\"Bob\", message=\"all good\")\n- toggle_whatsapp_auto_reply(recipient=\"Bob\")",
    },
    FewShotExample {
        categories: &["system", "discord"],
        text: "User Request: open chrome and calculator, do some math, then close both chrome and calculator, get status of cli agents, and set my discord status to idle with activity away\nPlan:\n- launch_app(app_name=\"chrome\")\n- launch_app(app_name=\"calculator\")\n- close_app(app_name=\"chrome\")\n- close_app(app_name=\"calculator\")\n- get_cli_agents_status()\n- set_discord_status(status=\"idle\", activity=\"away\")",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: add contact Alice with number +9876543, then message Alice saying hello, then do that message again, then message Dave on WhatsApp saying hi Alice joined, then do the Dave message twice more\nPlan:\n- add_whatsapp_contact(name=\"Alice\", number=\"+9876543\")\n- send_whatsapp_message(recipient=\"Alice\", message=\"hello\")\n- send_whatsapp_message(recipient=\"Alice\", message=\"hello\")\n- send_whatsapp_message(recipient=\"Dave\", message=\"hi Alice joined\")\n- send_whatsapp_message(recipient=\"Dave\", message=\"hi Alice joined\")\n- send_whatsapp_message(recipient=\"Dave\", message=\"hi Alice joined\")",
    },
    FewShotExample {
        categories: &["discord"],
        text: "User Request: ban <@789> for raiding, delete 30 messages in channel 888888, then set behaviour log channel to 888888, then get behaviour logs for <@789> to verify\nPlan:\n- discord_ban(user_id=\"789\", reason=\"raiding\", delete_message_seconds=0)\n- discord_delete_messages(channel_id=\"888888\", count=30)\n- set_discord_behaviour_channel(channel_id=\"888888\")\n- get_user_behaviour(user_id=\"789\")",
    },
    FewShotExample {
        categories: &["whatsapp", "email"],
        text: "User Request: send a whatsapp message to Alice asking if she can check the report, then email her at alice@gmail.com with subject Report Review and body please check the report, then do that email again, then tell her on whatsapp that it is sent\nPlan:\n- send_whatsapp_message(recipient=\"Alice\", message=\"Hey Alice, can you check the report?\")\n- send_email(to=\"alice@gmail.com\", subject=\"Report Review\", body=\"please check the report\")\n- send_email(to=\"alice@gmail.com\", subject=\"Report Review\", body=\"please check the report\")\n- send_whatsapp_message(recipient=\"Alice\", message=\"it is sent\")",
    },
    FewShotExample {
        categories: &["whatsapp", "discord"],
        text: "User Request: turn global whatsapp auto reply off, then unban <@111> on discord\nPlan:\n- toggle_whatsapp(enabled=false)\n- discord_unban(user_id=\"111\")",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "User Request: message Charlie on WhatsApp asking how he is, and toggle auto reply for him\nPlan:\n- send_whatsapp_message(recipient=\"Charlie\", message=\"Hey Charlie, how are you?\")\n- toggle_whatsapp_auto_reply(recipient=\"Charlie\")",
    },
    FewShotExample {
        categories: &["whatsapp"],
        text: "[Owner context: Recent WhatsApp details: ### LAST WHATSAPP\nRecipient(s): Rahul\nMessage: this is a test]\n\nUser Request: send the same message to Parth\nPlan:\n- send_whatsapp_message(recipient=\"Parth\", message=\"this is a test\")",
    },
];

pub fn detect_required_tool_categories(user_message: &str) -> Vec<String> {
    let mut categories = std::collections::HashSet::new();
    let normalized = user_message.to_lowercase();

    // 1. WhatsApp Matcher
    static RE_WHATSAPP: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_whatsapp = RE_WHATSAPP.get_or_init(|| {
        regex::Regex::new(r"(?i)\b(whatsapp|message|msg|text|contact|auto[- ]?reply|auto[- ]?replies)\b").unwrap()
    });
    if re_whatsapp.is_match(&normalized) {
        categories.insert("whatsapp".to_string());
    }

    // 2. Discord Matcher
    static RE_DISCORD: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_discord = RE_DISCORD.get_or_init(|| {
        regex::Regex::new(r"(?i)\b(discord|guild|channel|server|role|kick|ban|unban|mute|unmute|warn|purge|dm|logs|behaviour|behave)\b|<@!?\d+>").unwrap()
    });
    if re_discord.is_match(&normalized) {
        categories.insert("discord".to_string());
    }

    // 3. Email Matcher
    static RE_EMAIL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_email = RE_EMAIL.get_or_init(|| {
        regex::Regex::new(r"(?i)\b(email|mail|smtp|subject|body)\b|\S+@\S+").unwrap()
    });
    if re_email.is_match(&normalized) {
        categories.insert("email".to_string());
    }

    // 4. System Matcher
    static RE_SYSTEM: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_system = RE_SYSTEM.get_or_init(|| {
        regex::Regex::new(r"(?i)\b(launch|open|close|start|quit|exit|chrome|notepad|calculator|app|system|pc|computer|uptime|health|restart|reboot|shutdown|power[- ]?off|poweroff)\b").unwrap()
    });
    if re_system.is_match(&normalized) {
        categories.insert("system".to_string());
    }

    // 5. Agents Matcher
    static RE_AGENTS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_agents = RE_AGENTS.get_or_init(|| {
        regex::Regex::new(r"(?i)\b(cli|agent|agy|claude|hermes|codex|freebuff|freebuf)\b").unwrap()
    });
    if re_agents.is_match(&normalized) {
        categories.insert("agents".to_string());
    }

    // 6. Todos Matcher
    static RE_TODOS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_todos = RE_TODOS.get_or_init(|| {
        regex::Regex::new(r"(?i)\b(todo|todos|reminder|reminders|remind)\b").unwrap()
    });
    if re_todos.is_match(&normalized) {
        categories.insert("todos".to_string());
    }

    let mut res: Vec<String> = categories.into_iter().collect();
    res.sort();
    res
}

/// Build the shared action system prompt used by Discord, WhatsApp, and all platforms.
/// The prompt tells the model how to output tool calls in plan format.
pub fn build_action_system_prompt(memory_context: &str, categories: &[String]) -> String {
    let signatures = if categories.is_empty() {
        TOOL_DEFINITIONS
            .iter()
            .map(|t| t.signature)
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        TOOL_DEFINITIONS
            .iter()
            .filter(|t| categories.contains(&t.category.to_string()))
            .map(|t| t.signature)
            .collect::<Vec<_>>()
            .join("\n")
    };

    let has = |c: &str| categories.contains(&c.to_string());
    let is_messaging = has("whatsapp") || has("discord") || has("email");

    let mut rules: Vec<String> = Vec::new();
    rules.push("You are Pern's AI Agent. Your job is to translate user requests directly into a list of tool actions starting with \"- \".".to_string());
    rules.push("If the request is conversational (e.g. greetings, questions with no tool mapping), output exactly: Plan:\\n- conversational()".to_string());
    rules.push(String::new());
    rules.push("IMPORTANT RULES:".to_string());

    rules.push("1. If input contains action keywords (message, send, email, discord, whatsapp, app, auto reply, agents, open, close, shutdown, restart), it is NOT conversational.".to_string());
    rules.push("2. Resolve pronouns (it, them) to their original referents. Always output actions in the exact chronological order requested.".to_string());

    if has("discord") {
        rules.push("3. Do not output guild_id; it's auto-injected.".to_string());
    }

    if is_messaging {
        rules.push("4. MESSAGE FORMATTING:".to_string());
        if has("whatsapp") || has("discord") {
            rules.push("   a. \"saying [text]\" or \"say [text]\" -> use that exact text as message. This overrides any prefix rule.".to_string());
            rules.push("   b. Convert indirect requests (\"ask if he is available\") to direct speech: \"Hey [name], are you available?\"".to_string());
        }
        if has("whatsapp") {
            rules.push("   c. \"message Bob to open discord\" = send_whatsapp_message(\"Bob\", \"open discord\"), NOT launch_app. Do not execute actions inside a message.".to_string());
        }
        if has("discord") {
            rules.push("   d. \"dm <@123> asking...\" -> discord_send_dm(user_id, \"Hey, can you...\"). Prefix DMs for mentions with \"Hey, \".".to_string());
        }
        if has("whatsapp") || has("discord") {
            rules.push("   e. For named contacts, ALWAYS prefix messages with \"Hey [name], \" unless rule 4a applies. For <@mentions>, use \"Hey, \" instead.".to_string());
            rules.push("   g. Preserve the exact spelling and casing of all names as written in the request.".to_string());
        }
        if has("email") {
            rules.push("   f. Preserve the exact spelling and casing of all names and recipients as written in the request.".to_string());
        }
    }

    if has("whatsapp") {
        rules.push("5. AUTO-REPLY: \"turn auto reply on/off\" = set_whatsapp_auto_reply(recipient, enabled). Only use toggle_whatsapp_auto_reply when \"toggle\" is explicitly used.".to_string());
    }

    if has("discord") {
        rules.push("6. BAN VS DELETE: discord_ban's delete_message_seconds is ONLY for deleting the banned user's history. Channel message purging MUST use discord_delete_messages.".to_string());
    }

    rules.push("7. NO CODE: NEVER output code blocks, if/else, loops, variables, or comments. Output ONLY a flat list of tool calls starting with \"- \".".to_string());
    rules.push("8. NO HALLUCINATED TOOLS: Only use the allowed tools listed below.".to_string());

    if has("discord") {
        rules.push("9. REASON PROPAGATION: If a reason is given for the first action in a chain (e.g. \"warn for spamming, then mute\"), propagate it to subsequent relevant actions.".to_string());
    }

    if has("whatsapp") && has("discord") {
        rules.push("10. DISCORD VS WHATSAPP: Channel/role/ban/mute/unban/<@mentions> map to Discord tools. Do NOT use send_whatsapp_message for Discord.".to_string());
    }

    rules.push("11. For 3+ actions, output a \"Todo:\" section before \"Plan:\". For simple requests, omit Todo.".to_string());
    rules.push("12. STRICT ACTION MATCHING: DO NOT launch/open any app unless the user explicitly requests to open, launch, start, run, or show it. DO NOT close/exit any app unless the user explicitly requests to close, quit, exit, or terminate it. NEVER close an app immediately after launching it unless specifically instructed.".to_string());

    if has("todos") {
        use chrono::Timelike;
        let local_now = chrono::Local::now();
        let format_local = |dt: chrono::DateTime<chrono::Local>| dt.format("%Y-%m-%dT%H:%M:%S").to_string();
        let local_now_str = format_local(local_now);
        let local_plus_2 = format_local(local_now + chrono::Duration::hours(2));
        let local_plus_1 = format_local(local_now + chrono::Duration::hours(1));

        let tomorrow = local_now + chrono::Duration::days(1);
        let tomorrow_9am = tomorrow
            .with_hour(9).unwrap_or(tomorrow)
            .with_minute(0).unwrap_or(tomorrow)
            .with_second(0).unwrap_or(tomorrow);
        let local_tomorrow_9am = format_local(tomorrow_9am);

        rules.push("13. TODO TIME AND REPEAT RULES:".to_string());
        rules.push("    - When resolving relative times like \"in next 2 hrs\", \"in 30 mins\", calculate the target local time by adding that duration to the current local time.".to_string());
        rules.push("    - Remove relative time expressions (e.g., \"in next 2 hrs\", \"tomorrow at 9am\", \"in 30 mins\") from the todo text, keeping only the clean task description.".to_string());
        rules.push("    - NEVER set repeat_hours for relative offsets like \"in next X hrs\" or \"in Y mins\". repeat_hours must ONLY be set when the user explicitly requests a repeating interval, such as \"every 2 hours\" or \"daily\".".to_string());
        rules.push(format!("    - Output the time in local ISO format WITHOUT timezone suffix/offset (do NOT append 'Z' or timezone offsets). For example, given the current local time is \"{}\":", local_now_str));
        rules.push(format!("      * \"add a todo for drinking water in next 2 hrs\" -> add_todo(text=\"drinking water\", time=\"{}\", repeat_hours=null)", local_plus_2));
        rules.push(format!("      * \"remind me to check emails in 1 hour\" -> add_todo(text=\"check emails\", time=\"{}\", repeat_hours=null)", local_plus_1));
        rules.push(format!("      * \"add a repeating todo to walk the dog every 24 hours starting tomorrow at 9 AM\" -> add_todo(text=\"walk the dog\", time=\"{}\", repeat_hours=24)", local_tomorrow_9am));
    }

    let rules_str = rules.join("\n");
    let now = chrono::Local::now();
    let time_context = format!("Current time is {} (ISO: {}). ", now.format("%Y-%m-%d %H:%M:%S"), now.to_rfc3339());
    let full_memory = format!("{}{}", time_context, memory_context);

    format!("{}
{}

Owner context: {}", rules_str, signatures, full_memory)
}

/// Get the list of all canonical tool names.
pub fn all_tool_names() -> Vec<&'static str> {
    vec![
        "launch_app",
        "close_app",
        "send_whatsapp_message",
        "set_whatsapp_auto_reply",
        "toggle_whatsapp_auto_reply",
        "set_discord_status",
        "discord_get_channels",
        "discord_send_channel_message",
        "send_email",
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
        "add_todo",
    ]
}

/// Discord tools that automatically get guild_id injected.
pub fn discord_tools_with_guild_id() -> Vec<&'static str> {
    vec![
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
    ]
}

const MAX_FEW_SHOTS: usize = 4;

pub fn get_action_few_shots_filtered(categories: &[String]) -> String {
    let examples: Vec<&FewShotExample> = if categories.is_empty() {
        FEW_SHOT_EXAMPLES.iter().collect()
    } else {
        FEW_SHOT_EXAMPLES
            .iter()
            .filter(|e| e.categories.is_empty() || e.categories.iter().any(|cat| categories.contains(&cat.to_string())))
            .collect()
    };
    // Limit few-shots to avoid exceeding small model context windows (e.g. 4096 tokens)
    examples
        .into_iter()
        .take(MAX_FEW_SHOTS)
        .map(|e| e.text)
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Get the unified action few-shot examples as a string.
pub fn get_action_few_shots() -> String {
    get_action_few_shots_filtered(&[])
}

