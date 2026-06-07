
use crate::state::AppState;
use crate::storage::save_config;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message as WsMessage;

pub struct DiscordManager {
    pub status: Arc<Mutex<String>>, // "idle", "connecting", "connected"
    pub bot_name: Arc<Mutex<Option<String>>>,
    pub bot_id: Arc<Mutex<Option<String>>>,
    pub guilds: Arc<Mutex<Vec<(String, String)>>>, // Vec<(guild_id, guild_name)>
    pub runtime_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    pub session_op_lock: Arc<Mutex<()>>,
}

impl DiscordManager {
    pub fn new() -> Self {
        Self {
            status: Arc::new(Mutex::new("idle".to_string())),
            bot_name: Arc::new(Mutex::new(None)),
            bot_id: Arc::new(Mutex::new(None)),
            guilds: Arc::new(Mutex::new(Vec::new())),
            runtime_task: Arc::new(Mutex::new(None)),
            session_op_lock: Arc::new(Mutex::new(())),
        }
    }
}

use crate::tools::ToolCall;

async fn discord_api_call(
    method: reqwest::Method,
    endpoint: &str,
    body: Option<serde_json::Value>,
    token: &str,
    audit_reason: Option<&str>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("https://discord.com/api/v10{}", endpoint);
    let mut req = client
        .request(method, &url)
        .header("Authorization", format!("Bot {}", token))
        .header(
            "User-Agent",
            "DiscordBot (https://github.com/tauri-apps/tauri, 0.1)",
        );

    if let Some(reason) = audit_reason {
        req = req.header("X-Audit-Log-Reason", reason);
    }

    if let Some(body_val) = body {
        req = req.json(&body_val);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    let status = res.status();

    if status.is_success() {
        if status == reqwest::StatusCode::NO_CONTENT {
            Ok(serde_json::Value::Null)
        } else {
            let json_val = res
                .json::<serde_json::Value>()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            Ok(json_val)
        }
    } else {
        let err_body = res.text().await.unwrap_or_default();
        Err(format!(
            "Discord API returned status {}: {}",
            status, err_body
        ))
    }
}

async fn get_discord_token(state: &AppState) -> Result<String, String> {
    let config = state.config.lock().await;
    if !config.discord_enabled {
        return Err("Discord integration is disabled.".to_string());
    }
    if config.discord_token.is_empty() {
        return Err("Discord bot token is not configured.".to_string());
    }
    Ok(config.discord_token.clone())
}

pub async fn stop_discord_runtime(state: &AppState) {
    let mut task_guard = state.discord_manager.runtime_task.lock().await;
    if let Some(task) = task_guard.take() {
        task.abort();
    }
}

pub async fn internal_start_discord_session(
    app_handle: AppHandle,
    state: Arc<AppState>,
) -> Result<(), String> {
    let _op_guard = state.discord_manager.session_op_lock.lock().await;

    let (enabled, token, status, activity) = {
        let config = state.config.lock().await;
        (
            config.discord_enabled,
            config.discord_token.clone(),
            config.discord_status.clone(),
            config.discord_activity.clone(),
        )
    };

    if !enabled || token.is_empty() {
        return Ok(());
    }

    stop_discord_runtime(&state).await;

    *state.discord_manager.status.lock().await = "connecting".to_string();
    let _ = app_handle.emit("discord-status", "connecting");

    let state_clone = state.clone();
    let state_clone_inner = state.clone();
    let app_handle_clone = app_handle.clone();
    let app_handle_clone_inner = app_handle.clone();

    let runtime_handle = tauri::async_runtime::spawn(async move {
        let _ = app_handle_clone_inner.emit("app-log", serde_json::json!({
            "level": "debug",
            "message": "[DISCORD] Starting gateway session..."
        }));

        if let Err(e) = run_gateway_loop(
            app_handle_clone_inner,
            state_clone_inner,
            token,
            status,
            activity,
        )
        .await
        {
            println!("[DISCORD] Gateway error: {}", e);
        }

        let manager = &state_clone.discord_manager;
        *manager.status.lock().await = "idle".to_string();
        *manager.bot_name.lock().await = None;
        *manager.bot_id.lock().await = None;
        manager.guilds.lock().await.clear();
        let _ = app_handle_clone.emit("discord-status", "idle");
        *manager.runtime_task.lock().await = None;
    });

    *state.discord_manager.runtime_task.lock().await = Some(runtime_handle);
    Ok(())
}

async fn run_gateway_loop(
    app_handle: AppHandle,
    state: Arc<AppState>,
    token: String,
    presence_status: String,
    activity_text: String,
) -> Result<(), String> {
    let url = "wss://gateway.discord.gg/?v=10&encoding=json";
    let (ws_stream, _) = connect_async(url)
        .await
        .map_err(|e| format!("Failed to connect to Discord gateway: {}", e))?;
    let _ = app_handle.emit("app-log", serde_json::json!({
        "level": "debug",
        "message": "[DISCORD] Connected to Gateway WebSocket."
    }));

    let (mut write, mut read) = ws_stream.split();

    let heartbeat_interval = match read.next().await {
        Some(Ok(WsMessage::Text(text))) => {
            let val: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {}", e))?;
            if val.get("op").and_then(|op| op.as_u64()) == Some(10) {
                val.get("d")
                    .and_then(|d| d.get("heartbeat_interval"))
                    .and_then(|i| i.as_u64())
                    .ok_or_else(|| "Missing heartbeat_interval".to_string())?
            } else {
                return Err("First payload was not Hello".to_string());
            }
        }
        _ => return Err("Connection closed before Hello".to_string()),
    };

    let _ = app_handle.emit("app-log", serde_json::json!({
        "level": "debug",
        "message": format!("[DISCORD] Hello received. Heartbeat interval: {}ms", heartbeat_interval)
    }));

    let mut heartbeat_interval_timer = tokio::time::interval(std::time::Duration::from_millis(heartbeat_interval));
    heartbeat_interval_timer.tick().await; // First tick immediate

    let presence_json = if activity_text.is_empty() {
        serde_json::json!({
            "status": presence_status,
            "since": null,
            "activities": [],
            "afk": false
        })
    } else {
        serde_json::json!({
            "status": presence_status,
            "since": null,
            "activities": [{
                "name": activity_text,
                "type": 0
            }],
            "afk": false
        })
    };

    let identify = serde_json::json!({
        "op": 2,
        "d": {
            "token": token,
            "intents": 33281, // GUILDS (1) | GUILD_MESSAGES (512) | MESSAGE_CONTENT (32768)
            "properties": {
                "os": "windows",
                "browser": "tauri",
                "device": "tauri"
            },
            "presence": presence_json
        }
    });

    let identify_msg = WsMessage::Text(serde_json::to_string(&identify).unwrap());
    write
        .send(identify_msg)
        .await
        .map_err(|e| format!("Failed to send Identify: {}", e))?;
    let _ = app_handle.emit("app-log", serde_json::json!({
        "level": "debug",
        "message": "[DISCORD] Identify sent."
    }));

    let last_sequence = Arc::new(tokio::sync::Mutex::new(None::<u64>));
    let last_seq_clone = last_sequence.clone();

    loop {
        tokio::select! {
            _ = heartbeat_interval_timer.tick() => {
                let seq = *last_seq_clone.lock().await;
                let hb = serde_json::json!({
                    "op": 1,
                    "d": seq
                });
                let hb_msg = WsMessage::Text(serde_json::to_string(&hb).unwrap());
                if let Err(e) = write.send(hb_msg).await {
                    println!("[DISCORD] Failed to send heartbeat: {}", e);
                    break;
                }
            }

            msg = read.next() => {
                match msg {
                    Some(Ok(WsMessage::Text(text))) => {
                        let val: serde_json::Value = match serde_json::from_str(&text) {
                            Ok(v) => v,
                            Err(e) => {
                                println!("[DISCORD] JSON parse error: {}", e);
                                continue;
                            }
                        };

                        if let Some(s) = val.get("s").and_then(|s| s.as_u64()) {
                            *last_sequence.lock().await = Some(s);
                        }

                        let op = val.get("op").and_then(|op| op.as_u64());
                        if op == Some(0) {
                            if let Some(t) = val.get("t").and_then(|t| t.as_str()) {
                                let d = val.get("d").cloned().unwrap_or(serde_json::Value::Null);
                                if let Err(e) = handle_event(&app_handle, &state, t, d).await {
                                    println!("[DISCORD] Event handling error ({}): {}", t, e);
                                }
                            }
                        } else if op == Some(1) {
                            let seq = *last_sequence.lock().await;
                            let hb = serde_json::json!({
                                "op": 1,
                                "d": seq
                            });
                            let _ = write.send(WsMessage::Text(serde_json::to_string(&hb).unwrap())).await;
                        } else if op == Some(7) || op == Some(9) {
                            println!("[DISCORD] Gateway requested reconnect or invalid session.");
                            break;
                        }
                    }
                    Some(Ok(WsMessage::Close(_))) | None => {
                        println!("[DISCORD] Gateway closed connection.");
                        break;
                    }
                    Some(Err(e)) => {
                        println!("[DISCORD] WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(())
}

fn handle_event<'a>(
    app_handle: &'a tauri::AppHandle,
    state: &'a AppState,
    event_type: &'a str,
    data: serde_json::Value,
) -> futures_util::future::BoxFuture<'a, Result<(), String>> {
    Box::pin(async move {
        let manager = &state.discord_manager;

        match event_type {
            "READY" => {
                let _ = app_handle.emit("app-log", serde_json::json!({
                    "level": "debug",
                    "message": "[DISCORD] READY event received."
                }));
                let mut name_out = String::new();
                if let Some(user) = data.get("user") {
                    if let Some(username) = user.get("username").and_then(|u| u.as_str()) {
                        let discriminator = user
                            .get("discriminator")
                            .and_then(|d| d.as_str())
                            .unwrap_or("0000");
                        let name = if discriminator == "0" || discriminator.is_empty() {
                            username.to_string()
                        } else {
                            format!("{}#{}", username, discriminator)
                        };
                        *manager.bot_name.lock().await = Some(name.clone());
                        name_out = name;
                        let _ = app_handle.emit("app-log", serde_json::json!({
                            "level": "info",
                            "message": format!("[DISCORD] Logged in as: {}", name_out)
                        }));
                    }
                    if let Some(id) = user.get("id").and_then(|id| id.as_str()) {
                        *manager.bot_id.lock().await = Some(id.to_string());
                    }
                }
                *manager.status.lock().await = "connected".to_string();
                let _ = app_handle.emit("discord-status", "connected");
                let _ = app_handle.emit("discord-bot-name", name_out);
                manager.guilds.lock().await.clear();
            }

            "GUILD_CREATE" => {
                if let Some(id) = data.get("id").and_then(|id| id.as_str()) {
                    if let Some(name) = data.get("name").and_then(|n| n.as_str()) {
                        let mut guilds = manager.guilds.lock().await;
                        guilds.retain(|(g_id, _)| g_id != id);
                        guilds.push((id.to_string(), name.to_string()));
                        let _ = app_handle.emit("app-log", serde_json::json!({
                            "level": "debug",
                            "message": format!("[DISCORD] Registered guild: {} ({})", name, id)
                        }));
                    }
                }
            }

            "MESSAGE_CREATE" => {
                let author = data
                    .get("author")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let author_id = author
                    .get("id")
                    .and_then(|id| id.as_str())
                    .unwrap_or_default();
                let author_username = author
                    .get("username")
                    .and_then(|u| u.as_str())
                    .unwrap_or_default();
                let is_bot = author.get("bot").and_then(|b| b.as_bool()).unwrap_or(false);

                let bot_id_opt = manager.bot_id.lock().await.clone();
                if let Some(bot_id) = bot_id_opt {
                    if author_id != bot_id && !is_bot {
                        let content = data
                            .get("content")
                            .and_then(|c| c.as_str())
                            .unwrap_or_default();
                        let channel_id = data
                            .get("channel_id")
                            .and_then(|c| c.as_str())
                            .unwrap_or_default();
                        let message_id = data
                            .get("id")
                            .and_then(|id| id.as_str())
                            .unwrap_or_default();

                        // Check if this is a reply to one of Pern's messages
                        let (is_reply_to_bot, replied_content, replied_author) = {
                            let ref_msg = data.get("referenced_message");
                            if let Some(ref_msg) = ref_msg {
                                if !ref_msg.is_null() {
                                    let ref_author_id = ref_msg
                                        .get("author")
                                        .and_then(|a| a.get("id"))
                                        .and_then(|i| i.as_str())
                                        .unwrap_or_default();
                                    if ref_author_id == bot_id {
                                        let rc = ref_msg
                                            .get("content")
                                            .and_then(|c| c.as_str())
                                            .unwrap_or_default()
                                            .to_string();
                                        let ra = ref_msg
                                            .get("author")
                                            .and_then(|a| a.get("username"))
                                            .and_then(|u| u.as_str())
                                            .unwrap_or("Pern")
                                            .to_string();
                                        (true, rc, ra)
                                    } else {
                                        (false, String::new(), String::new())
                                    }
                                } else {
                                    (false, String::new(), String::new())
                                }
                            } else {
                                (false, String::new(), String::new())
                            }
                        };

                        let mention_pattern = format!("<@{}", bot_id);
                        let content_lower = content.to_lowercase();
                        let is_mentioned = content.contains(&mention_pattern);
                        let is_pern = content_lower.contains("pern");
                        let is_maple = content_lower.contains("maple");

                        if is_mentioned || is_pern || is_maple || is_reply_to_bot {
                            let state_clone = Arc::new(state.clone());
                            let token = {
                                let config = state.config.lock().await;
                                config.discord_token.clone()
                            };
                            let owner_id = {
                                let config = state.config.lock().await;
                                config.discord_owner_id.clone()
                            };
                            let channel_id = channel_id.to_string();
                            let message_id = message_id.to_string();
                            let guild_id = data
                                .get("guild_id")
                                .and_then(|g| g.as_str())
                                .unwrap_or_default()
                                .to_string();

                            let mut user_msg = content
                                .replace(&format!("<@{}", bot_id), "")
                                .replace(&format!("<@!{}", bot_id), "");

                            // Clean prefix triggers ("pern", "maple", "hey pern", "hey maple") case-insensitively
                            let tr = user_msg.trim().to_lowercase();
                            if tr.starts_with("pern") {
                                user_msg = user_msg.trim()[4..].trim().to_string();
                            } else if tr.starts_with("maple") {
                                user_msg = user_msg.trim()[5..].trim().to_string();
                            } else if tr.starts_with("hey pern") {
                                user_msg = user_msg.trim()[8..].trim().to_string();
                            } else if tr.starts_with("hey maple") {
                                user_msg = user_msg.trim()[9..].trim().to_string();
                            }

                            let mut cleaned = user_msg.trim();
                            if cleaned.starts_with(':') || cleaned.starts_with(',') {
                                cleaned = cleaned[1..].trim();
                            }
                            let mut user_msg = cleaned.to_string();

                            // If this is a reply to one of Pern's messages, prepend the context
                            if is_reply_to_bot && !replied_content.is_empty() {
                                let context = format!(
                                    "[Replying to {}'s message: \"{}\"] {}",
                                    replied_author, replied_content, user_msg
                                );
                                user_msg = context;
                            }

                            let author_name = author_username.to_string();

                            let is_owner = !owner_id.is_empty()
                                && (author_id == owner_id || author_username == owner_id);

                            let app_handle_clone = app_handle.clone();

                            // Clones for behaviour tracking inside spawn closures
                            let author_id_clone = author_id.to_string();
                            let message_snippet = content.chars().take(200).collect::<String>();
                            let behaviour_channel_id = {
                                let config = state.config.lock().await;
                                config.discord_behaviour_channel_id.clone()
                            };

                             if is_owner {
                                 println!("[DISCORD] Owner message/mention detected: {}", content);
                                 tauri::async_runtime::spawn(async move {
                                     let reply = generate_discord_action(
                                         &app_handle_clone,
                                         &state_clone,
                                         user_msg,
                                         &author_name,
                                         &guild_id,
                                     )
                                     .await;

                                     let use_embed = reply.contains("**CLI Agent Status:**")
                                         || reply.contains("Here are the channels in this server:")
                                         || reply.contains("System Status:")
                                         || reply.len() > 1000;

                                     let body = if use_embed {
                                         serde_json::json!({
                                             "embeds": [{
                                                 "color": 0x5865F2,
                                                 "description": reply,
                                                 "footer": { "text": "Pern AI" }
                                             }],
                                             "message_reference": {
                                                 "message_id": message_id
                                             }
                                         })
                                     } else {
                                         serde_json::json!({
                                             "content": reply,
                                             "message_reference": {
                                                 "message_id": message_id
                                             }
                                         })
                                     };

                                     let _ = discord_api_call(
                                         reqwest::Method::POST,
                                         &format!("/channels/{}/messages", channel_id),
                                         Some(body),
                                         &token,
                                         None,
                                     )
                                     .await;

                                     // Log behaviour
                                     let _ = record_behaviour_interaction(&author_id_clone, &author_name, &message_snippet).await;
                                     send_behaviour_log(&token, &behaviour_channel_id, &author_name, &author_id_clone, &message_snippet, "Action").await;
                                 });
                             } else {
                                 println!(
                                     "[DISCORD] Chat mention detected from non-owner {}: {}",
                                     author_name, content
                                 );
                                 tauri::async_runtime::spawn(async move {
                                     let reply = generate_discord_reply(
                                         &app_handle_clone,
                                         &state_clone,
                                         user_msg,
                                         &author_name,
                                     )
                                     .await;
                                     let body = serde_json::json!({
                                         "content": reply,
                                         "message_reference": {
                                             "message_id": message_id
                                         }
                                     });
                                     let _ = discord_api_call(
                                         reqwest::Method::POST,
                                         &format!("/channels/{}/messages", channel_id),
                                         Some(body),
                                         &token,
                                         None,
                                     )
                                     .await;

                                     // Log behaviour
                                     let _ = record_behaviour_interaction(&author_id_clone, &author_name, &message_snippet).await;
                                     send_behaviour_log(&token, &behaviour_channel_id, &author_name, &author_id_clone, &message_snippet, "Non-owner Chat").await;
                                 });
                             }
                        }
                    }
                }
            }
            _ => {}
        }

        Ok(())
    })
}

#[allow(dead_code)]
fn build_chat_system_prompt(author_name: &str, memory_context: &str) -> String {
    crate::chat_prompt::build_chat_system_prompt(&crate::chat_prompt::ChatPromptOptions {
        contact_name: author_name,
        platform: "Discord",
        memory_context,
        extra_rules: &[],
    })
}

#[allow(dead_code)]
fn build_action_system_prompt(
    _author_name: &str,
    _current_guild_id: &str,
    memory_context: &str,
    categories: &[String],
) -> String {
    crate::tools::build_action_system_prompt(memory_context, categories)
}

async fn generate_discord_action(
    app_handle: &AppHandle,
    state: &AppState,
    user_message: String,
    author_name: &str,
    _current_guild_id: &str,
) -> String {
    match crate::chat_prompt::request_frontend_reply(
        app_handle,
        state,
        "Discord",
        author_name,
        &user_message,
        true,
    )
    .await
    {
        Ok(reply) => reply,
        Err(e) => {
            println!("[DISCORD] Failed to get action reply from frontend: {}", e);
            "Sorry, I encountered an issue executing that command.".to_string()
        }
    }
}

#[allow(dead_code)]
fn parse_tool_calls(response_text: &str, guild_id: &str) -> Vec<ToolCall> {
    crate::tools::parse_plan_to_tool_calls(response_text, guild_id)
}

#[allow(dead_code)]
fn detect_discord_action_intent(text: &str) -> bool {
    let lower = text.to_lowercase();
    let mut trimmed = lower.trim();

    // Mentioning another Discord user => action (kick/ban/dm/etc.)
    if text.contains("<@") && text.contains(">") {
        return true;
    }

    // Strip polite prefixes recursively
    let polite_prefixes = [
        "please",
        "can you",
        "could you",
        "would you",
        "will you",
        "can you please",
        "could you please",
        "would you please",
        "will you please",
        "just",
        "hey",
        "hello",
        "hi",
        "tell me",
        "tell us",
        "show me",
        "show us",
    ];

    let mut stripped = true;
    while stripped {
        stripped = false;
        for &prefix in &polite_prefixes {
            if trimmed.starts_with(prefix) {
                let next = trimmed[prefix.len()..].trim();
                let prefix_len = prefix.len();
                let trimmed_len = trimmed.len();
                if next.is_empty() || (prefix_len < trimmed_len && {
                    let b = trimmed.as_bytes()[prefix_len];
                    b == b' ' || b == b',' || b == b':'
                }) {
                    trimmed = next;
                    stripped = true;
                }
            }
        }
    }

    // Specific tool terms (always indicate action mode regardless of conversational indicators)
    let specific_tool_terms = [
        "uptime",
        "behaviour",
        "behavior",
        "auto reply",
        "autoreply",
        "send email",
        "send an email",
        "email to",
        "purge messages",
        "delete messages",
        "cli agent",
        "cli agents",
        "execute agy",
        "run agy",
        "run claude",
        "run hermes",
        "run codex",
        "shutdown",
        "restart",
        "reboot",
        "poweroff",
    ];

    for &term in &specific_tool_terms {
        if trimmed.contains(term) {
            return true;
        }
    }

    // Conversational / general question patterns that should NOT trigger action mode
    let conversational_patterns = [
        "how ",
        "why ",
        "what ",
        "who ",
        "where ",
        "when ",
        "is there ",
        "are you ",
        "do you ",
        "can i ",
        "can we ",
        "could i ",
        "should i ",
        "should we ",
        "explain ",
        "describe ",
        "tell me a ",
        "tell me about ",
        "write a ",
        "write me ",
        "make a ",
        "make me ",
        "create a ",
        "generate ",
    ];

    let mut is_conversational = false;
    for &cp in &conversational_patterns {
        if trimmed.starts_with(cp) {
            is_conversational = true;
            break;
        }
    }

    // Action command keywords
    let action_keywords = [
        "open ",
        "launch ",
        "start ",
        "close ",
        "quit ",
        "exit ",
        "send ",
        "message ",
        "text ",
        "dm ",
        "tell ",
        "ask ",
        "say ",
        "add ",
        "save ",
        "create ",
        "configure ",
        "setup ",
        "set up ",
        "enable ",
        "disable ",
        "toggle ",
        "kick ",
        "ban ",
        "mute ",
        "unmute ",
        "unban ",
        "warn ",
        "purge ",
        "delete ",
        "remove ",
        "assign ",
        "set ",
        "execute ",
        "run ",
    ];

    // If it starts with conversational/question patterns, skip action keywords check
    if !is_conversational {
        for &kw in &action_keywords {
            if trimmed.starts_with(kw) || trimmed.contains(&format!(" {}", kw)) {
                return true;
            }
        }
    }

    // Tool-query phrases
    let query_phrases = [
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
        "change status",
        "set status",
        "set activity",
        "my behaviour",
        "behaviour of",
        "behaviour for",
        "behaviour about",
        "behaviour so far",
        "whats my behaviour",
        "what's my behaviour",
        "what is my behaviour",
        "set discord status",
        "change my status",
    ];

    for &q in &query_phrases {
        if trimmed.starts_with(q) {
            return true;
        }
    }

    false
}

fn get_system_uptime_seconds() -> Option<u64> {
    use std::process::Command;
    let script = "[Environment]::TickCount64";
    let mut cmd = Command::new("powershell");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = cmd
        .args(["-NoProfile", "-Command", script])
        .output()
        .ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Ok(ms) = text.parse::<u64>() {
            return Some(ms / 1000);
        }
    }
    None
}

fn format_duration(seconds: u64) -> String {
    let secs = seconds % 60;
    let mins = (seconds / 60) % 60;
    let hours = (seconds / 3600) % 24;
    let days = seconds / 86400;

    let mut parts = Vec::new();
    if days > 0 {
        parts.push(format!("{} day{}", days, if days == 1 { "" } else { "s" }));
    }
    if hours > 0 {
        parts.push(format!(
            "{} hour{}",
            hours,
            if hours == 1 { "" } else { "s" }
        ));
    }
    if mins > 0 {
        parts.push(format!(
            "{} minute{}",
            mins,
            if mins == 1 { "" } else { "s" }
        ));
    }
    if secs > 0 || parts.is_empty() {
        parts.push(format!(
            "{} second{}",
            secs,
            if secs == 1 { "" } else { "s" }
        ));
    }
    parts.join(", ")
}

fn find_channel_by_name(channels: &serde_json::Value, name: &str) -> Option<(String, String)> {
    let arr = channels.as_array()?;
    let target = name.to_lowercase();

    for c in arr {
        if let Some(c_name) = c.get("name").and_then(|n| n.as_str()) {
            if c_name.to_lowercase() == target {
                if let Some(c_id) = c.get("id").and_then(|id| id.as_str()) {
                    return Some((c_id.to_string(), c_name.to_string()));
                }
            }
        }
    }

    for c in arr {
        if let Some(c_name) = c.get("name").and_then(|n| n.as_str()) {
            let c_lower = c_name.to_lowercase();
            if c_lower.contains(&target) || target.contains(&c_lower) {
                if let Some(c_id) = c.get("id").and_then(|id| id.as_str()) {
                    return Some((c_id.to_string(), c_name.to_string()));
                }
            }
        }
    }

    None
}

#[allow(dead_code)]
fn internal_launch_single_app(app_name: &str) -> Result<serde_json::Value, String> {
    use std::process::Command;
    let quick_script = format!(
        "$proc = Start-Process \"{0}\" -ErrorAction SilentlyContinue -PassThru; \
         if ($proc) {{ echo \"launched\" }} else {{ echo \"failed\" }}",
        app_name.replace("\"", "`\"")
    );
    let mut quick_cmd = Command::new("powershell");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        quick_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let quick_output = quick_cmd
        .args(["-NoProfile", "-Command", &quick_script])
        .output()
        .map_err(|e| format!("PowerShell quick execution failed: {}", e))?;

    if String::from_utf8_lossy(&quick_output.stdout).trim() == "launched" {
        return Ok(serde_json::json!({
            "ok": true,
            "status": "launched",
            "app_name": app_name,
            "resolved_name": app_name
        }));
    }

    let script = format!(
        "$name = '{0}'; \
         $app = Get-StartApps | Where-Object {{ $_.Name -like \"*$name*\" -or $_.AppId -like \"*$name*\" }} | Select-Object -First 1; \
         if ($app) {{ \
            Start-Process \"explorer.exe\" -ArgumentList \"shell:AppsFolder\\$($app.AppId)\"; \
            echo \"launched|$($app.Name)|$($app.AppId)\" \
         }} else {{ \
            echo \"not_found\" \
         }}",
        app_name.replace("'", "''")
    );
    let mut deep_cmd = Command::new("powershell");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        deep_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = deep_cmd
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("PowerShell deep search failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if stdout.starts_with("launched|") {
        let parts: Vec<&str> = stdout.split('|').collect();
        let resolved_name = parts.get(1).unwrap_or(&"Unknown");
        Ok(serde_json::json!({
            "ok": true,
            "status": "launched",
            "app_name": app_name,
            "resolved_name": resolved_name
        }))
    } else {
        Ok(serde_json::json!({
            "ok": false,
            "status": "not_found",
            "app_name": app_name,
            "message": format!("I couldn't find '{}'. Check if it's installed.", app_name)
        }))
    }
}

#[allow(dead_code)]
fn internal_close_app(app_name: &str) -> Result<(), String> {
    use std::process::Command;
    let script = format!(
        "Stop-Process -Name \"{}\" -Force -ErrorAction SilentlyContinue",
        app_name
    );
    let mut cmd = Command::new("powershell");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let _ = cmd
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("PowerShell close failed: {}", e))?;
    Ok(())
}

async fn get_status(state: &AppState) -> Result<String, String> {
    // PC uptime
    let pc_uptime = get_system_uptime_seconds()
        .map(|s| format_duration(s))
        .unwrap_or_else(|| "Unknown".to_string());

    // Bot uptime (how long the app has been running)
    let bot_uptime_secs = state.start_time.elapsed().as_secs();
    let bot_uptime = format_duration(bot_uptime_secs);

    // Discord status
    let discord_status = state.discord_manager.status.lock().await.clone();
    let discord_bot_name = state.discord_manager.bot_name.lock().await.clone();
    let discord_guilds = state.discord_manager.guilds.lock().await.len();
    let discord_icon = match discord_status.as_str() {
        "connected" => "🟢",
        "connecting" => "🟡",
        _ => "⚪",
    };
    let discord_line = if let Some(name) = &discord_bot_name {
        format!(
            "{} **Discord** — Connected as {} ({} server{})",
            discord_icon,
            name,
            discord_guilds,
            if discord_guilds == 1 { "" } else { "s" }
        )
    } else {
        format!("{} **Discord** — {}", discord_icon, discord_status)
    };

    // WhatsApp status
    let wa_status = state.whatsapp_manager.status.lock().await.clone();
    let wa_contacts = {
        let config = state.config.lock().await;
        config.whatsapp_contacts.len()
    };
    let wa_icon = match wa_status.as_str() {
        "connected" => "🟢",
        "qr" | "connecting" => "🟡",
        _ => "⚪",
    };
    let wa_status_label = match wa_status.as_str() {
        "connected" => "Connected",
        "qr" => "Waiting for QR scan",
        "connecting" => "Connecting",
        _ => "Disconnected",
    };
    let wa_line = format!(
        "{} **WhatsApp** — {} ({} contact{})",
        wa_icon,
        wa_status_label,
        wa_contacts,
        if wa_contacts == 1 { "" } else { "s" }
    );

    // Email status
    let email_configured = {
        let config = state.config.lock().await;
        config.email_configured
    };
    let email_icon = if email_configured { "🟢" } else { "⚪" };
    let email_status = if email_configured {
        "Configured"
    } else {
        "Not configured"
    };
    let email_line = format!("{} **Email** — {}", email_icon, email_status);

    let output = format!(
        "**System Uptime:** {}\n**Bot Uptime:** {}\n\n{}\n{}\n{}",
        pc_uptime, bot_uptime, discord_line, wa_line, email_line
    );

    Ok(output)
}

#[allow(dead_code)]
fn get_bool_arg(args: &serde_json::Value, key: &str) -> Option<bool> {
    let val = args.get(key)?;
    if let Some(b) = val.as_bool() {
        return Some(b);
    }
    if let Some(s) = val.as_str() {
        let clean = s.trim().to_lowercase();
        if clean == "true" || clean == "1" {
            return Some(true);
        }
        if clean == "false" || clean == "0" {
            return Some(false);
        }
    }
    None
}

#[allow(dead_code)]
fn get_u64_arg(args: &serde_json::Value, key: &str) -> Option<u64> {
    let val = args.get(key)?;
    if let Some(n) = val.as_u64() {
        return Some(n);
    }
    if let Some(s) = val.as_str() {
        if let Ok(n) = s.trim().parse::<u64>() {
            return Some(n);
        }
    }
    None
}

#[allow(dead_code)]
async fn execute_discord_tool_call(
    _app_handle: &AppHandle,
    state: &AppState,
    tool: &str,
    args: &serde_json::Value,
    current_guild_id: &str,
    channel_id: &str,
    message_id: &str,
) -> Result<String, String> {
    match tool {
        "launch_app" => {
            let app_name = args
                .get("app_name")
                .and_then(|v| v.as_str())
                .ok_or("app_name is missing")?;
            let res = internal_launch_single_app(app_name)?;
            let ok = res.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            if ok {
                let resolved = res
                    .get("resolved_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(app_name);
                Ok(format!(
                    "Successfully launched **{}** on your PC.",
                    resolved
                ))
            } else {
                let msg = res
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Failed to launch app.");
                Err(msg.to_string())
            }
        }
        "close_app" => {
            let app_name = args
                .get("app_name")
                .and_then(|v| v.as_str())
                .ok_or("app_name is missing")?;
            internal_close_app(app_name)?;
            Ok(format!("Closed app **{}** on your PC.", app_name))
        }
        "restart_system" => {
            use std::process::Command;
            #[cfg(target_os = "windows")]
            let res = {
                let mut shutdown_cmd = Command::new("shutdown");
                use std::os::windows::process::CommandExt;
                shutdown_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                shutdown_cmd.args(["/r", "/t", "0"]).output()
            };
            #[cfg(target_os = "macos")]
            let res = Command::new("osascript").args(["-e", "tell app \"System Events\" to restart"]).output();
            #[cfg(target_os = "linux")]
            let res = Command::new("reboot").output();
            #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
            let res: Result<std::process::Output, std::io::Error> = Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Restart is not supported on this platform.",
            ));

            match res {
                Ok(output) if output.status.success() => {
                    Ok("System is restarting...".to_string())
                }
                Ok(output) => {
                    Err(format!("Restart failed: {}", String::from_utf8_lossy(&output.stderr)))
                }
                Err(e) => {
                    Err(format!("Restart failed: {}", e))
                }
            }
        }
        "shutdown_system" => {
            use std::process::Command;
            #[cfg(target_os = "windows")]
            let res = {
                let mut shutdown_cmd = Command::new("shutdown");
                use std::os::windows::process::CommandExt;
                shutdown_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                shutdown_cmd.args(["/s", "/t", "0"]).output()
            };
            #[cfg(target_os = "macos")]
            let res = Command::new("osascript").args(["-e", "tell app \"System Events\" to shut down"]).output();
            #[cfg(target_os = "linux")]
            let res = Command::new("poweroff").output();
            #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
            let res: Result<std::process::Output, std::io::Error> = Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Shutdown is not supported on this platform.",
            ));

            match res {
                Ok(output) if output.status.success() => {
                    Ok("System is shutting down...".to_string())
                }
                Ok(output) => {
                    Err(format!("Shutdown failed: {}", String::from_utf8_lossy(&output.stderr)))
                }
                Err(e) => {
                    Err(format!("Shutdown failed: {}", e))
                }
            }
        }
        "send_whatsapp_message" => {
            let recipient = args
                .get("recipient")
                .and_then(|v| v.as_str())
                .ok_or("recipient is missing")?;
            let message = args
                .get("message")
                .and_then(|v| v.as_str())
                .ok_or("message is missing")?;
            crate::integrations::whatsapp::internal_send_whatsapp_message(
                recipient.to_string(),
                message.to_string(),
                state,
            )
            .await?;
            Ok(format!(
                "Sent WhatsApp message to **{}**: *\"{}\"*",
                recipient, message
            ))
        }
        "set_whatsapp_auto_reply" => {
            let recipient = args
                .get("recipient")
                .and_then(|v| v.as_str())
                .ok_or("recipient is missing")?;
            let enabled = get_bool_arg(args, "enabled")
                .ok_or("enabled is missing or not a boolean")?;
            let actual_name =
                crate::integrations::whatsapp::internal_set_whatsapp_contact_auto_reply(
                    _app_handle,
                    recipient.to_string(),
                    enabled,
                    state,
                )
                .await?;
            let status_str = if enabled { "enabled" } else { "disabled" };
            Ok(format!(
                "Auto-reply {} for contact **{}** on WhatsApp.",
                status_str, actual_name
            ))
        }
        "toggle_whatsapp_auto_reply" => {
            let recipient = args
                .get("recipient")
                .and_then(|v| v.as_str())
                .ok_or("recipient is missing")?;
            let (actual_name, new_state) =
                crate::integrations::whatsapp::internal_toggle_whatsapp_contact_auto_reply(
                    _app_handle,
                    recipient.to_string(),
                    state,
                )
                .await?;
            let status_str = if new_state { "enabled" } else { "disabled" };
            Ok(format!(
                "Toggled auto-reply on WhatsApp. It is now **{}** for contact **{}**.",
                status_str, actual_name
            ))
        }
        "toggle_whatsapp" => {
            let enabled = get_bool_arg(args, "enabled")
                .ok_or("enabled is missing or not a boolean")?;
            let mut config = state.config.lock().await;
            config.whatsapp_enabled = enabled;
            save_config(&config)?;
            let status_str = if enabled { "enabled" } else { "disabled" };
            Ok(format!("WhatsApp auto-reply has been **{}**.", status_str))
        }
        "set_discord_status" => {
            let status = args
                .get("status")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let activity = args
                .get("activity")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if status.is_none() && activity.is_none() {
                return Err("Either status or activity must be provided".to_string());
            }
            internal_update_discord_status(status.clone(), activity.clone(), _app_handle, state)
                .await?;
            let mut parts = Vec::new();
            if let Some(s) = status {
                parts.push(format!("status to **{}**", s));
            }
            if let Some(a) = activity {
                parts.push(format!("activity to **{}**", a));
            }
            Ok(format!(
                "Successfully updated Discord bot's {}.",
                parts.join(" and ")
            ))
        }
        "set_discord_behaviour_channel" => {
            let channel_id = args
                .get("channel_id")
                .and_then(|v| v.as_str())
                .ok_or("channel_id is missing")?;
            {
                let mut config = state.config.lock().await;
                config.discord_behaviour_channel_id = channel_id.to_string();
                save_config(&config)?;
            }
            Ok(format!(
                "Behaviour tracking channel has been set to ID **{}**.",
                channel_id
            ))
        }
        "get_user_behaviour" => {
            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            let analysis = get_user_behaviour_analysis(user_id).await;
            Ok(analysis)
        }
        "discord_get_channels" => {
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() {
                current_guild_id
            } else {
                guild_id_arg
            };
            if guild_id.is_empty() {
                return Err("guild_id is missing and context is not a server.".to_string());
            }

            let channels_val = do_discord_get_channels(guild_id.to_string(), state).await?;
            if let Some(arr) = channels_val.as_array() {
                let mut list = "Here are the channels in this server:\n".to_string();
                for c in arr {
                    if let Some(name) = c.get("name").and_then(|n| n.as_str()) {
                        let c_type = c.get("type").and_then(|t| t.as_i64()).unwrap_or(0);
                        let id = c.get("id").and_then(|id| id.as_str()).unwrap_or_default();

                        let type_str = match c_type {
                            0 => "text",
                            2 => "voice",
                            4 => "category",
                            5 => "announcement",
                            _ => "other",
                        };

                        list.push_str(&format!(
                            "- **#{}** (ID: `{}` , Type: {})\n",
                            name, id, type_str
                        ));
                    }
                }
                Ok(list)
            } else {
                Err("Failed to get channels as a JSON array".to_string())
            }
        }
        "discord_send_channel_message" => {
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() {
                current_guild_id
            } else {
                guild_id_arg
            };
            if guild_id.is_empty() {
                return Err("guild_id is missing and context is not a server.".to_string());
            }

            let channel_name = args
                .get("channel_name")
                .and_then(|v| v.as_str())
                .ok_or("channel_name is missing")?;
            let message = args
                .get("message")
                .and_then(|v| v.as_str())
                .ok_or("message is missing")?;

            do_discord_send_channel_message(
                guild_id.to_string(),
                channel_name.to_string(),
                message.to_string(),
                state,
            )
            .await
        }
        "send_email" => {
            let to = args
                .get("to")
                .and_then(|v| v.as_str())
                .ok_or("to is missing")?;
            let subject = args
                .get("subject")
                .and_then(|v| v.as_str())
                .ok_or("subject is missing")?;
            let body = args
                .get("body")
                .and_then(|v| v.as_str())
                .ok_or("body is missing")?;

            let email_config = {
                let config = state.config.lock().await;
                if !config.email_configured {
                    return Err(
                        "Email configuration is incomplete. Configure SMTP in settings first."
                            .to_string(),
                    );
                }
                crate::integrations::email::EmailConfig {
                    smtp_host: config.email_smtp_host.clone(),
                    smtp_port: config.email_smtp_port,
                    sender_email: config.email_sender_email.clone(),
                    smtp_password: config.email_smtp_password.clone(),
                }
            };

            crate::integrations::email::send_email(&email_config, to, subject, body).await?;
            Ok(format!(
                "Successfully sent email to **{}** with subject: *\"{}\"*",
                to, subject
            ))
        }
        "discord_get_guilds" => {
            let guilds = do_discord_get_guilds(state).await;
            if guilds.is_empty() {
                Ok("I am not in any Discord servers currently.".to_string())
            } else {
                let mut list = "I am currently in these Discord servers:\n".to_string();
                for (id, name) in guilds {
                    list.push_str(&format!("- **{}** (ID: `{}`)\n", name, id));
                }
                Ok(list)
            }
        }
        "discord_kick" => {
            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() || guild_id_arg == user_id {
                current_guild_id
            } else {
                guild_id_arg
            };
            if guild_id.is_empty() {
                return Err("guild_id is missing and context is not a server.".to_string());
            }

            let reason = args.get("reason").and_then(|v| v.as_str());
            do_discord_kick(
                guild_id.to_string(),
                user_id.to_string(),
                reason.map(|r| r.to_string()),
                state,
            )
            .await?;
            Ok(format!(
                "Kicked user `{}` from server `{}`.",
                user_id, guild_id
            ))
        }
        "discord_ban" => {
            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() || guild_id_arg == user_id {
                current_guild_id
            } else {
                guild_id_arg
            };
            if guild_id.is_empty() {
                return Err("guild_id is missing and context is not a server.".to_string());
            }

            let reason = args.get("reason").and_then(|v| v.as_str());
            let delete_secs = get_u64_arg(args, "delete_message_seconds")
                .map(|s| s as u32);
            do_discord_ban(
                guild_id.to_string(),
                user_id.to_string(),
                reason.map(|r| r.to_string()),
                delete_secs,
                state,
            )
            .await?;
            Ok(format!(
                "Banned user `{}` from server `{}`.",
                user_id, guild_id
            ))
        }
        "discord_unban" => {
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() {
                current_guild_id
            } else {
                guild_id_arg
            };
            if guild_id.is_empty() {
                return Err("guild_id is missing and context is not a server.".to_string());
            }

            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            do_discord_unban(guild_id.to_string(), user_id.to_string(), state).await?;
            Ok(format!(
                "Unbanned user `{}` in server `{}`.",
                user_id, guild_id
            ))
        }
        "discord_mute" => {
            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() || guild_id_arg == user_id {
                current_guild_id
            } else {
                guild_id_arg
            };
            if guild_id.is_empty() {
                return Err("guild_id is missing and context is not a server.".to_string());
            }

            let duration = get_u64_arg(args, "duration_mins")
                .ok_or("duration_mins is missing or invalid")?;
            let reason = args.get("reason").and_then(|v| v.as_str());
            do_discord_mute(
                guild_id.to_string(),
                user_id.to_string(),
                duration,
                reason.map(|r| r.to_string()),
                state,
            )
            .await?;
            Ok(format!(
                "Muted user `{}` for {} minutes in server `{}`.",
                user_id, duration, guild_id
            ))
        }
        "discord_unmute" => {
            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() || guild_id_arg == user_id {
                current_guild_id
            } else {
                guild_id_arg
            };
            if guild_id.is_empty() {
                return Err("guild_id is missing and context is not a server.".to_string());
            }

            do_discord_unmute(guild_id.to_string(), user_id.to_string(), state).await?;
            Ok(format!(
                "Unmuted user `{}` in server `{}`.",
                user_id, guild_id
            ))
        }
        "discord_warn" => {
            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() || guild_id_arg == user_id {
                if current_guild_id.is_empty() {
                    None
                } else {
                    Some(current_guild_id.to_string())
                }
            } else {
                Some(guild_id_arg.to_string())
            };

            let reason = args
                .get("reason")
                .and_then(|v| v.as_str())
                .ok_or("reason is missing")?;
            do_discord_warn(guild_id, user_id.to_string(), reason.to_string(), state).await?;
            Ok(format!("Sent warning DM to user `{}`.", user_id))
        }
        "discord_delete_messages" => {
            let channel_id = args
                .get("channel_id")
                .and_then(|v| v.as_str())
                .ok_or("channel_id is missing")?;
            let count = get_u64_arg(args, "count")
                .ok_or("count is missing")?;
            do_discord_delete_messages(channel_id.to_string(), count as u32, state).await?;
            Ok(format!(
                "Deleted last {} messages in channel `{}`.",
                count, channel_id
            ))
        }
        "discord_assign_role" => {
            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() || guild_id_arg == user_id {
                current_guild_id
            } else {
                guild_id_arg
            };
            if guild_id.is_empty() {
                return Err("guild_id is missing and context is not a server.".to_string());
            }

            let role_id = args
                .get("role_id")
                .and_then(|v| v.as_str())
                .ok_or("role_id is missing")?;
            do_discord_assign_role(
                guild_id.to_string(),
                user_id.to_string(),
                role_id.to_string(),
                state,
            )
            .await?;
            Ok(format!(
                "Assigned role `{}` to user `{}`.",
                role_id, user_id
            ))
        }
        "discord_remove_role" => {
            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            let guild_id_arg = args.get("guild_id").and_then(|v| v.as_str()).unwrap_or("");
            let guild_id = if guild_id_arg.is_empty() || guild_id_arg == user_id {
                current_guild_id
            } else {
                guild_id_arg
            };
            if guild_id.is_empty() {
                return Err("guild_id is missing and context is not a server.".to_string());
            }

            let role_id = args
                .get("role_id")
                .and_then(|v| v.as_str())
                .ok_or("role_id is missing")?;
            do_discord_remove_role(
                guild_id.to_string(),
                user_id.to_string(),
                role_id.to_string(),
                state,
            )
            .await?;
            Ok(format!(
                "Removed role `{}` from user `{}`.",
                role_id, user_id
            ))
        }
        "discord_send_dm" => {
            let user_id = args
                .get("user_id")
                .and_then(|v| v.as_str())
                .ok_or("user_id is missing")?;
            let message = args
                .get("message")
                .and_then(|v| v.as_str())
                .ok_or("message is missing")?;
            do_discord_send_dm(user_id.to_string(), message.to_string(), state).await?;
            Ok(format!("Sent DM to user `{}`: *\"{}\"*", user_id, message))
        }
        "get_status" => get_status(state).await,
        "send_to_cli_agent" => {
            let agent_name = args
                .get("agent_name")
                .and_then(|v| v.as_str())
                .ok_or("agent_name is missing")?;
            let prompt = args
                .get("prompt")
                .and_then(|v| v.as_str())
                .ok_or("prompt is missing")?;
            let project_name = args
                .get("project_name")
                .and_then(|v| v.as_str());

            let normalized_agent_name = match agent_name.to_lowercase().trim() {
                "agy" | "antigravity" | "agye" => "agy".to_string(),
                "claude" | "claude-code" | "claude_code" | "claudecode" => "claude-code".to_string(),
                "codex" => "codex".to_string(),
                "hermes" => "hermes".to_string(),
                "freebuff" | "freebuf" => "freebuff".to_string(),
                other => other.to_string(),
            };

            let project_dir = if let Some(pname) = project_name {
                let config = state.config.lock().await;
                let requested_name = pname.trim();
                let project = config
                    .projects
                    .iter()
                    .find(|p| p.name == requested_name)
                    .or_else(|| {
                        config
                            .projects
                            .iter()
                            .find(|p| p.name.eq_ignore_ascii_case(requested_name))
                    })
                    .ok_or_else(|| format!("Project '{}' not found. Add it in settings first.", pname))?;
                let path = std::path::PathBuf::from(&project.path);
                if !path.exists() {
                    return Err(format!(
                        "Project directory '{}' does not exist.",
                        project.path
                    ));
                }
                Some(path)
            } else {
                None
            };

            let result = state
                .cli_agent_manager
                .send_prompt(
                    &normalized_agent_name,
                    prompt,
                    project_dir.as_deref(),
                    Some(crate::integrations::cli_agents::TaskOrigin::Discord {
                        channel_id: channel_id.to_string(),
                        message_id: message_id.to_string(),
                    }),
                )
                .await?;
            
            Ok(format!("Agent **{}** execution completed.\nSummary: {}", normalized_agent_name, result))
        }
        "get_cli_agents_status" => {
            let agents = state.cli_agent_manager.get_all_states().await;
            let mut lines = Vec::new();
            for a in agents {
                let status_icon = match a.status {
                    crate::integrations::cli_agents::AgentStatus::Running => "🔄",
                    crate::integrations::cli_agents::AgentStatus::Completed => "✅",
                    crate::integrations::cli_agents::AgentStatus::Failed => "❌",
                    crate::integrations::cli_agents::AgentStatus::NotFound => "⚠️",
                    _ => "💤",
                };
                let task_str = if let Some(task) = &a.current_task {
                    format!(" (working on: {})", if task.len() > 60 { &task[..60] } else { task })
                } else {
                    "".to_string()
                };
                lines.push(format!("{} **{}**: {:?}{}", status_icon, a.display_name, a.status, task_str));
            }
            Ok(format!("**CLI Agent Status:**\n{}", lines.join("\n")))
        }
        _ => Err(format!(
            "Tool '{}' is not supported via Discord Bot remote execution.",
            tool
        )),
    }
}

