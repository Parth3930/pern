pub mod automations;
pub mod chat;
pub mod chat_prompt;
pub mod commands;
pub mod integrations;
pub mod learner;
pub mod memory;
pub mod memory_graph;
pub mod model;
pub mod notifications;
pub mod skills;
pub mod state;
pub mod storage;
pub mod tools;
pub mod tools_data;

use chat::{ChatMessage, ChatRequest, OpenAIStreamChunk};
use futures_util::StreamExt;
use reqwest::Client;
use state::AppState;
use std::sync::Arc;
use storage::load_config;
#[cfg(not(target_os = "android"))]
use tauri::image::Image;
#[cfg(not(target_os = "android"))]
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

#[tauri::command]
async fn submit_external_reply(
    request_id: String,
    reply: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut map = state.pending_external_replies.lock().await;
    if let Some(tx) = map.remove(&request_id) {
        let _ = tx.send(reply);
        Ok(())
    } else {
        Err("Request ID not found or already timed out".to_string())
    }
}

#[tauri::command]
async fn send_chat_message(
    model_id: String,
    messages: Vec<ChatMessage>,
    tools: Option<serde_json::Value>,
    window: tauri::Window,
) -> Result<(), String> {
    let msg_count = messages.len();
    let total_chars: usize = messages.iter().map(|m| m.content.len()).sum();
    println!("[CHAT][DIAG] Command received: model={}, messages={}, total_chars={}, est_tokens={}", model_id, msg_count, total_chars, total_chars / 4);
    println!("[CHAT][DIAG] Message roles: {:?}", messages.iter().map(|m| m.role.as_str()).collect::<Vec<_>>());
    if let Some(sys) = messages.first() {
        println!("[CHAT][DIAG] System prompt length: {} chars, preview: {}...", sys.content.len(), &sys.content[..sys.content.len().min(150)]);
        let text_tools: Vec<&str> = sys.content.lines().filter(|l| l.starts_with("- ") && l.contains("->")).collect();
        if !text_tools.is_empty() {
            println!("[CHAT][DIAG] Injected tools: {:?}", text_tools.iter().map(|t| t.split("(").next().unwrap_or("").trim_start_matches("- ")).collect::<Vec<_>>());
        }
    }
    if let Some(usr) = messages.iter().find(|m| m.role == "user") {
        println!("[CHAT][DIAG] User message: {}", usr.content);
    }
    let client = Client::new();
    let req_body = ChatRequest {
        model: "local".to_string(),
        messages,
        temperature: 0.7,
        stream: true,
        max_tokens: None,
        stop: None,
        tools,
    };

    let mut attempts = 0;
    let max_attempts = 45; // Wait up to 90 seconds
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
                        let err_text = response
                            .text()
                            .await
                            .unwrap_or_else(|_| "Unknown error".to_string());
                        println!(
                            "[CHAT] ERROR: Server still loading model after max retries. {}",
                            err_text
                        );
                        return Err(format!("Server Error: {}", err_text));
                    }
                    println!(
                        "[CHAT] Server is loading model (attempt {}/{}), retrying in 2 seconds...",
                        attempts, max_attempts
                    );
                    let _ = window.emit("app-log", serde_json::json!({
                        "level": "info",
                        "message": format!("AI model is loading into memory (attempt {}/{}), please wait...", attempts, max_attempts)
                    }));
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }

                if !status.is_success() {
                    let err_text = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "Unknown error".to_string());
                    println!("[CHAT] ERROR: Server returned {}", err_text);
                    return Err(format!("Server Error: {}", err_text));
                }

                res = response;
                break;
            }
            Err(e) => {
                attempts += 1;
                if attempts >= max_attempts {
                    let msg = format!("Failed to connect to local AI server: {}", e);
                    println!("[CHAT] ERROR: {}", msg);
                    return Err(msg);
                }
                println!(
                    "[CHAT] Connection failed (attempt {}/{}), retrying in 2 seconds... Error: {}",
                    attempts, max_attempts, e
                );
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }

    println!("[CHAT][DIAG] Response received, status={}, starting SSE stream", res.status());
    let mut stream = res.bytes_stream();
    let mut buffer = Vec::new();
    let mut done = false;
    let mut bot_response = String::new();
    let mut accumulated_tools: std::collections::BTreeMap<usize, (String, String)> = std::collections::BTreeMap::new();

    while let Some(chunk_res) = stream.next().await {
        if done {
            break;
        }
        match chunk_res {
            Ok(chunk) => {
                buffer.extend_from_slice(&chunk);

                // parse only complete lines using rposition, keep rest in buffer
                if let Some(pos) = buffer.iter().rposition(|&b| b == b'\n') {
                    let (ready, rest) = buffer.split_at(pos + 1);
                    let ready_str = String::from_utf8_lossy(ready);
                    for line in ready_str.lines().map(|l| l.trim()).filter(|l| l.starts_with("data: ")) {
                        let data = &line[6..];
                        if data == "[DONE]" {
                            done = true;
                            break;
                        }
                        if let Ok(res) = serde_json::from_str::<OpenAIStreamChunk>(data) {
                            if let Some(c) = res.choices.first() {
                                if let Some(content) = &c.delta.content {
                                    bot_response.push_str(content);
                                    let _ = window.emit("chat-token", content);
                                }
                                if let Some(tcs) = &c.delta.tool_calls {
                                    for tc in tcs {
                                        let entry = accumulated_tools.entry(tc.index).or_insert_with(|| (String::new(), String::new()));
                                        if let Some(f) = &tc.function {
                                            if let Some(name) = &f.name {
                                                entry.0.push_str(name);
                                            }
                                            if let Some(args) = &f.arguments {
                                                entry.1.push_str(args);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    buffer = rest.to_vec();
                }
            }
            Err(e) => {
                println!("[CHAT] Stream error: {}", e);
                break;
            }
        }
    }

    if !accumulated_tools.is_empty() {
        if !bot_response.ends_with('\n') && !bot_response.is_empty() {
            bot_response.push('\n');
            let _ = window.emit("chat-token", "\n");
        }
        for (_, (name, args)) in accumulated_tools {
            let mut formatted_args = String::new();
            if let Ok(parsed_args) = serde_json::from_str::<serde_json::Value>(&args) {
                if let Some(obj) = parsed_args.as_object() {
                    let mut pairs = Vec::new();
                    for (k, v) in obj {
                        let v_str = if v.is_string() {
                            format!("\"{}\"", v.as_str().unwrap().replace("\"", "\\\""))
                        } else {
                            v.to_string()
                        };
                        pairs.push(format!("{}={}", k, v_str));
                    }
                    formatted_args = pairs.join(", ");
                }
            } else {
                formatted_args = args;
            }
            let line = format!("- {}({})\n", name, formatted_args);
            bot_response.push_str(&line);
            let _ = window.emit("chat-token", &line);
        }
    }

    println!("[CHAT][DIAG] Emitting chat-complete. Bot answered: {}", bot_response);
    let _ = window.emit("chat-complete", ());
    println!("[CHAT][DIAG] Command finished OK");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = load_config();
    let app_state = AppState::new(config);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = app.state::<AppState>().inner().clone();
            let app_handle = app.handle().clone();

            // Clear any debug autostart entry from registry on startup to prevent unwanted boot-time launch in debug mode
            #[cfg(all(target_os = "windows", debug_assertions))]
            {
                println!("[AUTOSTART] Running in debug/dev mode. Cleaning up any autostart registry entries to prevent unwanted autostart...");
                use std::os::windows::process::CommandExt;
                let mut cmd = std::process::Command::new("reg");
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                let _ = cmd
                    .args(&[
                        "delete",
                        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                        "/v",
                        "Pern",
                        "/f",
                    ])
                    .output();
            }

            // Auto-start WhatsApp session if it was previously enabled
            let whatsapp_enabled = {
                let config = tauri::async_runtime::block_on(async {
                    state.config.lock().await.whatsapp_enabled
                });
                config
            };

            if whatsapp_enabled {
                println!("[WHATSAPP] Auto-connecting on startup...");
                let state_clone = Arc::new(state.clone());
                let app_handle_for_wa = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) =
                        integrations::whatsapp::internal_start_whatsapp_session(app_handle_for_wa, state_clone).await
                    {
                        println!("[WHATSAPP] Failed to auto-connect on startup: {}", e);
                    }
                });
            }

            // Auto-start Discord session if it was previously enabled
            let discord_enabled = {
                let config = tauri::async_runtime::block_on(async {
                    state.config.lock().await.discord_enabled
                });
                config
            };

            if discord_enabled {
                println!("[DISCORD] Auto-connecting on startup...");
                let state_clone = Arc::new(state.clone());
                let app_handle_clone = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) =
                        integrations::discord::internal_start_discord_session(app_handle_clone, state_clone).await
                    {
                        println!("[DISCORD] Failed to auto-connect on startup: {}", e);
                    }
                });
            }

            // Start periodic CLI agent monitoring
            let cli_mgr = state.cli_agent_manager.clone();
            let app_handle_for_cli = app_handle.clone();
            let state_for_cli = state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    cli_mgr.reap_finished(app_handle_for_cli.clone(), state_for_cli.clone()).await;
                }
            });

            // Start the automation scheduler. The loop wakes every 30s,
            // evaluates triggers, fires due automations, writes run records,
            // and emits `automation_fired` events. The manager dedupes by
            // `(automation_id, trigger_window)` so multiple ticks inside the
            // same window never double-fire.
            let automation_mgr = state.automation_manager.clone();
            let state_for_scheduler = Arc::new(state.clone());
            let app_handle_for_scheduler = app_handle.clone();
            automations::scheduler::spawn(
                automation_mgr,
                state_for_scheduler,
                app_handle_for_scheduler,
            );

            // Desktop-only features: window positioning, system tray, rounded corners
            #[cfg(not(target_os = "android"))]
            {
                let window = app.get_webview_window("main").unwrap();

                // Position the window in the bottom right corner
                if let Some(monitor) = window.current_monitor().unwrap() {
                    let screen_size = monitor.size();
                    let window_size = window.outer_size().unwrap();

                    let x = screen_size.width as f64 - window_size.width as f64 - 20.0;
                    let y = screen_size.height as f64 - window_size.height as f64 - 60.0;

                    let _ =
                        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                            x: x as i32,
                            y: y as i32,
                        }));
                }

                // Setup System Tray with custom logo
                let icon_bytes = include_bytes!("../../src/assets/logo.png");
                let img = image::load_from_memory(icon_bytes)
                    .map_err(|e| {
                        tauri::Error::from(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            e.to_string(),
                        ))
                    })?
                    .to_rgba8();
                let (width, height) = img.dimensions();
                let icon = Image::new_owned(img.into_raw(), width, height);

                let _tray = TrayIconBuilder::new()
                    .icon(icon)
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::model::get_onboarding_state,
            commands::model::update_user_memory,
            commands::model::get_user_memory,
            commands::model::list_available_models,
            commands::model::list_installed_models,
            commands::model::delete_model,
            commands::model::choose_model,
            commands::model::choose_model_dir,
            commands::model::set_first_run_completed,
            commands::model::download_model,
            commands::model::start_llama_server,
            commands::model::llama_server_health,
            commands::system::launch_app,
            commands::system::close_app,
            commands::system::restart_system,
            commands::system::shutdown_system,
            commands::email::send_email,
            commands::email::save_email_config,
            commands::model::check_llama_installed,
            commands::model::install_llama_server,
            commands::model::get_platform_info,
            commands::model::request_android_notification_permission,
            integrations::whatsapp::start_whatsapp_session,
            integrations::whatsapp::get_whatsapp_status,
            integrations::whatsapp::get_recent_chats,
            integrations::whatsapp::toggle_whatsapp,
            integrations::whatsapp::logout_whatsapp,
            integrations::whatsapp::add_whatsapp_contact,
            integrations::whatsapp::set_whatsapp_contact_auto_reply,
            integrations::whatsapp::set_whatsapp_auto_reply,
            integrations::whatsapp::toggle_whatsapp_auto_reply,
            integrations::whatsapp::remove_whatsapp_contact,
            integrations::whatsapp::get_whatsapp_contacts,
            integrations::whatsapp::send_whatsapp_message,
            integrations::discord::discord_test_token,
            integrations::discord::toggle_discord,
            integrations::discord::get_discord_status,
            integrations::discord::discord_get_guilds,
            integrations::discord::discord_kick,
            integrations::discord::discord_ban,
            integrations::discord::discord_unban,
            integrations::discord::discord_mute,
            integrations::discord::discord_unmute,
            integrations::discord::discord_warn,
            integrations::discord::discord_delete_messages,
            integrations::discord::discord_assign_role,
            integrations::discord::discord_remove_role,
            integrations::discord::set_discord_status,
            integrations::discord::discord_send_dm,
            integrations::discord::discord_send_channel_message,
            integrations::discord::discord_get_channels,
            integrations::discord::set_discord_behaviour_channel,
            integrations::discord::get_user_behaviour,
            integrations::discord::get_system_status,
            commands::skills::list_skills,
            commands::skills::get_skill,
            commands::skills::create_skill,
            commands::skills::delete_skill,
            commands::skills::record_tool_usage,
            commands::skills::get_learning_insights,
            commands::skills::get_tool_usage_summary,
            commands::skills::set_user_preference,
            commands::skills::get_user_preferences,
            commands::skills::find_relevant_skills,
            commands::skills::record_skill_usage,
            commands::skills::delete_learning_insight,
            commands::skills::clear_learning_insights,
            commands::skills::update_learning_insight,
            commands::projects::get_cli_agents_status,
            commands::projects::configure_cli_agent,
            commands::projects::send_to_cli_agent,
            commands::projects::add_project,
            commands::projects::remove_project,
            commands::projects::list_projects,
            commands::projects::read_file,
            commands::projects::list_dir,
            commands::system::set_autostart,
            commands::system::get_autostart,
            commands::system::web_search,
            commands::todos::get_todos,
            commands::todos::save_todos,
            commands::notes::get_notes,
            commands::notes::save_notes,
            commands::memory::memory_list_entities,
            commands::memory::memory_get_entity,
            commands::memory::memory_add_entity,
            commands::memory::memory_update_entity,
            commands::memory::memory_delete_entity,
            commands::memory::memory_search,
            commands::memory::memory_add_relation,
            commands::memory::memory_delete_relation,
            commands::memory::memory_list_relations,
            commands::memory::clear_conversation_summary,
            commands::automations::list_automations,
            commands::automations::get_automation,
            commands::automations::create_automation,
            commands::automations::update_automation,
            commands::automations::delete_automation,
            commands::automations::run_automation_now,
            commands::automations::get_run_history,
            notifications::send_notification_command,
            integrations::minecraft::detect_minecraft_lan_port,
            integrations::minecraft::join_minecraft_world,
            integrations::minecraft::disconnect_minecraft_world,
            integrations::minecraft::get_minecraft_status,
            send_chat_message,
            submit_external_reply
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            let state = app_handle.state::<AppState>().inner().clone();
            tauri::async_runtime::block_on(async move {
                if let Some(mut child) = state.llama_server.lock().await.take() {
                    let _ = child.kill();
                }
                integrations::whatsapp::cleanup_whatsapp_for_shutdown(&state).await;
                integrations::discord::stop_discord_runtime(&state).await;
                let _ = integrations::minecraft::disconnect_minecraft_world().await;
            });
        }
    });
}

#[test]
fn test_lib_onboarding() {
    let config = crate::storage::load_config();
    println!("=== TEST LIB ONBOARDING ===");
    println!("first_run_completed: {}", config.first_run_completed);
    println!("llama_server_path: '{}'", config.llama_server_path);
    println!("==========================");
}
