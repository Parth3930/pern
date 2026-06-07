/// Shared tool definitions and utilities used across all platforms (Discord, WhatsApp, Frontend).
use crate::tools_data;

#[derive(serde::Deserialize, serde::Serialize, Debug)]
pub struct ToolCall {
    pub tool: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

/// Clean a potentially hallucinated tool name into its canonical form.
pub fn clean_tool_name(tool: &str) -> String {
    let t = tool.trim().to_lowercase();

    // Check generated alias map
    for &(alias, canonical) in tools_data::ALIAS_MAP {
        if t == alias {
            return canonical.to_string();
        }
    }

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
        for &suffix in tools_data::DISCORD_TOOLS_WITH_GUILD_ID {
            let short_suffix = suffix.strip_prefix("discord_").unwrap_or(suffix);
            if t == short_suffix || t == suffix {
                return suffix.to_string();
            }
        }
        tool.to_string()
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
    for t in tools_data::TOOLS {
        if t.name == tool {
            return t.params;
        }
    }
    &[]
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
        if tools_data::DISCORD_TOOLS_WITH_GUILD_ID.contains(&tool.as_str()) && !guild_id.is_empty() {
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

pub fn build_action_system_prompt(memory_context: &str, categories: &[String]) -> String {
    let signatures = if categories.is_empty() {
        tools_data::TOOLS
            .iter()
            .map(|t| t.signature)
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        tools_data::TOOLS
            .iter()
            .filter(|t| categories.contains(&t.category.to_string()))
            .map(|t| t.signature)
            .collect::<Vec<_>>()
            .join("\n")
    };

    let has = |c: &str| categories.contains(&c.to_string());

    let mut rules: Vec<String> = Vec::new();
    
    // Header rules (first two rules)
    for rule in tools_data::RULES.iter().take(2) {
        rules.push(rule.text.to_string());
    }
    
    rules.push(String::new());
    rules.push("IMPORTANT RULES:".to_string());

    // Remaining rules
    for rule in tools_data::RULES.iter().skip(2) {
        let is_applicable = rule.categories.is_empty() || rule.categories.iter().any(|cat| categories.contains(&cat.to_string()));
        if is_applicable {
            rules.push(rule.text.to_string());
        }
    }

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

pub fn all_tool_names() -> Vec<&'static str> {
    tools_data::TOOLS.iter().map(|t| t.name).collect()
}

pub fn discord_tools_with_guild_id() -> Vec<&'static str> {
    tools_data::DISCORD_TOOLS_WITH_GUILD_ID.to_vec()
}

const MAX_FEW_SHOTS: usize = 4;

pub fn get_action_few_shots_filtered(categories: &[String]) -> String {
    let examples: Vec<&tools_data::FewShotExample> = if categories.is_empty() {
        tools_data::FEW_SHOTS.iter().collect()
    } else {
        tools_data::FEW_SHOTS
            .iter()
            .filter(|e| e.categories.is_empty() || e.categories.iter().any(|cat| categories.contains(&cat.to_string())))
            .collect()
    };
    examples
        .into_iter()
        .take(MAX_FEW_SHOTS)
        .map(|e| e.text)
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub fn get_action_few_shots() -> String {
    get_action_few_shots_filtered(&[])
}