async fn generate_discord_reply(
    app_handle: &AppHandle,
    state: &AppState,
    user_message: String,
    author_name: &str,
) -> String {
    match crate::chat_prompt::request_frontend_reply(
        app_handle,
        state,
        "Discord",
        author_name,
        &user_message,
        false,
    )
    .await
    {
        Ok(reply) => reply,
        Err(e) => {
            println!("[DISCORD] Failed to get reply from frontend: {}", e);
            "Sorry, I encountered an issue thinking of a response.".to_string()
        }
    }
}

#[tauri::command]
pub async fn discord_test_token(token: String) -> Result<String, String> {
    let result = discord_api_call(reqwest::Method::GET, "/users/@me", None, &token, None).await?;
    if let Some(username) = result.get("username").and_then(|u| u.as_str()) {
        let discriminator = result
            .get("discriminator")
            .and_then(|d| d.as_str())
            .unwrap_or("0000");
        if discriminator == "0" || discriminator.is_empty() {
            Ok(username.to_string())
        } else {
            Ok(format!("{}#{}", username, discriminator))
        }
    } else {
        Err("Could not retrieve username from response.".to_string())
    }
}

#[tauri::command]
pub async fn toggle_discord(
    enabled: bool,
    token: String,
    status: String,
    activity: String,
    owner_id: String,
    behaviour_channel_id: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut config = state.config.lock().await;
        config.discord_enabled = enabled;
        config.discord_token = token;
        config.discord_status = status;
        config.discord_activity = activity;
        config.discord_owner_id = owner_id;
        config.discord_behaviour_channel_id = behaviour_channel_id;
        save_config(&config)?;
    }

    if enabled {
        let state_clone = Arc::new(state.inner().clone());
        internal_start_discord_session(app_handle, state_clone).await?;
    } else {
        stop_discord_runtime(state.inner()).await;
        let manager = &state.discord_manager;
        *manager.status.lock().await = "idle".to_string();
        *manager.bot_name.lock().await = None;
        *manager.bot_id.lock().await = None;
        manager.guilds.lock().await.clear();
        let _ = app_handle.emit("discord-status", "idle");
    }

    Ok(())
}

