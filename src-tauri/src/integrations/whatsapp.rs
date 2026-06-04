use crate::chat::{ChatMessage, ChatRequest, OpenAIStreamChunk};
use crate::model::WhatsAppContact;
use crate::state::AppState;
use crate::storage::{get_app_dir, save_config, RecentChat};
use base64::{engine::general_purpose, Engine as _};
use futures_util::StreamExt;
use qrcode_generator::QrCodeEcc;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use wa_rs::bot::Bot;
use wa_rs::client::Client;
use wa_rs::request::{InfoQuery, InfoQueryType};
use wa_rs::types::events::Event;
use wa_rs_binary::builder::NodeBuilder;
use wa_rs_binary::jid::{Jid, SERVER_JID};
use wa_rs_binary::node::{Node, NodeContent};
use wa_rs_proto::whatsapp::Message as WaMessage;
use wa_rs_sqlite_storage::SqliteStore;
extern crate libsqlite3_sys;

pub struct WhatsAppManager {
    pub bot: Arc<Mutex<Option<Bot>>>,
    pub status: Arc<Mutex<String>>,
    pub qr_code: Arc<Mutex<Option<String>>>,
    pub runtime_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    /// Handle to wa_rs's internal event loop task (spawned by bot.run()).
    /// Stored here so stop_whatsapp_runtime can abort it directly, since
    /// dropping the Bot struct does NOT abort wa_rs's internally-spawned tasks.
    /// Note: bot.run() returns tokio::task::JoinHandle (not tauri's wrapper).
    pub bot_event_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    pub session_op_lock: Arc<Mutex<()>>,
}

impl WhatsAppManager {
    pub fn new() -> Self {
        Self {
            bot: Arc::new(Mutex::new(None)),
            status: Arc::new(Mutex::new("idle".to_string())),
            qr_code: Arc::new(Mutex::new(None)),
            runtime_task: Arc::new(Mutex::new(None)),
            bot_event_handle: Arc::new(Mutex::new(None)),
            session_op_lock: Arc::new(Mutex::new(())),
        }
    }
}

