pub mod chat;
pub mod chat_prompt;
pub mod commands;
pub mod integrations;
pub mod learner;
pub mod memory;
pub mod model;
pub mod skills;
pub mod state;
pub mod storage;
pub mod tools;

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
async fn send_chat_message(
    model_id: String,
    messages: Vec<ChatMessage>,
    window: tauri::Window,
) -> Result<(), String> {
    let msg_count = messages.len();
    let total_chars: usize = messages.iter().map(|m| m.content.len()).sum();
    println!("[CHAT][DIAG] Command received: model={}, messages={}, total_chars={}, est_tokens={}", model_id, msg_count, total_chars, total_chars / 4);
    println!("[CHAT][DIAG] Message roles: {:?}", messages.iter().map(|m| m.role.as_str()).collect::<Vec<_>>());
    if let Some(sys) = messages.first() {
        println!("[CHAT][DIAG] System prompt length: {} chars, preview: {}...", sys.content.len(), &sys.content[..sys.content.len().min(150)]);
    }
    let client = Client::new();
    let req_body = ChatRequest {
        model: "local".to_string(),
        messages,
        temperature: 0.7,
        stream: true,
        max_tokens: None,
        stop: None,
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
    let mut chunk_count: u32 = 0;
    let mut total_bytes: usize = 0;

    while let Some(chunk_res) = stream.next().await {
        match chunk_res {
            Ok(chunk) => {
                buffer.extend_from_slice(&chunk);
                chunk_count += 1;
                total_bytes += chunk.len();

                // Process SSE format
                let mut unparsed = Vec::new();
                let buffer_str = String::from_utf8_lossy(&buffer);

                for line in buffer_str.lines() {
                    let line = line.trim();
                    if line.starts_with("data: ") {
                        let data = &line[6..];
                        if data == "[DONE]" {
                            println!("[CHAT][DIAG] Stream DONE: chunks={}, total_bytes={}", chunk_count, total_bytes);
                            break;
                        }
                        if let Ok(response) = serde_json::from_str::<OpenAIStreamChunk>(data) {
                            if let Some(choice) = response.choices.first() {
                                if let Some(content) = &choice.delta.content {
                                    let _ = window.emit("chat-token", content.clone());
                                }
                            }
                        }
                    } else if !line.is_empty() {
                        // Keep incomplete lines for the next chunk
                        unparsed.extend_from_slice(line.as_bytes());
                        unparsed.push(b'\n');
                    }
                }
                buffer = unparsed;
            }
            Err(e) => {
                println!("[CHAT] Stream error: {}", e);
                break;
            }
        }
    }

    println!("[CHAT][DIAG] Emitting chat-complete");
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
            commands::get_onboarding_state,
            commands::update_user_memory,
            commands::get_user_memory,
            commands::list_available_models,
            commands::list_installed_models,
            commands::delete_model,
            commands::choose_model,
            commands::choose_model_dir,
            commands::set_first_run_completed,
            commands::download_model,
            commands::start_llama_server,
            commands::llama_server_health,
            commands::launch_app,
            commands::close_app,
            commands::restart_system,
            commands::shutdown_system,
            commands::send_email,
            commands::save_email_config,
            commands::check_llama_installed,
            commands::install_llama_server,
            commands::get_platform_info,
            commands::request_android_notification_permission,
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
            commands::list_skills,
            commands::get_skill,
            commands::create_skill,
            commands::delete_skill,
            commands::record_tool_usage,
            commands::get_learning_insights,
            commands::get_tool_usage_summary,
            commands::set_user_preference,
            commands::get_user_preferences,
            commands::find_relevant_skills,
            commands::record_skill_usage,
            commands::delete_learning_insight,
            commands::clear_learning_insights,
            commands::update_learning_insight,
            commands::get_cli_agents_status,
            commands::configure_cli_agent,
            commands::send_to_cli_agent,
            commands::add_project,
            commands::remove_project,
            commands::list_projects,
            commands::set_autostart,
            commands::get_autostart,
            send_chat_message
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