#[tauri::command]
pub async fn get_discord_status(
    state: State<'_, AppState>,
) -> Result<(String, Option<String>), String> {
    let status = state.discord_manager.status.lock().await.clone();
    let bot_name = state.discord_manager.bot_name.lock().await.clone();
    Ok((status, bot_name))
}

pub async fn do_discord_get_guilds(state: &AppState) -> Vec<(String, String)> {
    let guilds = state.discord_manager.guilds.lock().await;
    guilds.clone()
}

#[tauri::command]
pub async fn discord_get_guilds(
    state: State<'_, AppState>,
) -> Result<Vec<(String, String)>, String> {
    Ok(do_discord_get_guilds(state.inner()).await)
}

pub async fn do_discord_kick(
    guild_id: String,
    user_id: String,
    reason: Option<String>,
    state: &AppState,
) -> Result<(), String> {
    let token = get_discord_token(state).await?;
    let endpoint = format!("/guilds/{}/members/{}", guild_id, user_id);
    discord_api_call(
        reqwest::Method::DELETE,
        &endpoint,
        None,
        &token,
        reason.as_deref(),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn discord_kick(
    guild_id: String,
    user_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    do_discord_kick(guild_id, user_id, reason, state.inner()).await
}

pub async fn do_discord_ban(
    guild_id: String,
    user_id: String,
    reason: Option<String>,
    delete_message_seconds: Option<u32>,
    state: &AppState,
) -> Result<(), String> {
    let token = get_discord_token(state).await?;
    let endpoint = format!("/guilds/{}/bans/{}", guild_id, user_id);
    let body = delete_message_seconds.map(|secs| {
        serde_json::json!({
            "delete_message_seconds": secs
        })
    });
    discord_api_call(
        reqwest::Method::PUT,
        &endpoint,
        body,
        &token,
        reason.as_deref(),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn discord_ban(
    guild_id: String,
    user_id: String,
    reason: Option<String>,
    delete_message_seconds: Option<u32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    do_discord_ban(
        guild_id,
        user_id,
        reason,
        delete_message_seconds,
        state.inner(),
    )
    .await
}

pub async fn do_discord_unban(
    guild_id: String,
    user_id: String,
    state: &AppState,
) -> Result<(), String> {
    let token = get_discord_token(state).await?;
    let endpoint = format!("/guilds/{}/bans/{}", guild_id, user_id);
    discord_api_call(reqwest::Method::DELETE, &endpoint, None, &token, None).await?;
    Ok(())
}

#[tauri::command]
pub async fn discord_unban(
    guild_id: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    do_discord_unban(guild_id, user_id, state.inner()).await
}

pub async fn do_discord_mute(
    guild_id: String,
    user_id: String,
    duration_mins: u64,
    reason: Option<String>,
    state: &AppState,
) -> Result<(), String> {
    let token = get_discord_token(state).await?;
    let endpoint = format!("/guilds/{}/members/{}", guild_id, user_id);
    let now = chrono::Utc::now();
    let until = now + chrono::Duration::minutes(duration_mins as i64);
    let until_iso = until.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let body = serde_json::json!({
        "communication_disabled_until": until_iso
    });

    discord_api_call(
        reqwest::Method::PATCH,
        &endpoint,
        Some(body),
        &token,
        reason.as_deref(),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn discord_mute(
    guild_id: String,
    user_id: String,
    duration_mins: u64,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    do_discord_mute(guild_id, user_id, duration_mins, reason, state.inner()).await
}

pub async fn do_discord_unmute(
    guild_id: String,
    user_id: String,
    state: &AppState,
) -> Result<(), String> {
    let token = get_discord_token(state).await?;
    let endpoint = format!("/guilds/{}/members/{}", guild_id, user_id);

    let body = serde_json::json!({
        "communication_disabled_until": serde_json::Value::Null
    });

    discord_api_call(reqwest::Method::PATCH, &endpoint, Some(body), &token, None).await?;
    Ok(())
}

#[tauri::command]
pub async fn discord_unmute(
    guild_id: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    do_discord_unmute(guild_id, user_id, state.inner()).await
}

pub async fn do_discord_warn(
    guild_id: Option<String>,
    user_id: String,
    reason: String,
    state: &AppState,
) -> Result<(), String> {
    let token = get_discord_token(state).await?;

    let mut guild_info = String::new();
    if let Some(g_id) = guild_id {
        if let Ok(guild_resp) = discord_api_call(
            reqwest::Method::GET,
            &format!("/guilds/{}", g_id),
            None,
            &token,
            None,
        )
        .await
        {
            if let Some(name) = guild_resp.get("name").and_then(|n| n.as_str()) {
                guild_info = format!(" in **{}**", name);
            }
        }
    }

    let dm_channel_resp = discord_api_call(
        reqwest::Method::POST,
        "/users/@me/channels",
        Some(serde_json::json!({ "recipient_id": user_id })),
        &token,
        None,
    )
    .await?;

    let dm_channel_id = dm_channel_resp
        .get("id")
        .and_then(|id| id.as_str())
        .ok_or_else(|| "Failed to get DM channel ID".to_string())?;

    discord_api_call(
        reqwest::Method::POST,
        &format!("/channels/{}/messages", dm_channel_id),
        Some(serde_json::json!({
            "content": format!("⚠️ **Warning:** You have been warned{} for: {}", guild_info, reason)
        })),
        &token,
        None,
    )
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn discord_warn(
    guild_id: Option<String>,
    user_id: String,
    reason: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    do_discord_warn(guild_id, user_id, reason, state.inner()).await
}

pub async fn do_discord_delete_messages(
    channel_id: String,
    count: u32,
    state: &AppState,
) -> Result<(), String> {
    let token = get_discord_token(state).await?;
    if count == 0 {
        return Ok(());
    }

    let mut remaining = count;
    let mut before: Option<String> = None;

    while remaining > 0 {
        let limit = if remaining > 100 { 100 } else { remaining };
        let endpoint = if let Some(ref oldest_id) = before {
            format!("/channels/{}/messages?limit={}&before={}", channel_id, limit, oldest_id)
        } else {
            format!("/channels/{}/messages?limit={}", channel_id, limit)
        };
        let msgs_val = discord_api_call(reqwest::Method::GET, &endpoint, None, &token, None).await?;

        let raw_ids: Vec<String> = msgs_val
            .as_array()
            .ok_or_else(|| "Failed to parse messages response".to_string())?
            .iter()
            .filter_map(|m| {
                m.get("id")
                    .and_then(|id| id.as_str())
                    .map(|s| s.to_string())
            })
            .collect();

        if raw_ids.is_empty() {
            break;
        }

        let msg_ids: Vec<String> = raw_ids.iter().take(limit as usize).cloned().collect();

        if msg_ids.len() == 1 {
            let delete_endpoint = format!("/channels/{}/messages/{}", channel_id, msg_ids[0]);
            discord_api_call(
                reqwest::Method::DELETE,
                &delete_endpoint,
                None,
                &token,
                None,
            )
            .await?;
        } else {
            let delete_endpoint = format!("/channels/{}/messages/bulk-delete", channel_id);
            discord_api_call(
                reqwest::Method::POST,
                &delete_endpoint,
                Some(serde_json::json!({
                    "messages": msg_ids
                })),
                &token,
                None,
            )
            .await?;
        }

        // Track the oldest message ID for pagination
        before = msg_ids.last().cloned();
        let deleted = msg_ids.len() as u32;
        remaining = remaining.saturating_sub(deleted);
    }

    Ok(())
}

#[tauri::command]
pub async fn discord_delete_messages(
    channel_id: String,
    count: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    do_discord_delete_messages(channel_id, count, state.inner()).await
}

pub async fn do_discord_assign_role(
    guild_id: String,
    user_id: String,
    role_id: String,
    state: &AppState,
) -> Result<(), String> {
    let token = get_discord_token(state).await?;
    let endpoint = format!("/guilds/{}/members/{}/roles/{}", guild_id, user_id, role_id);
    discord_api_call(reqwest::Method::PUT, &endpoint, None, &token, None).await?;
    Ok(())
}

#[tauri::command]
pub async fn discord_assign_role(
    guild_id: String,
    user_id: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    do_discord_assign_role(guild_id, user_id, role_id, state.inner()).await
}

pub async fn do_discord_remove_role(
    guild_id: String,
    user_id: String,
    role_id: String,
    state: &AppState,
) -> Result<(), String> {
    let token = get_discord_token(state).await?;
    let endpoint = format!("/guilds/{}/members/{}/roles/{}", guild_id, user_id, role_id);
    discord_api_call(reqwest::Method::DELETE, &endpoint, None, &token, None).await?;
    Ok(())
}

#[tauri::command]
pub async fn discord_remove_role(
    guild_id: String,
    user_id: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    do_discord_remove_role(guild_id, user_id, role_id, state.inner()).await
}

pub async fn do_discord_send_dm(
    user_id: String,
    message: String,
    state: &AppState,
) -> Result<String, String> {
    let token = get_discord_token(state).await?;

    // Create a DM channel with the recipient
    let dm_channel_resp = discord_api_call(
        reqwest::Method::POST,
        "/users/@me/channels",
        Some(serde_json::json!({ "recipient_id": user_id })),
        &token,
        None,
    )
    .await?;

    let dm_channel_id = dm_channel_resp
        .get("id")
        .and_then(|id| id.as_str())
        .ok_or_else(|| "Failed to get DM channel ID".to_string())?;

    // Send the message to the DM channel
    discord_api_call(
        reqwest::Method::POST,
        &format!("/channels/{}/messages", dm_channel_id),
        Some(serde_json::json!({ "content": message })),
        &token,
        None,
    )
    .await?;

    Ok(format!("Sent DM on Discord: *\"{}\"*", message))
}

pub async fn do_discord_get_channels(
    guild_id: String,
    state: &AppState,
) -> Result<serde_json::Value, String> {
    let token = get_discord_token(state).await?;
    let endpoint = format!("/guilds/{}/channels", guild_id);
    discord_api_call(reqwest::Method::GET, &endpoint, None, &token, None).await
}

pub async fn do_discord_send_channel_message(
    guild_id: String,
    channel_name: String,
    message: String,
    state: &AppState,
) -> Result<String, String> {
    let channels_val = do_discord_get_channels(guild_id.clone(), state).await?;
    if let Some((channel_id, actual_name)) =
        find_channel_by_name(&channels_val, &channel_name)
    {
        let token = get_discord_token(state).await?;
        let body = serde_json::json!({
            "content": message
        });
        discord_api_call(
            reqwest::Method::POST,
            &format!("/channels/{}/messages", channel_id),
            Some(body),
            &token,
            None,
        )
        .await?;
        Ok(format!(
            "Sent message to channel **#{}** (ID: `{}`): *\"{}\"*",
            actual_name, channel_id, message
        ))
    } else {
        Err(format!(
            "Could not find channel matching name '{}' in this server.",
            channel_name
        ))
    }
}

pub async fn do_set_discord_behaviour_channel(
    channel_id: String,
    state: &AppState,
) -> Result<String, String> {
    let mut config = state.config.lock().await;
    config.discord_behaviour_channel_id = channel_id.to_string();
    save_config(&config)?;
    Ok(format!(
        "Behaviour tracking channel has been set to ID **{}**.",
        channel_id
    ))
}

pub async fn do_get_user_behaviour(
    user_id: String,
) -> Result<String, String> {
    Ok(get_user_behaviour_analysis(&user_id).await)
}

#[tauri::command]
pub async fn discord_send_dm(
    user_id: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    do_discord_send_dm(user_id, message, state.inner()).await
}

#[tauri::command]
pub async fn discord_send_channel_message(
    guild_id: String,
    channel_name: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    do_discord_send_channel_message(guild_id, channel_name, message, state.inner()).await
}

#[tauri::command]
pub async fn discord_get_channels(
    guild_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    do_discord_get_channels(guild_id, state.inner()).await
}

#[tauri::command]
pub async fn set_discord_behaviour_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    do_set_discord_behaviour_channel(channel_id, state.inner()).await
}

#[tauri::command]
pub async fn get_user_behaviour(
    user_id: String,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    do_get_user_behaviour(user_id).await
}

#[tauri::command]
pub async fn get_system_status(
    state: State<'_, AppState>,
) -> Result<String, String> {
    get_status(state.inner()).await
}

#[tauri::command]
pub async fn set_discord_status(
    status: Option<String>,
    activity: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if status.is_none() && activity.is_none() {
        return Err("Either status or activity must be provided".to_string());
    }
    let status_label = status.clone();
    let activity_label = activity.clone();
    internal_update_discord_status(status, activity, &app_handle, state.inner()).await?;
    let mut parts = Vec::new();
    if let Some(s) = status_label {
        parts.push(format!("status to **{}**", s));
    }
    if let Some(a) = activity_label {
        parts.push(format!("activity to **{}**", a));
    }
    Ok(format!("Successfully updated Discord bot's {}.", parts.join(" and ")))
}

pub async fn internal_update_discord_status(
    status: Option<String>,
    activity: Option<String>,
    app_handle: &AppHandle,
    state: &AppState,
) -> Result<(), String> {
    let enabled = {
        let mut config = state.config.lock().await;
        if let Some(s) = status {
            let normalized = match s.trim().to_lowercase().as_str() {
                "online" | "active" | "run" | "running" => "online".to_string(),
                "dnd" | "busy" | "do not disturb" | "do_not_disturb" => "dnd".to_string(),
                "offline" | "invisible" | "hidden" => "invisible".to_string(),
                _ => "idle".to_string(),
            };
            config.discord_status = normalized;
        }
        if let Some(a) = activity {
            config.discord_activity = a;
        }
        save_config(&config)?;
        config.discord_enabled
    };

    if enabled {
        let state_clone = Arc::new(state.clone());
        internal_start_discord_session(app_handle.clone(), state_clone).await?;
    }

    Ok(())
}

// ── User behaviour tracking ──────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct DiscordUserEntry {
    pub user_id: String,
    pub username: String,
    pub first_seen: String,
    pub last_interaction: String,
    pub message_count: u64,
    pub recent_messages: Vec<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct DiscordUserStats {
    pub users: Vec<DiscordUserEntry>,
}

impl DiscordUserStats {
    fn get_path() -> std::path::PathBuf {
        let mut path = crate::storage::get_app_dir();
        path.push("discord_user_stats.json");
        path
    }

    fn load() -> Self {
        let path = Self::get_path();
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(data) = serde_json::from_str::<DiscordUserStats>(&content) {
                    return data;
                }
            }
        }
        Self::default()
    }

    fn save(&self) -> Result<(), String> {
        let path = Self::get_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, content).map_err(|e| e.to_string())
    }

    fn record_interaction(&mut self, user_id: &str, username: &str, message: &str) -> Result<(), String> {
        let now = chrono::Local::now().to_rfc3339();
        let msg = message.chars().take(200).collect::<String>();
        if let Some(entry) = self.users.iter_mut().find(|e| e.user_id == user_id) {
            entry.last_interaction = now;
            entry.message_count += 1;
            if entry.username != username {
                entry.username = username.to_string();
            }
            entry.recent_messages.push(msg);
            if entry.recent_messages.len() > 15 {
                entry.recent_messages.remove(0);
            }
        } else {
            self.users.push(DiscordUserEntry {
                user_id: user_id.to_string(),
                username: username.to_string(),
                first_seen: now.clone(),
                last_interaction: now,
                message_count: 1,
                recent_messages: vec![msg],
            });
        }
        self.save()
    }

    fn get_user(&self, user_id: &str) -> Option<&DiscordUserEntry> {
        self.users.iter().find(|e| e.user_id == user_id)
    }
}

/// Send a log message to the configured behaviour channel (if set).
/// Runs inside spawn blocks — uses its own reqwest client.
async fn send_behaviour_log(
    token: &str,
    behaviour_channel_id: &str,
    author_name: &str,
    author_id: &str,
    message_snippet: &str,
    reply_type: &str,
) {
    if behaviour_channel_id.is_empty() {
        return;
    }
    let client = reqwest::Client::new();
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let content = format!(
        "**[Behaviour Log] {}**\n> User: {} (`{}`)\n> Action: {}\n> Message: {}\n> Time: {}",
        reply_type, author_name, author_id, reply_type, message_snippet, timestamp
    );
    let body = serde_json::json!({ "content": content });
    let url = format!(
        "https://discord.com/api/v10/channels/{}/messages",
        behaviour_channel_id
    );
    let _ = client
        .post(&url)
        .header("Authorization", format!("Bot {}", token))
        .json(&body)
        .send()
        .await;
}

/// Record user interaction stats and store their message.
async fn record_behaviour_interaction(
    user_id: &str,
    username: &str,
    message: &str,
) -> Result<(), String> {
    let mut stats = DiscordUserStats::load();
    stats.record_interaction(user_id, username, message)
}

/// Get a formatted behaviour analysis for a specific user by asking the AI.
async fn get_user_behaviour_analysis(user_id: &str) -> String {
    let stats = DiscordUserStats::load();
    let entry = match stats.get_user(user_id) {
        Some(e) => e,
        None => {
            return format!("I haven't interacted with user `{}` yet, so I don't have any behaviour data on them.", user_id);
        }
    };

    if entry.recent_messages.is_empty() {
        return format!(
            "**Behaviour Report for {} (`{}`)**\n\
             ─────────────────────\n\
             Messages to Pern: {}\n\
             First interaction: {}\n\
             Last interaction: {}\n\
             No recent messages stored to analyse further.\n\
             ─────────────────────",
            entry.username, entry.user_id, entry.message_count, entry.first_seen, entry.last_interaction
        );
    }

    // Build conversation history
    let conversation = entry.recent_messages.join("\n");
    let prompt = format!(
        "Based on the following conversation history with a Discord user named {} (ID: {}), \
         write a concise behaviour analysis of this user. Include:\n\
         - What kind of person they seem to be (tone, personality, communication style)\n\
         - Topics they care about\n\
         - Your impression of them\n\
         Keep it to 3-4 sentences, natural and insightful.\n\n\
         Conversation history (their messages to me):\n{}\n\nBehaviour Analysis:",
        entry.username, entry.user_id, conversation
    );

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "local",
        "messages": [
            {"role": "system", "content": "You are Pern, analysing the behaviour of Discord users based on your conversation history with them. Be honest, insightful, and concise."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.8,
        "stream": false,
        "max_tokens": 300
    });

    let res = match client
        .post("http://127.0.0.1:4891/v1/chat/completions")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => {
            return format!(
                "**Behaviour Report for {} (`{}`)**\n\
                 ─────────────────────\n\
                 Messages to Pern: {}\n\
                 Could not connect to AI for deeper analysis.\n\
                 ─────────────────────",
                entry.username, entry.user_id, entry.message_count
            );
        }
    };

    let json: serde_json::Value = match res.json().await {
        Ok(j) => j,
        Err(_) => {
            return format!(
                "**Behaviour Report for {} (`{}`)**\n\
                 ─────────────────────\n\
                 Messages to Pern: {}\n\
                 AI analysis failed to parse.\n\
                 ─────────────────────",
                entry.username, entry.user_id, entry.message_count
            );
        }
    };

    let analysis = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("Could not generate analysis.")
        .trim()
        .to_string();

    format!(
        "**Behaviour Report for {} (`{}`)**\n\
         ─────────────────────\n\
         Messages to Pern: {}\n\
         First interaction: {}\n\
         Last interaction: {}\n\
         ─────────────────────\n\
         {}\n\
         ─────────────────────",
        entry.username, entry.user_id, entry.message_count, entry.first_seen, entry.last_interaction, analysis
    )
}

pub async fn send_discord_reply_outside(
    channel_id: &str,
    message_id: &str,
    reply_text: &str,
    state: &AppState,
) -> Result<(), String> {
    let token = {
        let config = state.config.lock().await;
        config.discord_token.clone()
    };
    if token.trim().is_empty() {
        return Err("Discord token is empty".to_string());
    }

    let body = serde_json::json!({
        "content": reply_text,
        "message_reference": {
            "message_id": message_id
        }
    });

    let _ = discord_api_call(
        reqwest::Method::POST,
        &format!("/channels/{}/messages", channel_id),
        Some(body),
        &token,
        None,
    )
    .await?;

    Ok(())
}