async fn generate_reply(
    app_handle: &AppHandle,
    state: &AppState,
    user_message: String,
    contact_name: Option<&str>,
) -> String {
    let (selected_model, user_memory) = {
        let config = state.config.lock().await;
        (config.selected_model.clone(), config.user_memory.clone())
    };

    if selected_model.is_empty() {
        return "I don't have a model selected to reply with.".to_string();
    }

    let mut memory_context = String::new();
    if let Some(owner_name) = &user_memory.name {
        memory_context.push_str(&format!(
            "The owner of the device you are running on is {}. ",
            owner_name
        ));
    }
    if !user_memory.persona.is_empty() {
        memory_context.push_str(&format!(
            "Information about the owner: {}. ",
            user_memory.persona.join("; ")
        ));
    }
    if !user_memory.conversation_summary.is_empty() {
        memory_context.push_str(&format!(
            "Recent conversation context: {}. ",
            user_memory.conversation_summary
        ));
    }

    let system_prompt = crate::chat_prompt::build_chat_system_prompt(&crate::chat_prompt::ChatPromptOptions {
        contact_name: contact_name.unwrap_or("a contact"),
        platform: "WhatsApp",
        memory_context: &memory_context,
        extra_rules: &[
            "DO NOT give unsolicited advice or jump to specific topics like job applications unless they ask.",
            "DO NOT use generic filler phrases like 'Okay!', 'That\'s awesome!', or 'Let me know what you need!'.",
            "DO NOT use emojis unless they add genuine warmth, and strictly limit to 1 per message.",
        ],
    });

    let client = reqwest::Client::new();
    let messages = vec![
        ChatMessage {
            role: "system".into(),
            content: system_prompt,
        },
        ChatMessage {
            role: "user".into(),
            content: user_message,
        },
    ];

    let req_body = ChatRequest {
        model: "local".to_string(),
        messages,
        temperature: 0.7,
        stream: true,
        max_tokens: None,
        stop: None,
    };

    let mut attempts = 0;
    let max_attempts = 45;
    let res;

    loop {
        let send_res = client
            .post("http://127.0.0.1:4891/v1/chat/completions")
            .json(&req_body)
            .send()
            .await;

        match send_res {
            Ok(response) => {
                let status = response.status();
                if status.as_u16() == 503 {
                    attempts += 1;
                    if attempts >= max_attempts {
                        return "Sorry, I am still loading my brain. Please try again in a minute."
                            .into();
                    }
                    let _ = app_handle.emit("app-log", serde_json::json!({
                        "level": "info",
                        "message": format!("[WHATSAPP] AI model is loading (attempt {}/{}), waiting...", attempts, max_attempts)
                    }));
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }

                if !status.is_success() {
                    return "Sorry, I encountered an error while thinking.".into();
                }

                res = response;
                break;
            }
            Err(_e) => {
                attempts += 1;
                if attempts >= max_attempts {
                    return "Sorry, I am having trouble connecting to my brain right now.".into();
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }

    let mut stream = res.bytes_stream();
    let full_response = Arc::new(Mutex::new(String::new()));
    let mut buffer = Vec::new();

    while let Some(chunk_res) = stream.next().await {
        if let Ok(chunk) = chunk_res {
            buffer.extend_from_slice(&chunk);

            let mut unparsed = Vec::new();
            let buffer_str = String::from_utf8_lossy(&buffer);

            for line in buffer_str.lines() {
                let line = line.trim();
                if line.starts_with("data: ") {
                    let data = &line[6..];
                    if data == "[DONE]" {
                        break;
                    }
                    if let Ok(response) = serde_json::from_str::<OpenAIStreamChunk>(data) {
                        if let Some(choice) = response.choices.first() {
                            if let Some(content) = &choice.delta.content {
                                let mut resp_guard = full_response.lock().await;
                                resp_guard.push_str(content);
                            }
                        }
                    }
                } else if !line.is_empty() {
                    unparsed.extend_from_slice(line.as_bytes());
                    unparsed.push(b'\n');
                }
            }
            buffer = unparsed;
        }
    }

    let final_resp = full_response.lock().await.clone();
    let _ = app_handle.emit(
        "app-log",
        serde_json::json!({
            "level": "debug",
            "message": format!("[WHATSAPP] Model raw output: {}", final_resp)
        }),
    );
    let mut reply = final_resp.trim().to_string();

// Clean up potential tool calls or markdown blocks that the LLM might have hallucinated
    if reply.contains("{\"tool\":") || reply.contains("```json") {
        let _ = app_handle.emit(
            "app-log",
            serde_json::json!({
                "level": "debug",
                "message": "[WHATSAPP] Detected tool call in output, stripping to plain text."
            }),
        );

        // Simple regex-less stripping: find the first { and last } if it looks like JSON
        // or just look for the text before the JSON
        if let Some(idx) = reply.find("{\"tool\":") {
            let before = reply[..idx].trim().to_string();
            // Only strip if there is actually text before the JSON
            if !before.is_empty() {
                reply = before;
            }
            // If the entire message is just the JSON tool call with no context,
            // keep it as-is rather than returning empty
        }

        // Also strip markdown blocks
        if let Some(idx) = reply.find("```") {
            let before = reply[..idx].trim().to_string();
            reply = before;
        }
    }

    if reply.is_empty() {
        let _ = app_handle.emit(
            "app-log",
            serde_json::json!({
                "level": "warn",
                "message": "[WHATSAPP] Model returned an empty response."
            }),
        );
        "I heard you, but I'm not sure what to say.".into()
    } else {
        let _ = app_handle.emit(
            "app-log",
            serde_json::json!({
                "level": "info",
                "message": format!("[WHATSAPP] Reply generated ({} chars).", reply.len())
            }),
        );
        reply
    }
}

fn clean_number(input: &str) -> String {
    input.chars().filter(|c| c.is_ascii_digit()).collect()
}

fn normalize_name(input: &str) -> String {
    input
        .to_lowercase()
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_key(input: &str) -> String {
    input
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
}

async fn get_current_client(state: &AppState) -> Option<Arc<Client>> {
    let bot_guard = state.whatsapp_manager.bot.lock().await;
    bot_guard.as_ref().map(|bot| bot.client())
}

async fn disconnect_current_client(client: &Arc<Client>) {
    // Don't check is_connected() — always attempt disconnect.
    // During QR-scan state, is_connected() returns false but the bot's
    // WebSocket event loop is still running. We must close it unconditionally.
    let _ = client.disconnect().await;
}

/// Clear the WhatsApp database in-place using libsqlite3-sys raw FFI.
/// This works even when wa_rs has the file open (SQLite WAL allows concurrent connections).
/// We delete all rows from every table so the next bot start has no stored credentials
/// and generates a fresh QR code, without needing to delete the locked .db file.
async fn clear_whatsapp_db() {
    let mut db_path = get_app_dir();
    db_path.push("whatsapp.db");

    if !db_path.exists() {
        return;
    }

    let db_path_str = db_path.to_string_lossy().to_string();
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::ffi::{CStr, CString};
        use libsqlite3_sys as ffi;

        let path = CString::new(db_path_str).map_err(|e| e.to_string())?;
        let mut db: *mut ffi::sqlite3 = std::ptr::null_mut();

        // Open with WAL-compatible flags: read+write, no create
        let rc = unsafe {
            ffi::sqlite3_open_v2(
                path.as_ptr(),
                &mut db,
                ffi::SQLITE_OPEN_READWRITE,
                std::ptr::null(),
            )
        };
        if rc != ffi::SQLITE_OK {
            return Err(format!("sqlite3_open_v2 failed: {}", rc));
        }

        // Set a 5-second busy timeout so we don't spin-wait
        unsafe { ffi::sqlite3_busy_timeout(db, 5000) };

        // Helper to run a SQL string
        let exec = |sql: &str| -> bool {
            let csql = match CString::new(sql) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let rc = unsafe {
                ffi::sqlite3_exec(db, csql.as_ptr(), None, std::ptr::null_mut(), std::ptr::null_mut())
            };
            rc == ffi::SQLITE_OK
        };

        // Retrieve table names via sqlite3_prepare/step
        let tables: Vec<String> = {
            let query = CString::new(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).unwrap();
            let mut stmt: *mut ffi::sqlite3_stmt = std::ptr::null_mut();
            let mut names = Vec::new();

            let rc = unsafe {
                ffi::sqlite3_prepare_v2(db, query.as_ptr(), -1, &mut stmt, std::ptr::null_mut())
            };
            if rc == ffi::SQLITE_OK {
                loop {
                    let step = unsafe { ffi::sqlite3_step(stmt) };
                    if step == ffi::SQLITE_ROW {
                        let raw = unsafe { ffi::sqlite3_column_text(stmt, 0) };
                        if !raw.is_null() {
                            let name = unsafe { CStr::from_ptr(raw as *const _) }
                                .to_string_lossy()
                                .into_owned();
                            names.push(name);
                        }
                    } else {
                        break;
                    }
                }
                unsafe { ffi::sqlite3_finalize(stmt) };
            }
            names
        };

        // Disable foreign keys so we can drop tables in any order
        exec("PRAGMA foreign_keys = OFF");

        // DROP all user tables — the migration will recreate them fresh.
        // Using DELETE FROM was wrong: tables still existed, so SqliteStore's
        // migration failed with "table identities already exists".
        for table in &tables {
            exec(&format!("DROP TABLE IF EXISTS \"{}\"", table));
        }

        exec("PRAGMA foreign_keys = ON");

        // Passive checkpoint: flush WAL so dropped tables are committed
        exec("PRAGMA wal_checkpoint(PASSIVE)");

        unsafe { ffi::sqlite3_close(db) };
        Ok(())
    }).await;

    match result {
        Ok(Ok(())) => println!("[WHATSAPP] Database cleared successfully."),
        Ok(Err(e)) => println!("[WHATSAPP] Failed to clear database: {}", e),
        Err(e) => println!("[WHATSAPP] DB clear task panicked: {}", e),
    }
}


fn build_lid_resolution_node(jid: &Jid, sid: &str) -> Node {
    let user_node = NodeBuilder::new("user")
        .attr("jid", jid.to_string())
        .build();

    let query_node = NodeBuilder::new("query")
        .children([NodeBuilder::new("contact").build()])
        .build();

    let list_node = NodeBuilder::new("list").children([user_node]).build();

    NodeBuilder::new("usync")
        .attrs([
            ("context", "message"),
            ("index", "0"),
            ("last", "true"),
            ("mode", "query"),
            ("sid", sid),
        ])
        .children([query_node, list_node])
        .build()
}

async fn resolve_phone_number_for_jid(client: &Arc<Client>, jid: &Jid) -> Option<String> {
    let sid = format!("usync-{}", &uuid::Uuid::new_v4().to_string()[..8]);
    let usync_node = build_lid_resolution_node(jid, sid.as_str());
    let iq_id = format!("iq-{}", &uuid::Uuid::new_v4().to_string()[..8]);
    let iq = InfoQuery {
        namespace: "usync".into(),
        query_type: InfoQueryType::Get,
        to: SERVER_JID.parse().ok()?,
        content: Some(NodeContent::Nodes(vec![usync_node])),
        id: Some(iq_id),
        target: None,
        timeout: None,
    };

    let response =
        match tokio::time::timeout(std::time::Duration::from_secs(15), client.send_iq(iq)).await {
            Ok(Ok(res)) => {
                res
            }
            Ok(Err(e)) => {
                println!("[WHATSAPP] usync IQ error: {:?}", e);
                return None;
            }
            Err(_) => {
                println!("[WHATSAPP] usync IQ timeout after 15s");
                return None;
            }
        };

    let phone = (|| {
        let usync_node = response.get_optional_child("usync")?;
        let list_node = usync_node.get_optional_child("list")?;
        let user_node = list_node.get_optional_child("user")?;

        if let Some(contact_node) = user_node.get_optional_child("contact") {
            if let Some(NodeContent::String(pn_jid_str)) = &contact_node.content {
                if let Ok(pn_jid) = pn_jid_str.parse::<Jid>() {
                    return Some(clean_number(&pn_jid.user));
                }
            }
        }

        if let Some(trait_node) = user_node.get_optional_child("usertrait") {
            if let Some(phone_node) = trait_node.get_optional_child("phone") {
                if let Some(NodeContent::String(pn)) = &phone_node.content {
                    return Some(clean_number(pn));
                }
            }
        }

        None
    })();

    phone
}

async fn stop_whatsapp_runtime(state: &AppState) {
    // Step 1: Signal wa_rs to stop by disconnecting.
    // Do NOT check is_connected() — it returns false during QR-scan state
    // but the bot's event loop task is still running and needs to be stopped.
    let client = get_current_client(state).await;
    if let Some(client) = &client {
        disconnect_current_client(client).await;
    }
    drop(client);

    // Step 2: Set status idle so the runtime loop's break condition fires.
    *state.whatsapp_manager.status.lock().await = "idle".to_string();

    // Step 3: Abort wa_rs's internal event loop task directly.
    //
    // wa_rs spawns its own tokio task when bot.run() is called. We store that
    // JoinHandle in bot_event_handle. Aborting it is the ONLY reliable way to
    // force-stop the event loop when disconnect() alone doesn't work (QR state,
    // network hang, etc.). This also drops the task's captured state, which
    // releases its Arc<SqliteStore> reference once the cancellation propagates.
    let bot_event = {
        let mut h = state.whatsapp_manager.bot_event_handle.lock().await;
        h.take()
    };
    if let Some(handle) = bot_event {
        handle.abort();
        // Don't await here — we'll abort the outer runtime_task next, which
        // cleans up the await that was waiting on this handle.
    }

    // Step 4: Drop the bot struct. This releases the Bot's own Arc<SqliteStore>.
    *state.whatsapp_manager.bot.lock().await = None;

    // Step 5: Wait for the runtime_task to exit. After we aborted the event handle
    // and set status=idle, the runtime loop should break and do its own cleanup
    // (setting bot/status/qr to None). Give it a brief window before force-aborting.
    let runtime_task = {
        let mut task_guard = state.whatsapp_manager.runtime_task.lock().await;
        task_guard.take()
    };

    if let Some(mut task) = runtime_task {
        tokio::select! {
            _ = &mut task => {}
            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {
                task.abort();
                let _ = task.await;
            }
        }
    }

    // Step 6: Brief OS buffer time.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
}

pub async fn cleanup_whatsapp_for_shutdown(state: &AppState) {
    stop_whatsapp_runtime(state).await;
}

pub async fn internal_start_whatsapp_session(
    app_handle: AppHandle,
    state: Arc<AppState>,
) -> Result<(), String> {
    let _op_guard = state.whatsapp_manager.session_op_lock.lock().await;

    // If a runtime task is running and we're not idle, just re-emit current state
    {
        let task_guard = state.whatsapp_manager.runtime_task.lock().await;
        if task_guard.is_some() {
            let status = state.whatsapp_manager.status.lock().await;
            if status.as_str() != "idle" {
                let qr = state.whatsapp_manager.qr_code.lock().await;
                let _ = app_handle.emit("whatsapp-status", status.clone());
                let _ = app_handle.emit("whatsapp-qr", qr.clone());
                return Ok(());
            }
            // Task exists but status is idle — fall through to clean up and restart
        }
    }

    // Clean up any stale state (task exited or status is idle)
    // NOTE: We call stop_whatsapp_runtime here which sets status=idle,
    // drops the bot, and waits for the task — but we already hold session_op_lock.
    // stop_whatsapp_runtime does NOT acquire session_op_lock so this is safe.
    {
        let has_task = state.whatsapp_manager.runtime_task.lock().await.is_some();
        let has_bot = state.whatsapp_manager.bot.lock().await.is_some();
        if has_task || has_bot {
            // Drop bot/task manually without going through stop_whatsapp_runtime
            // to avoid extra delay; just ensure clean state.
            let stale_event = state.whatsapp_manager.bot_event_handle.lock().await.take();
            if let Some(h) = stale_event {
                h.abort();
            }
            *state.whatsapp_manager.bot.lock().await = None;
            let stale_task = state.whatsapp_manager.runtime_task.lock().await.take();
            if let Some(task) = stale_task {
                task.abort();
                let _ = task.await;
            }
        }
    }
    *state.whatsapp_manager.qr_code.lock().await = None;

    let mut db_path = get_app_dir();
    db_path.push("whatsapp.db");

    // Try to open the backend storage. If migration fails because tables already exist
    // (e.g. from a previous incomplete logout that used DELETE FROM instead of DROP TABLE),
    // auto-recover by dropping all tables and retrying once.
    let backend = {
        let db_str = db_path.to_string_lossy().to_string();
        match SqliteStore::new_for_device(&db_str, 1).await {
            Ok(b) => Arc::new(b),
            Err(e) => {
                let err = e.to_string();
                if err.contains("already exists") || err.to_lowercase().contains("migration") {
                    println!("[WHATSAPP] Migration error detected (stale schema), clearing DB and retrying: {}", err);
                    clear_whatsapp_db().await;
                    Arc::new(
                        SqliteStore::new_for_device(&db_str, 1)
                            .await
                            .map_err(|e2| format!("Migration recovery failed: {}", e2))?,
                    )
                } else {
                    return Err(err);
                }
            }
        }
    };

    let manager = state.whatsapp_manager.clone();
    *manager.status.lock().await = "connecting".to_string();
    *manager.qr_code.lock().await = None;
    let _ = app_handle.emit("whatsapp-status", "connecting");
    let _ = app_handle.emit("whatsapp-qr", Option::<String>::None);

    let app_handle_inner = app_handle.clone();
    let state_inner = state.clone();

    let hb_manager = manager.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let status = { hb_manager.status.lock().await.clone() };
            if status == "idle" {
                break;
            }
        }
    });

    let runtime_handle = tauri::async_runtime::spawn(async move {
        loop {
            let app_handle_clone = app_handle_inner.clone();
            let state_clone = state_inner.clone();

            let bot_result = Bot::builder()
                .with_backend(backend.clone())
                .with_transport_factory(wa_rs_tokio_transport::TokioWebSocketTransportFactory::new())
                .with_http_client(wa_rs_ureq_http::UreqHttpClient::new())
                .on_event(move |event, client| {
                    let app_handle = app_handle_clone.clone();
                    let state = state_clone.clone();
                    async move {
                        match event {
                            Event::PairingQrCode { code, .. } => {
                                *state.whatsapp_manager.status.lock().await = "qr".to_string();
                                let _ = app_handle.emit("whatsapp-status", "qr");
                                if let Ok(png) = qrcode_generator::to_png_to_vec(&code, QrCodeEcc::Low, 256) {
                                    let b64 = general_purpose::STANDARD.encode(png);
                                    let qr_data = format!("data:image/png;base64,{}", b64);
                                    *state.whatsapp_manager.qr_code.lock().await = Some(qr_data.clone());
                                    let _ = app_handle.emit("whatsapp-qr", qr_data);
                                }
                            }
                            Event::Connected(_) => {
                                *state.whatsapp_manager.status.lock().await = "connected".to_string();
                                *state.whatsapp_manager.qr_code.lock().await = None;
                                let _ = app_handle.emit("whatsapp-status", "connected");

                                {
                                    let mut config_guard = state.config.lock().await;
                                    config_guard.whatsapp_enabled = true;
                                    let _ = save_config(&config_guard);
                                }
                            }
                            Event::Disconnected(_) => {
                                let mut status_guard = state.whatsapp_manager.status.lock().await;
                                if *status_guard != "idle" {
                                    *status_guard = "connecting".to_string();
                                    let _ = app_handle.emit("whatsapp-status", "connecting");
                                }
                            }
                            Event::LoggedOut(_) => {
                                *state.whatsapp_manager.status.lock().await = "idle".to_string();
                                *state.whatsapp_manager.qr_code.lock().await = None;
                                let _ = app_handle.emit("whatsapp-status", "idle");
                                let _ = app_handle.emit("whatsapp-qr", Option::<String>::None);
                            }
                            Event::Message(msg, info) => {
                                let _ = app_handle.emit("app-log", serde_json::json!({
                                    "level": "debug",
                                    "message": format!("[WHATSAPP] Received event from {}", info.source.sender.user)
                                }));

                                if info.source.chat.server.as_str() == "g.us" {
                                    let _ = app_handle.emit("app-log", serde_json::json!({
                                        "level": "debug",
                                        "message": "[WHATSAPP] Skipping: Group messages are ignored."
                                    }));
                                    return;
                                }

                                let whatsapp_enabled = {
                                    let config_guard = state.config.lock().await;
                                    config_guard.whatsapp_enabled
                                };
                                if !whatsapp_enabled {
                                    let _ = app_handle.emit("app-log", serde_json::json!({
                                        "level": "debug",
                                        "message": "[WHATSAPP] Skipping: WhatsApp auto-reply is disabled in settings."
                                    }));
                                    return;
                                }

                                if info.source.is_from_me {
                                    return;
                                }

                                let now = chrono::Utc::now();
                                let age = now.signed_duration_since(info.timestamp);
                                if age > chrono::Duration::seconds(60) {
                                    let _ = app_handle.emit("app-log", serde_json::json!({
                                        "level": "debug",
                                        "message": format!("[WHATSAPP] Skipping: Message is too old ({}s)", age.num_seconds())
                                    }));
                                    return;
                                }

                                let sender_jid = info.source.sender.clone();
                                let sender_user = sender_jid.user.clone();

                                let text = if let Some(c) = msg.conversation {
                                    c
                                } else if let Some(ext) = msg.extended_text_message {
                                    ext.text.unwrap_or_default()
                                } else {
                                    String::new()
                                };

                                if text.is_empty() {
                                    let _ = app_handle.emit("app-log", serde_json::json!({
                                        "level": "debug",
                                        "message": "[WHATSAPP] Skipping: Empty message text."
                                    }));
                                    return;
                                }

                                let _ = app_handle.emit("app-log", serde_json::json!({
                                    "level": "debug",
                                    "message": format!("[WHATSAPP] Received message text: '{}'", text)
                                }));

                                {
                                    let mut config = state.config.lock().await;
                                    let jid_str = info.source.chat.to_string();
                                    let push_name = if info.push_name.is_empty() {
                                        None
                                    } else {
                                        Some(info.push_name.clone())
                                    };

                                    // Remove existing entry for this JID if it exists
                                    config.whatsapp_recent_chats.retain(|rc| rc.jid != jid_str);

                                    // Add new entry at the beginning
                                    config.whatsapp_recent_chats.insert(
                                        0,
                                        RecentChat {
                                            jid: jid_str,
                                            push_name,
                                            last_message: text.clone(),
                                            timestamp: info.timestamp.to_rfc3339(),
                                        },
                                    );

                                    // Limit to 50 recent chats
                                    if config.whatsapp_recent_chats.len() > 50 {
                                        config.whatsapp_recent_chats.truncate(50);
                                    }

                                    let _ = save_config(&config);
                                    let _ = app_handle.emit("whatsapp-recent-chats-updated", ());
                                }

                                let contacts = {
                                    let config_guard = state.config.lock().await;
                                    config_guard.whatsapp_contacts.clone()
                                };

                                let sender_cleaned = clean_number(&sender_user);
                                let chat_user = info.source.chat.user.clone();
                                let chat_cleaned = clean_number(&chat_user);

                                let sender_alt_user = info.source.sender_alt.as_ref().map(|j| clean_number(&j.user));
                                let recipient_alt_user = info.source.recipient_alt.as_ref().map(|j| clean_number(&j.user));

                                let matching_contact = contacts.iter().find(|c| {
                                    let allowed = clean_number(&c.number);
                                    sender_cleaned == allowed
                                        || chat_cleaned == allowed
                                        || sender_cleaned.contains(&allowed)
                                        || chat_cleaned.contains(&allowed)
                                        || allowed.contains(&sender_cleaned)
                                        || allowed.contains(&chat_cleaned)
                                        || sender_alt_user.as_ref().is_some_and(|n| n == &allowed || n.contains(&allowed) || allowed.contains(n))
                                        || recipient_alt_user.as_ref().is_some_and(|n| n == &allowed || n.contains(&allowed) || allowed.contains(n))
                                        // Also match by WhatsApp display name (push_name) for name-based fuzzy matching
                                        || (!info.push_name.is_empty() && {
                                            let pn = info.push_name.to_lowercase();
                                            let cn = c.name.to_lowercase();
                                            cn == pn || cn.contains(&pn) || pn.contains(&cn)
                                        })
                                });

                                let mut is_allowed = matching_contact.is_some_and(|c| c.auto_reply_enabled);
                                let mut auto_add_number: Option<String> = None;

                                if !is_allowed
                                    && (info.source.sender.server.as_str() == "lid"
                                        || info.source.chat.server.as_str() == "lid")
                                {
                                    let sender_resolved = resolve_phone_number_for_jid(&client, &sender_jid).await;
                                    let chat_resolved = if info.source.chat != sender_jid {
                                        resolve_phone_number_for_jid(&client, &info.source.chat).await
                                    } else {
                                        None
                                    };

                                    let resolved_matching_contact = contacts.iter().find(|c| {
                                        let allowed = clean_number(&c.number);
                                        sender_resolved.as_ref().is_some_and(|n| {
                                            n == &allowed || n.contains(&allowed) || allowed.contains(n)
                                        }) || chat_resolved.as_ref().is_some_and(|n| {
                                            n == &allowed || n.contains(&allowed) || allowed.contains(n)
                                        })
                                    });

                                    if let Some(resolved_contact) = resolved_matching_contact {
                                        is_allowed = resolved_contact.auto_reply_enabled;
                                    } else if let Some(ref resolved_num) = sender_resolved {
                                        auto_add_number = Some(resolved_num.clone());
                                    } else if matching_contact.is_none() {
                                        // LID resolution failed — fall back to sender's JID user part
                                        auto_add_number = Some(sender_cleaned.clone());
                                    }
                                } else if matching_contact.is_none() {
                                    // Not a LID contact and no match found — prepare to auto-add
                                    auto_add_number = Some(sender_cleaned.clone());
                                }

                                // Auto-add unknown senders to the allowed contacts list with auto-reply disabled
                                if let Some(ref number) = auto_add_number {
                                    let mut config = state.config.lock().await;
                                    if !config.whatsapp_contacts.iter().any(|c| clean_number(&c.number) == *number) {
                                        let contact_name = if info.push_name.is_empty() {
                                            number.clone()
                                        } else {
                                            info.push_name.clone()
                                        };
                                        let display_name = contact_name.clone();
                                        config.whatsapp_contacts.push(WhatsAppContact {
                                            name: contact_name,
                                            number: number.clone(),
                                            auto_reply_enabled: false,
                                        });
                                        let _ = save_config(&config);
                                    let _ = app_handle.emit("app-log", serde_json::json!({
                                        "level": "info",
                                        "message": format!("[WHATSAPP] Auto-added {} ({}) to allowed contacts.", display_name, number)
                                    }));
                                    let _ = app_handle.emit("whatsapp-contacts-updated", ());
                                }
                            }

                            // Update existing contacts' names with WhatsApp push name if it has changed
                                if !info.push_name.is_empty() {
                                    if let Some(contact) = matching_contact {
                                        if contact.name != info.push_name {
                                            let mut config = state.config.lock().await;
                                            let push_name = info.push_name.clone();
                                            if let Some(idx) = config.whatsapp_contacts.iter().position(|c| c.number == contact.number) {
                                                config.whatsapp_contacts[idx].name = push_name.clone();
                                            }
                                            let _ = save_config(&config);
                                            let _ = app_handle.emit("app-log", serde_json::json!({
                                                "level": "info",
                                                "message": format!("[WHATSAPP] Updated contact name: '{}' -> '{}'", contact.name, push_name)
                                            }));
                                            let _ = app_handle.emit("whatsapp-contacts-updated", ());
                                        }
                                    }
                                }

                                if is_allowed {
                                    let client_clone = client.clone();
                                    let text_clone = text.clone();
                                    let state_clone = Arc::clone(&state);
                                    let contact_name = matching_contact.map(|c| c.name.clone());
                                    let app_handle_inner = app_handle.clone();

                                    // For LIDs, we often need to reply to the sender JID directly
                                    // if the chat JID is not delivering.
                                    let mut target_jid = if info.source.sender.server.as_str() == "lid" {
                                        info.source.sender.clone()
                                    } else {
                                        info.source.chat.clone()
                                    };

                                    // Try to resolve LID to Phone Number JID for much better delivery reliability
                                    if target_jid.server.as_str() == "lid" {
                                        if let Some(ref alt_jid) = info.source.sender_alt {
                                            if alt_jid.server.as_str() != "lid" {
                                                let _ = app_handle.emit("app-log", serde_json::json!({
                                                    "level": "debug",
                                                    "message": format!("[WHATSAPP] Resolved LID {} to PN JID {} via sender_alt", target_jid.to_string(), alt_jid.to_string())
                                                }));
                                                target_jid = alt_jid.clone();
                                            }
                                        }
                                    }

                                    if target_jid.server.as_str() == "lid" {
                                        if let Some(pn) = client.get_phone_number_from_lid(&target_jid.user).await {
                                            if let Ok(pn_jid) = format!("{}@{}", pn, SERVER_JID).parse::<Jid>() {
                                                let _ = app_handle.emit("app-log", serde_json::json!({
                                                    "level": "debug",
                                                    "message": format!("[WHATSAPP] Resolved LID {} to PN JID {} via local cache lookup", target_jid.to_string(), pn_jid.to_string())
                                                }));
                                                target_jid = pn_jid;
                                            }
                                        }
                                    }

                                    if target_jid.server.as_str() == "lid" {
                                        if let Some(pn) = resolve_phone_number_for_jid(&client, &target_jid).await {
                                            if let Ok(pn_jid) = format!("{}@{}", pn, SERVER_JID).parse::<Jid>() {
                                                let _ = app_handle.emit("app-log", serde_json::json!({
                                                    "level": "debug",
                                                    "message": format!("[WHATSAPP] Resolved LID {} to PN JID {} via network usync fallback", target_jid.to_string(), pn_jid.to_string())
                                                }));
                                                target_jid = pn_jid;
                                            }
                                        }
                                    }

                                    let _ = app_handle.emit("app-log", serde_json::json!({
                                        "level": "info",
                                        "message": format!("[WHATSAPP] Generating auto-reply for {} (JID: {})...", contact_name.as_deref().unwrap_or(&sender_user), target_jid.to_string())
                                    }));
                                    tokio::spawn(async move {
                                        let reply_text = generate_reply(&app_handle_inner, &state_clone, text_clone, contact_name.as_deref()).await;

                                        // Simulate a small delay for "thinking" and to avoid immediate bot detection
                                        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

                                        let mut reply_msg = WaMessage::default();
                                        reply_msg.conversation = Some(reply_text.clone());

                                        match tokio::time::timeout(
                                            std::time::Duration::from_secs(30),
                                            client_clone.send_message(target_jid.clone(), reply_msg),
                                        ).await {
                                            Ok(Ok(_)) => {
                                                let _ = app_handle_inner.emit("app-log", serde_json::json!({
                                                    "level": "info",
                                                    "message": format!("[WHATSAPP] Auto-reply successfully sent to {}.", target_jid.to_string())
                                                }));
                                            }
                                            Ok(Err(e)) => {
                                                let _ = app_handle_inner.emit("app-log", serde_json::json!({
                                                    "level": "error",
                                                    "message": format!("[WHATSAPP] Failed to send reply to {}: {:?}", target_jid.to_string(), e)
                                                }));
                                            }
                                            Err(_) => {
                                                let _ = app_handle_inner.emit("app-log", serde_json::json!({
                                                    "level": "error",
                                                    "message": format!("[WHATSAPP] Timeout sending reply to {}.", target_jid.to_string())
                                                }));
                                            }
                                        }
                                    });
                                }
 else {
                                    let _ = app_handle.emit("app-log", serde_json::json!({
                                        "level": "debug",
                                        "message": format!("[WHATSAPP] Ignoring message from {}: Auto-reply not enabled or contact not in list.", sender_user)
                                    }));
                                }
                            }
                            _ => {}
                        }
                    }
                })
                .build()
                .await;

            match bot_result {
                Ok(bot) => {
                    let join_handle = {
                        let mut bot_guard = manager.bot.lock().await;
                        *bot_guard = Some(bot);
                        let bot = bot_guard.as_mut().unwrap();

                        // NOTE: Do NOT emit "connected" here. The bot has been built
                        // but has NOT connected yet. Real connected/qr status comes from
                        // Event::Connected and Event::PairingQrCode in the event handler.
                        match bot.run().await {
                            Ok(handle) => Some(handle),
                            Err(_) => None,
                        }
                    };

                    // Store the bot's internal event loop JoinHandle so
                    // stop_whatsapp_runtime can abort it directly.
                    if let Some(jh) = join_handle {
                        *manager.bot_event_handle.lock().await = Some(jh);
                    }

                    // Wait for the event handle to complete (or be aborted externally).
                    // We poll via taking the handle; if it was already aborted/taken by
                    // stop_whatsapp_runtime, this falls through immediately.
                    let event_handle = manager.bot_event_handle.lock().await.take();
                    if let Some(h) = event_handle {
                        let _ = h.await;
                    }
                }
                Err(_) => {}
            }

            {
                let status = manager.status.lock().await;
                if *status == "idle" {
                    break;
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }

        *manager.bot.lock().await = None;
        *manager.bot_event_handle.lock().await = None;
        *manager.status.lock().await = "idle".to_string();
        *manager.qr_code.lock().await = None;
        *manager.runtime_task.lock().await = None;
    });
    *state.whatsapp_manager.runtime_task.lock().await = Some(runtime_handle);

    Ok(())
}

#[tauri::command]
pub async fn start_whatsapp_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    internal_start_whatsapp_session(app_handle, Arc::new(state.inner().clone())).await
}

#[tauri::command]
pub async fn get_whatsapp_status(
    state: State<'_, AppState>,
) -> Result<(String, Option<String>), String> {
    let status = state.whatsapp_manager.status.lock().await;
    let qr = state.whatsapp_manager.qr_code.lock().await;
    Ok((status.clone(), qr.clone()))
}

#[tauri::command]
pub async fn get_recent_chats(state: State<'_, AppState>) -> Result<Vec<RecentChat>, String> {
    let config = state.config.lock().await;
    Ok(config.whatsapp_recent_chats.clone())
}

#[tauri::command]
pub async fn toggle_whatsapp(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.whatsapp_enabled = enabled;
    save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn logout_whatsapp(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // --- Phase 1: Stop and clean up, holding the op lock ---
    {
        let _op_guard = state.whatsapp_manager.session_op_lock.lock().await;

        // stop_whatsapp_runtime:
        //  - disconnect (unconditional, works in QR state)
        //  - abort bot_event_handle (wa_rs internal task)
        //  - drop bot
        //  - abort runtime_task
        stop_whatsapp_runtime(state.inner()).await;

        *state.whatsapp_manager.qr_code.lock().await = None;
        let _ = app_handle.emit("whatsapp-status", "idle");
        let _ = app_handle.emit("whatsapp-qr", None::<String>);

        // Update config — disable WhatsApp so auto-start won't re-trigger
        {
            let mut config_guard = state.config.lock().await;
            config_guard.whatsapp_enabled = false;
            config_guard.whatsapp_recent_chats.clear();
            save_config(&config_guard)?;
        }
        let _ = app_handle.emit("whatsapp-recent-chats-updated", ());
    } // <-- session_op_lock is dropped here

    // --- Phase 2: Clear DB in-place (works even if file is still locked) ---
    // rusqlite opens the same SQLite file concurrently via WAL, deletes all rows
    // from every table, and checkpoints. The next wa_rs session will find no
    // credentials and generate a fresh QR code.
    clear_whatsapp_db().await;

    // --- Phase 3: Start a fresh session for new QR code ---
    // internal_start_whatsapp_session acquires session_op_lock internally
    internal_start_whatsapp_session(app_handle, Arc::new(state.inner().clone())).await?;

    Ok(())
}

#[tauri::command]
pub async fn add_whatsapp_contact(
    app_handle: AppHandle,
    name: String,
    number: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    let cleaned_number = clean_number(&number);
    let name_trimmed = name.trim().to_string();

    config.whatsapp_contacts.retain(|c| {
        c.name.to_lowercase() != name_trimmed.to_lowercase() && c.number != cleaned_number
    });

    config.whatsapp_contacts.push(WhatsAppContact {
        name: name_trimmed,
        number: cleaned_number,
        auto_reply_enabled: true,
    });

    save_config(&config)?;
    let _ = app_handle.emit("whatsapp-contacts-updated", ());
    Ok(())
}

#[tauri::command]
pub async fn set_whatsapp_contact_auto_reply(
    app_handle: AppHandle,
    name: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    internal_set_whatsapp_contact_auto_reply(&app_handle, name, enabled, state.inner())
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn set_whatsapp_auto_reply(
    app_handle: AppHandle,
    recipient: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    internal_set_whatsapp_contact_auto_reply(&app_handle, recipient, enabled, state.inner()).await
}

#[tauri::command]
pub async fn toggle_whatsapp_auto_reply(
    app_handle: AppHandle,
    recipient: String,
    state: State<'_, AppState>,
) -> Result<(String, bool), String> {
    internal_toggle_whatsapp_contact_auto_reply(&app_handle, recipient, state.inner()).await
}

#[tauri::command]
pub async fn remove_whatsapp_contact(
    app_handle: AppHandle,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    let name_trimmed = name.trim().to_lowercase();

    let before = config.whatsapp_contacts.len();
    config
        .whatsapp_contacts
        .retain(|c| c.name.to_lowercase() != name_trimmed);

    if config.whatsapp_contacts.len() < before {
        save_config(&config)?;
        let _ = app_handle.emit("whatsapp-contacts-updated", ());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_whatsapp_contacts(
    state: State<'_, AppState>,
) -> Result<Vec<WhatsAppContact>, String> {
    let config = state.config.lock().await;
    Ok(config.whatsapp_contacts.clone())
}

pub async fn internal_send_whatsapp_message(
    recipient: String,
    message: String,
    state: &AppState,
) -> Result<(), String> {
    let config = state.config.lock().await;
    let cleaned_recipient = clean_number(&recipient);

    // 1. Resolve target number
    let target_number = if !cleaned_recipient.is_empty() {
        cleaned_recipient
    } else {
        let recipient_lower = recipient.to_lowercase();
        config
            .whatsapp_contacts
            .iter()
            .find(|c| {
                let name_lower = c.name.to_lowercase();
                name_lower == recipient_lower
                    || name_lower.contains(&recipient_lower)
                    || recipient_lower.contains(&name_lower)
            })
            .map(|c| c.number.clone())
            .ok_or_else(|| format!("Contact '{}' not found.", recipient))?
    };

    // 2. Check if allowed
    let is_allowed = config.whatsapp_contacts.iter().any(|c| {
        let cn = clean_number(&c.number);
        cn == target_number || target_number.contains(&cn) || cn.contains(&target_number)
    });

    if !is_allowed {
        return Err(format!(
            "Number {} is not in the allowed list. Please add it in settings.",
            target_number
        ));
    }

    // 3. Resolve the correct JID - try recent chats first (they have the full JID with correct server),
    //    then fall back to constructing from the number.
    let recipient_lower = recipient.to_lowercase();
    let jid_from_chats = config
        .whatsapp_recent_chats
        .iter()
        .filter(|rc| !rc.jid.contains("@g.us"))
        .find(|rc| {
            let rc_number = clean_number(&rc.jid);
            let name_matches = rc.push_name.as_ref().is_some_and(|pn| {
                let pn_lower = pn.to_lowercase();
                pn_lower == recipient_lower
                    || pn_lower.contains(&recipient_lower)
                    || recipient_lower.contains(&pn_lower)
            });

            rc_number == target_number || name_matches
        })
        .map(|rc| rc.jid.clone());

    drop(config);

    let client = get_current_client(state)
        .await
        .ok_or("WhatsApp is not connected.")?;

    let mut jid = if let Some(jid_str) = jid_from_chats {
        jid_str
            .parse::<Jid>()
            .map_err(|e| format!("Invalid JID from recent chats: {}", e))?
    } else if target_number.len() > 12 {
        // Likely a LID (WhatsApp internal ID, not a phone number) — try lid server
        format!("{}@lid", target_number)
            .parse::<Jid>()
            .map_err(|e| format!("Invalid LID format: {}", e))?
    } else {
        format!("{}@{}", target_number, SERVER_JID)
            .parse::<Jid>()
            .map_err(|e| format!("Invalid number format: {}", e))?
    };

    // Try to resolve LID to Phone Number JID for better delivery
    if jid.server.as_str() == "lid" {
        if let Some(pn) = client.get_phone_number_from_lid(&jid.user).await {
            if let Ok(pn_jid) = format!("{}@{}", pn, SERVER_JID).parse::<Jid>() {
                jid = pn_jid;
            }
        }
    }

    if jid.server.as_str() == "lid" {
        if let Some(pn) = resolve_phone_number_for_jid(&client, &jid).await {
            if let Ok(pn_jid) = format!("{}@{}", pn, SERVER_JID).parse::<Jid>() {
                jid = pn_jid;
            }
        }
    }

    let mut wa_msg = WaMessage::default();
    wa_msg.conversation = Some(message);

    client
        .send_message(jid, wa_msg)
        .await
        .map_err(|e| format!("Failed to send message: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn send_whatsapp_message(
    recipient: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    internal_send_whatsapp_message(recipient, message, state.inner()).await
}

pub async fn internal_set_whatsapp_contact_auto_reply(
    app_handle: &AppHandle,
    recipient: String,
    enabled: bool,
    state: &AppState,
) -> Result<String, String> {
    let mut config = state.config.lock().await;
    let cleaned_recipient = clean_number(&recipient);

    println!("[WHATSAPP DEBUG] set auto-reply lookup for: '{}', cleaned: '{}', enabled: {}", recipient, cleaned_recipient, enabled);
    println!("[WHATSAPP DEBUG] contacts in config: {:?}", config.whatsapp_contacts.iter().map(|c| format!("name={}, number={}", c.name, c.number)).collect::<Vec<_>>());

    let contact = if !cleaned_recipient.is_empty() {
        config.whatsapp_contacts.iter_mut().find(|c| {
            let cn = clean_number(&c.number);
            !cn.is_empty() && (
                cn == cleaned_recipient
                    || cleaned_recipient.contains(&cn)
                    || cn.contains(&cleaned_recipient)
            )
        })
    } else {
        let recipient_norm = normalize_name(&recipient);
        let recipient_key = normalize_key(&recipient);
        config.whatsapp_contacts.iter_mut().find(|c| {
            let name_norm = normalize_name(&c.name);
            let name_key = normalize_key(&c.name);
            !name_norm.is_empty() && (
                name_norm == recipient_norm
                    || name_norm.contains(&recipient_norm)
                    || recipient_norm.contains(&name_norm)
                    || (!name_key.is_empty()
                        && (name_key == recipient_key
                            || name_key.contains(&recipient_key)
                            || recipient_key.contains(&name_key)))
            )
        })
    };

    if let Some(contact) = contact {
        contact.auto_reply_enabled = enabled;
        let actual_name = contact.name.clone();
        save_config(&config)?;
        let _ = app_handle.emit("whatsapp-contacts-updated", ());
        Ok(actual_name)
    } else {
        Err(format!("Contact '{}' not found.", recipient))
    }
}

pub async fn internal_toggle_whatsapp_contact_auto_reply(
    app_handle: &AppHandle,
    recipient: String,
    state: &AppState,
) -> Result<(String, bool), String> {
    let mut config = state.config.lock().await;
    let cleaned_recipient = clean_number(&recipient);

    println!("[WHATSAPP DEBUG] toggle auto-reply lookup for: '{}', cleaned: '{}'", recipient, cleaned_recipient);
    println!("[WHATSAPP DEBUG] contacts in config: {:?}", config.whatsapp_contacts.iter().map(|c| format!("name={}, number={}", c.name, c.number)).collect::<Vec<_>>());

    let contact = if !cleaned_recipient.is_empty() {
        let contact = config.whatsapp_contacts.iter_mut().find(|c| {
            let cn = clean_number(&c.number);
            !cn.is_empty() && (
                cn == cleaned_recipient
                    || cleaned_recipient.contains(&cn)
                    || cn.contains(&cleaned_recipient)
            )
        });
        if contact.is_none() {
            println!("[WHATSAPP DEBUG] toggle auto-reply number match failed for cleaned='{}'", cleaned_recipient);
        }
        contact
    } else {
        let recipient_norm = normalize_name(&recipient);
        let recipient_key = normalize_key(&recipient);
        let contact = config.whatsapp_contacts.iter_mut().find(|c| {
            let name_norm = normalize_name(&c.name);
            let name_key = normalize_key(&c.name);
            !name_norm.is_empty() && (
                name_norm == recipient_norm
                    || name_norm.contains(&recipient_norm)
                    || recipient_norm.contains(&name_norm)
                    || (!name_key.is_empty()
                        && (name_key == recipient_key
                            || name_key.contains(&recipient_key)
                            || recipient_key.contains(&name_key)))
            )
        });
        if contact.is_none() {
            println!("[WHATSAPP DEBUG] toggle auto-reply name match failed for recipient='{}', norm='{}', key='{}'", recipient, recipient_norm, recipient_key);
        }
        contact
    };

    if let Some(contact) = contact {
        contact.auto_reply_enabled = !contact.auto_reply_enabled;
        let actual_name = contact.name.clone();
        let new_state = contact.auto_reply_enabled;
        save_config(&config)?;
        let _ = app_handle.emit("whatsapp-contacts-updated", ());
        Ok((actual_name, new_state))
    } else {
        Err(format!("Contact '{}' not found.", recipient))
    }
}

