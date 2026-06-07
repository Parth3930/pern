use crate::memory::{update_memory, UserMemory};
use crate::model::{get_model_registry, DownloadProgress, ModelInfo};
use crate::state::AppState;
use crate::storage::{save_config, AppConfig};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use sha2::Digest;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{Emitter, State, Window};
use tauri::path::BaseDirectory;
use tokio::fs as tokio_fs;
use tokio::io::AsyncWriteExt;

#[tauri::command]
pub async fn update_user_memory(
    memory: UserMemory,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    update_memory(&mut config, memory);
    save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn get_user_memory(state: State<'_, AppState>) -> Result<UserMemory, String> {
    let config = state.config.lock().await;
    Ok(config.user_memory.clone())
}

#[tauri::command]
pub async fn get_onboarding_state(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

#[tauri::command]
pub async fn list_installed_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let config = state.config.lock().await;
    let target_dir = PathBuf::from(&config.model_dir);
    drop(config);

    if !target_dir.exists() {
        return Ok(vec![]);
    }

    let mut installed = Vec::new();
    let mut entries = tokio_fs::read_dir(target_dir)
        .await
        .map_err(|e| e.to_string())?;

    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(metadata) = entry.metadata().await {
            if metadata.is_file() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.ends_with(".gguf") {
                    installed.push(file_name);
                }
            }
        }
    }

    Ok(installed)
}

#[tauri::command]
pub async fn list_available_models() -> Result<Vec<ModelInfo>, String> {
    Ok(get_model_registry())
}

#[tauri::command]
pub async fn choose_model(model_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.selected_model = model_id;
    save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn set_first_run_completed(
    completed: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.first_run_completed = completed;
    save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn choose_model_dir(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.model_dir = path;
    save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_model(
    model_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let registry = get_model_registry();
    let model_info = registry
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| "Model not found in registry".to_string())?;

    // Check if it's the running model or if we should stop the server
    let stop_server = {
        let current_model_lock = state.current_model_id.lock().await;
        current_model_lock.as_ref().map_or(false, |m| m == &model_id)
    };

    if stop_server {
        let mut server_lock = state.llama_server.lock().await;
        if let Some(mut child) = server_lock.take() {
            let _ = child.kill();
        }
        let mut current_model_lock = state.current_model_id.lock().await;
        *current_model_lock = None;
    }

    let config = state.config.lock().await;
    let target_dir = PathBuf::from(&config.model_dir);
    drop(config);

    let mut file_path = target_dir.clone();
    file_path.push(&model_info.file_name);

    if file_path.exists() {
        tokio_fs::remove_file(&file_path)
            .await
            .map_err(|e| format!("Failed to delete model file: {}", e))?;
    }

    // Also delete any partial download file if it exists
    let mut part_path = target_dir;
    part_path.push(format!("{}.part", model_info.file_name));
    if part_path.exists() {
        let _ = tokio_fs::remove_file(&part_path).await;
    }

    Ok(())
}

/// On Android, Kotlin writes nativeLibraryDir to a file so Rust can locate
/// the bundled libllama_server.so without needing a full JNI plugin.
#[cfg(target_os = "android")]
fn get_android_native_lib_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let app_dir = match app_handle.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            tracing::error!("[SERVER] Error resolving app_local_data_dir: {:?}", e);
            return None;
        }
    };
    let marker = app_dir.join("pern").join("native_lib_dir");
    tracing::info!("[SERVER] Reading nativeLibraryDir marker from: {:?}", marker);
    match std::fs::read_to_string(&marker) {
        Ok(content) => {
            let path_str = content.trim().to_string();
            tracing::info!("[SERVER] nativeLibraryDir marker content: {:?}", path_str);
            let path = PathBuf::from(path_str);
            if path.exists() {
                Some(path)
            } else {
                tracing::warn!("[SERVER] Directory from marker does not exist: {:?}", path);
                None
            }
        }
        Err(e) => {
            tracing::error!("[SERVER] Failed to read nativeLibraryDir marker file: {:?}", e);
            // Fallback to get_app_dir for backwards compatibility
            use crate::storage::get_app_dir;
            let fallback_marker = get_app_dir().join("native_lib_dir");
            tracing::info!("[SERVER] Reading fallback nativeLibraryDir marker from: {:?}", fallback_marker);
            if let Ok(content) = std::fs::read_to_string(&fallback_marker) {
                let path_str = content.trim().to_string();
                let path = PathBuf::from(path_str);
                if path.exists() {
                    return Some(path);
                }
            }
            None
        }
    }
}

#[tauri::command]
pub async fn llama_server_health() -> Result<bool, String> {
    let client = Client::new();
    if let Ok(res) = client.get("http://127.0.0.1:4891/health").send().await {
        if res.status().is_success() {
            if let Ok(body) = res.text().await {
                if body.contains("loading model") || body.contains("Loading model") {
                    return Ok(true);
                }
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[tauri::command]
pub async fn start_llama_server(
    model_id: String,
    app_handle: tauri::AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 1. Check if it's already running and healthy and it matches the requested model_id
    let is_same_model = {
        let current_model_lock = state.current_model_id.lock().await;
        current_model_lock.as_ref().map_or(false, |m| m == &model_id)
    };

    if is_same_model && llama_server_health().await.unwrap_or(false) {
        tracing::info!("[SERVER] llama-server for {} is already running and healthy.", model_id);
        return Ok(());
    }

    // 2. Stop any existing process handle we might have
    if let Some(mut child) = state.llama_server.lock().await.take() {
        let _ = child.kill();
    }

    // Clear the current model id during startup until it's healthy
    {
        let mut current_model_lock = state.current_model_id.lock().await;
        *current_model_lock = None;
    }

    // 3. Find model info
    let registry = get_model_registry();
    let model_info = registry
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| "Model not found in registry".to_string())?;

    let config = state.config.lock().await;
    let mut model_path = PathBuf::from(&config.model_dir);
    model_path.push(&model_info.file_name);
    let llama_path_from_config = config.llama_server_path.clone();
    let gpu_layers = config.llama_gpu_layers;
    let threads = config.llama_threads;
    let flash_attn = config.llama_flash_attn.clone();
    drop(config);

    if !model_path.exists() {
        return Err(format!("Model file not found at: {:?}", model_path));
    }

    // 4. Resolve the llama-server binary path — try config path first, then sidecar
    let mut server_exe: Option<PathBuf> = None;

    // On Android, we MUST only use the bundled libllama_server.so from nativeLibraryDir
    #[cfg(target_os = "android")]
    {
        if let Some(native_lib_dir) = get_android_native_lib_dir(&app_handle) {
            let bundled_exe = native_lib_dir.join("libllama_server.so");
            if bundled_exe.exists() {
                tracing::info!(
                    "[SERVER] Android: Using bundled llama-server at: {:?}",
                    bundled_exe
                );
                server_exe = Some(bundled_exe);
            }
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        // Try the auto-installed path from config
        if !llama_path_from_config.is_empty() {
            let config_path = PathBuf::from(&llama_path_from_config);
            if config_path.exists() {
                tracing::info!(
                    "[SERVER] Using auto-installed llama-server at: {:?}",
                    config_path
                );
                server_exe = Some(config_path);
            }
        }

        // Fallback: try Tauri sidecar path
        if server_exe.is_none() {
            use tauri::Manager;
            if let Ok(sidecar_path) = app_handle
                .path()
                .resolve("binaries/llama-server", BaseDirectory::Resource)
            {
                let sidecar_exe = if cfg!(target_os = "windows") {
                    let mut path = sidecar_path.clone();
                    if !path.exists() {
                        if let Ok(win_path) = app_handle.path().resolve(
                            "binaries/llama-server-x86_64-pc-windows-msvc.exe",
                            BaseDirectory::Resource,
                        ) {
                            path = win_path;
                        }
                    }
                    path
                } else {
                    sidecar_path
                };

                if sidecar_exe.exists() {
                    let metadata = std::fs::metadata(&sidecar_exe);
                    let is_real_binary = metadata.map(|m| m.len() > 100).unwrap_or(false);
                    if is_real_binary {
                        tracing::info!("[SERVER] Using sidecar llama-server at: {:?}", sidecar_exe);
                        server_exe = Some(sidecar_exe);
                    }
                }
            }
        }
    }

    let server_exe = server_exe.ok_or_else(|| {
        "llama-server not found. Please install it via the onboarding setup.".to_string()
    })?;

    // 5. Start process
    tracing::info!(
        "[SERVER] Starting llama-server with model: {:?}",
        model_path
    );
    let _ = window.emit(
        "app-log",
        json!({ "level": "info", "message": "Starting local AI server..." }),
    );

    let mut args = vec![
        "-m".to_string(),
        model_path.to_string_lossy().to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        "4891".to_string(),
        "-c".to_string(),
        model_info.context_length.min(4096).to_string(),
        "--embedding".to_string(),
        "--n-gpu-layers".to_string(),
        gpu_layers.to_string(),
        "--no-warmup".to_string(),
    ];
    if threads > 0 {
        args.push("--threads".to_string());
        args.push(threads.to_string());
    }
    if !flash_attn.is_empty() {
        args.push("--flash-attn".to_string());
        args.push(flash_attn.clone());
    }

    let mut cmd = Command::new(&server_exe);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.args(&args);
    // On Android, companion .so files live in nativeLibraryDir alongside the binary.
    // Set LD_LIBRARY_PATH so the dynamic linker finds them at runtime.
    #[cfg(target_os = "android")]
    if let Some(lib_dir) = server_exe.parent() {
        cmd.env("LD_LIBRARY_PATH", lib_dir);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let fallback_name = if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    };

    let mut child = cmd.spawn().or_else(|e| {
        tracing::warn!("[SERVER] Primary spawn failed: {}. Trying fallback...", e);
        let mut fallback_cmd = Command::new(fallback_name);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            fallback_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        fallback_cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e2| {
                let msg = format!("Failed to start llama-server: {} and {}", e, e2);
                tracing::error!("[SERVER] CRITICAL ERROR: {}", msg);
                msg
            })
    })?;

    // Monitor the process for immediate crashes and wait for model loading
    let mut attempts = 0;
    while attempts < 180 {
        attempts += 1;

        // Check if the process exited prematurely
        if let Ok(Some(status)) = child.try_wait() {
            let mut error_details = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                use std::io::Read;
                let mut buf = [0; 4096];
                if let Ok(n) = stderr.read(&mut buf) {
                    error_details = String::from_utf8_lossy(&buf[..n]).to_string();
                }
            }
            if error_details.is_empty() {
                if let Some(mut stdout) = child.stdout.take() {
                    use std::io::Read;
                    let mut buf = [0; 4096];
                    if let Ok(n) = stdout.read(&mut buf) {
                        error_details = String::from_utf8_lossy(&buf[..n]).to_string();
                    }
                }
            }
            let msg = format!(
                "Local AI server exited immediately with status: {}. Output: {}",
                status,
                error_details.trim()
            );
            tracing::error!("[SERVER] ERROR: {}", msg);
            let _ = window.emit("app-log", json!({ "level": "error", "message": &msg }));
            return Err(msg);
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        if llama_server_health().await.unwrap_or(false) {
            tracing::info!("[SERVER] llama-server is healthy!");
            let _ = window.emit(
                "app-log",
                json!({ "level": "info", "message": "Local AI server is ready." }),
            );
            let mut server_lock = state.llama_server.lock().await;
            *server_lock = Some(child);

            // Record the currently running model ID
            let mut current_model_lock = state.current_model_id.lock().await;
            *current_model_lock = Some(model_id);

            return Ok(());
        }

        // Send a periodic status update every 10 seconds
        if attempts % 20 == 0 {
            let _ = window.emit(
                "app-log",
                json!({ "level": "info", "message": "AI model is still loading into memory..." }),
            );
        }
    }

    let _ = child.kill();
    Err("Timed out waiting for local AI server to become healthy. It might be taking too long to load the model or the binary is invalid.".to_string())
}

#[tauri::command]
pub async fn download_model(
    model_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let registry = get_model_registry();
    let model_info = registry
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| "Model not found in registry".to_string())?;

    let config = state.config.lock().await;
    let target_dir = PathBuf::from(&config.model_dir);
    drop(config);

    tokio_fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Failed to create model directory: {}", e))?;

    let mut final_path = target_dir.clone();
    final_path.push(&model_info.file_name);

    tracing::info!("[MODEL] Checking if model {} already exists...", model_id);
    let _ = window.emit("app-log", json!({ "level": "info", "message": format!("Checking if {} is already downloaded...", model_id) }));

    if final_path.exists() {
        tracing::info!(
            "[MODEL] Model {} found locally. Skipping download.",
            model_id
        );
        let _ = window.emit("app-log", json!({ "level": "info", "message": format!("Model {} is already present. Skipping download.", model_id) }));
        let _ = window.emit("model-download-complete", model_id);
        return Ok(());
    }

    let mut part_path = target_dir.clone();
    part_path.push(format!("{}.part", model_info.file_name));

    tracing::info!(
        "[MODEL] Downloading {} from {}...",
        model_id, model_info.download_url
    );
    let _ = window.emit(
        "app-log",
        json!({ "level": "info", "message": format!("Connecting to server for {}...", model_id) }),
    );

    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(30))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| {
            let msg = format!("Failed to build client: {}", e);
            let _ = window.emit("app-log", json!({ "level": "error", "message": &msg }));
            msg
        })?;

    let res = client
        .get(&model_info.download_url)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("Network error: {}. Check your connection.", e);
            let _ = window.emit("app-log", json!({ "level": "error", "message": &msg }));
            tracing::error!("[MODEL] Network Error: {}", e);
            msg
        })?;

    if !res.status().is_success() {
        let msg = format!("Server error: {}. URL may be invalid.", res.status());
        let _ = window.emit("app-log", json!({ "level": "error", "message": &msg }));
        tracing::error!("[MODEL] HTTP Error: {}", res.status());
        return Err(msg);
    }

    let total_size = res.content_length();
    tracing::info!("[MODEL] Total size: {:?}", total_size);
    let mut downloaded: u64 = 0;

    let mut file = tokio_fs::File::create(&part_path).await.map_err(|e| {
        let msg = format!("Disk error: {}. Ensure path is writable.", e);
        let _ = window.emit("app-log", json!({ "level": "error", "message": &msg }));
        tracing::error!("[MODEL] File Create Error: {}", e);
        msg
    })?;
    let mut stream = res.bytes_stream();

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        if let Some(total) = total_size {
            let _ = window.emit(
                "model-download-progress",
                DownloadProgress {
                    status: Some("Downloading model...".to_string()),
                    error: None,
                    digest: None,
                    total: Some(total),
                    completed: Some(downloaded),
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {}", e))?;
    drop(file);

    // Rename .part to final
    tokio_fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("Rename error: {}", e))?;

    // Verify SHA256 if model_info.sha256 is Some
    if let Some(expected_sha256) = &model_info.sha256 {
        tracing::info!("[MODEL] Verifying SHA256 checksum...");
        let _ = window.emit("app-log", json!({ "level": "info", "message": format!("Verifying SHA256 checksum for {}...", model_id) }));
        let file_content = tokio_fs::read(&final_path).await.map_err(|e| format!("Failed to read downloaded file for verification: {}", e))?;
        let mut hasher = sha2::Sha256::new();
        hasher.update(&file_content);
        let actual_hash = format!("{:x}", hasher.finalize());
        if actual_hash.to_lowercase() != expected_sha256.to_lowercase() {
            let _ = tokio_fs::remove_file(&final_path).await;
            let msg = format!(
                "SHA256 mismatch for {}: expected {}, got {}",
                model_id, expected_sha256, actual_hash
            );
            tracing::error!("[MODEL] ERROR: {}", msg);
            let _ = window.emit("app-log", json!({ "level": "error", "message": &msg }));
            return Err(msg);
        }
        tracing::info!("[MODEL] SHA256 verification passed.");
    }

    tracing::info!("[MODEL] Model {} download complete.", model_id);
    let _ = window.emit("app-log", json!({ "level": "info", "message": format!("Model {} successfully downloaded.", model_id) }));
    let _ = window.emit("model-download-complete", model_id);
    Ok(())
}

#[tauri::command]
pub async fn check_llama_installed(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    // On Android, the binary is bundled in nativeLibraryDir — no user install needed.
    #[cfg(target_os = "android")]
    {
        let _ = state;
        if let Some(native_lib_dir) = get_android_native_lib_dir(&app_handle) {
            let server_so = native_lib_dir.join("libllama_server.so");
            let ggml_so = native_lib_dir.join("libggml.so");
            let mtmd_so = native_lib_dir.join("libmtmd.so");
            let installed = server_so.exists() && ggml_so.exists() && mtmd_so.exists();
            tracing::info!("[SERVER] Android native library check: server_so={}, ggml_so={}, mtmd_so={}, installed={}",
                server_so.exists(), ggml_so.exists(), mtmd_so.exists(), installed);
            return Ok(installed);
        }
        // nativeLibDir file not written yet (app just launched) — return false so onboarding runs
        return Ok(false);
    }

    #[cfg(not(target_os = "android"))]
    {
        {
            let config = state.config.lock().await;
            if !config.llama_server_path.is_empty() {
                let path = PathBuf::from(&config.llama_server_path);
                if path.exists() {
                    return Ok(true);
                }
            }
        }

        // Try to resolve bundled/sidecar binary in resource dir
        use tauri::Manager;
        if let Ok(sidecar_path) = app_handle
            .path()
            .resolve("binaries/llama-server", BaseDirectory::Resource)
        {
            let sidecar_exe = if cfg!(target_os = "windows") {
                let mut path = sidecar_path.clone();
                if !path.exists() {
                    if let Ok(win_path) = app_handle.path().resolve(
                        "binaries/llama-server-x86_64-pc-windows-msvc.exe",
                        BaseDirectory::Resource,
                    ) {
                        path = win_path;
                    }
                }
                path
            } else {
                sidecar_path
            };

            if sidecar_exe.exists() {
                let metadata = std::fs::metadata(&sidecar_exe);
                let is_real_binary = metadata.map(|m| m.len() > 100).unwrap_or(false);
                if is_real_binary {
                    let path_str = sidecar_exe.to_string_lossy().to_string();
                    let mut config = state.config.lock().await;
                    config.llama_server_path = path_str;
                    let _ = crate::storage::save_config(&config);
                    tracing::info!("[SERVER] Detected and registered bundled llama-server at: {:?}", sidecar_exe);
                    return Ok(true);
                }
            }
        }

        Ok(false)
    }
}

#[tauri::command]
pub async fn get_platform_info() -> Result<serde_json::Value, String> {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    };

    let arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "unknown"
    };

    Ok(json!({
        "os": os,
        "arch": arch
    }))
}

#[tauri::command]
pub async fn request_android_notification_permission(
    _app_handle: tauri::AppHandle,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        // On Android 13 (API 33) and above, we need to request POST_NOTIFICATIONS
        // For now, we return true to unblock the build.
        // In a production app, tauri-plugin-notification should be used.
        Ok(true)
    }

    #[cfg(not(target_os = "android"))]
    Ok(true)
}

#[tauri::command]
pub async fn install_llama_server(
    force: Option<bool>,
    app_handle: tauri::AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> Result<String, String> {
    use std::io::{Cursor, Read};
    use tauri::Manager;

    let _force_reinstall = force.unwrap_or(false);

    // On non-Android desktop platforms, check for a bundled/sidecar binary first
    #[cfg(not(target_os = "android"))]
    {
        if !_force_reinstall {
            use tauri::Manager;
            if let Ok(sidecar_path) = app_handle
                .path()
                .resolve("binaries/llama-server", BaseDirectory::Resource)
            {
                let sidecar_exe = if cfg!(target_os = "windows") {
                    let mut path = sidecar_path.clone();
                    if !path.exists() {
                        if let Ok(win_path) = app_handle.path().resolve(
                            "binaries/llama-server-x86_64-pc-windows-msvc.exe",
                            BaseDirectory::Resource,
                        ) {
                            path = win_path;
                        }
                    }
                    path
                } else {
                    sidecar_path
                };

                if sidecar_exe.exists() {
                    let metadata = std::fs::metadata(&sidecar_exe);
                    let is_real_binary = metadata.map(|m| m.len() > 100).unwrap_or(false);
                    if is_real_binary {
                        let path_str = sidecar_exe.to_string_lossy().to_string();
                        {
                            let mut config = state.config.lock().await;
                            config.llama_server_path = path_str.clone();
                            crate::storage::save_config(&config)?;
                        }
                        let _ = window.emit(
                            "llama-install-progress",
                            json!({ "stage": "complete", "message": "AI engine ready (bundled sidecar)!", "path": &path_str }),
                        );
                        tracing::info!("[SERVER] install_llama_server: Using bundled sidecar at {:?}", sidecar_exe);
                        return Ok(path_str);
                    }
                }
            }
        }
    }

    // On Android: we must ONLY use the bundled binary in nativeLibraryDir (jniLibs extracted by OS).
    // Downloading at runtime is not allowed/executable due to SELinux restrictions.
    #[cfg(target_os = "android")]
    {
        if let Some(native_lib_dir) = get_android_native_lib_dir(&app_handle) {
            let exe = native_lib_dir.join("libllama_server.so");
            if exe.exists() {
                let path_str = exe.to_string_lossy().to_string();
                {
                    let mut config = state.config.lock().await;
                    config.llama_server_path = path_str.clone();
                    crate::storage::save_config(&config)?;
                }
                let _ = window.emit(
                    "llama-install-progress",
                    json!({ "stage": "complete", "message": "AI engine ready (bundled)!", "path": &path_str }),
                );
                return Ok(path_str);
            }
        }
        return Err("Bundled llama-server binary not found in nativeLibraryDir. Please reinstall the APK.".to_string());
    }

    let _ = window.emit(
        "llama-install-progress",
        json!({ "stage": "checking", "message": "Detecting platform..." }),
    );

    // 1. Determine platform-specific download info
    let (asset_name_pattern, binary_name, is_zip) = if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            ("bin-win-cpu-arm64.zip", "llama-server.exe", true)
        } else {
            ("bin-win-cpu-x64.zip", "llama-server.exe", true)
        }
    } else if cfg!(target_os = "android") {
        ("bin-android-arm64.tar.gz", "llama-server", false)
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            ("bin-macos-arm64.tar.gz", "llama-server", false)
        } else {
            ("bin-macos-x64.tar.gz", "llama-server", false)
        }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "aarch64") {
            ("bin-ubuntu-arm64.tar.gz", "llama-server", false)
        } else {
            ("bin-ubuntu-x64.tar.gz", "llama-server", false)
        }
    } else {
        return Err("Unsupported platform".to_string());
    };

    let _ = window.emit(
        "llama-install-progress",
        json!({ "stage": "fetching", "message": "Fetching latest release info..." }),
    );

    // 2. Get releases from GitHub and find the latest one that has our target asset
    let client = Client::builder()
        .user_agent("Mozilla/5.0 Pern/1.0")
        .connect_timeout(std::time::Duration::from_secs(30))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let release_res = client
        .get("https://api.github.com/repos/ggml-org/llama.cpp/releases")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release info: {}", e))?;

    if !release_res.status().is_success() {
        return Err(format!("GitHub API error: {}", release_res.status()));
    }

    let releases_json: serde_json::Value = release_res
        .json()
        .await
        .map_err(|e| format!("Failed to parse release JSON: {}", e))?;

    let releases = releases_json
        .as_array()
        .ok_or("Expected JSON array of releases")?;

    let mut download_info = None;

    for release in releases {
        let tag = match release["tag_name"].as_str() {
            Some(t) => t.to_string(),
            None => continue,
        };

        if let Some(assets) = release["assets"].as_array() {
            let found_url = assets.iter().find_map(|asset| {
                let name = asset["name"].as_str()?;
                if name.contains(asset_name_pattern) {
                    asset["browser_download_url"]
                        .as_str()
                        .map(|s| s.to_string())
                } else {
                    None
                }
            });

            if let Some(url) = found_url {
                download_info = Some((tag, url));
                break;
            }
        }
    }

    let (tag, download_url) = download_info.ok_or_else(|| {
        format!(
            "Could not find any release with an asset matching '{}'",
            asset_name_pattern
        )
    })?;

    let _ = window.emit(
        "llama-install-progress",
        json!({ "stage": "downloading", "message": format!("Downloading llama.cpp {}...", tag) }),
    );

    tracing::info!("[LLAMA-INSTALL] Downloading from: {}", download_url);

    // 4. Download the archive
    let dl_res = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !dl_res.status().is_success() {
        return Err(format!("Download HTTP error: {}", dl_res.status()));
    }

    let total_size = dl_res.content_length();
    let mut downloaded: u64 = 0;
    let mut archive_data = Vec::new();
    let mut stream = dl_res.bytes_stream();

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Download stream error: {}", e))?;
        archive_data.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;

        if let Some(total) = total_size {
            let pct = (downloaded as f64 / total as f64 * 100.0) as u32;
            let _ = window.emit(
                "llama-install-progress",
                json!({
                    "stage": "downloading",
                    "message": format!("Downloading... {}%", pct),
                    "progress": pct,
                    "total": total,
                    "downloaded": downloaded
                }),
            );
        }
    }

    let _ = window.emit(
        "llama-install-progress",
        json!({ "stage": "extracting", "message": "Extracting llama-server files..." }),
    );

    // 5. Extract ALL files from the archive (llama-server needs companion DLLs/libs)
    // Use Tauri's path resolver so Android uses filesDir (writable) not a system path
    let install_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("llama-server");
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Failed to create install dir: {}", e))?;

    let mut final_binary_path = install_dir.clone();
    final_binary_path.push(binary_name);

    // Extract in a blocking task since zip/tar types are not Send
    let binary_name_owned = binary_name.to_string();
    let install_dir_clone = install_dir.clone();
    let found_binary = tokio::task::spawn_blocking(move || -> Result<bool, String> {
        let mut found = false;

        if is_zip {
            // Windows: extract from .zip
            let cursor = Cursor::new(&archive_data);
            let mut archive =
                zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open zip: {}", e))?;

            for i in 0..archive.len() {
                let mut file = archive
                    .by_index(i)
                    .map_err(|e| format!("Zip entry error: {}", e))?;

                // Skip directories
                if file.is_dir() {
                    continue;
                }

                let entry_name = file.name().to_string();
                // Get just the file name (strip any directory prefix in the archive)
                let file_name = std::path::Path::new(&entry_name)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if file_name.is_empty() {
                    continue;
                }

                // Track if we found the main binary
                if file_name == binary_name_owned {
                    found = true;
                }

                let mut out_path = install_dir_clone.clone();
                out_path.push(&file_name);

                let mut buf = Vec::new();
                file.read_to_end(&mut buf)
                    .map_err(|e| format!("Read error for {}: {}", file_name, e))?;
                std::fs::write(&out_path, &buf)
                    .map_err(|e| format!("Write error for {}: {}", file_name, e))?;

                tracing::info!("[LLAMA-INSTALL] Extracted: {}", file_name);
            }
        } else {
            // Android/Linux/macOS: extract from .tar.gz
            let cursor = Cursor::new(&archive_data);
            let gz = flate2::read::GzDecoder::new(cursor);
            let mut tar = tar::Archive::new(gz);

            let entries = tar
                .entries()
                .map_err(|e| format!("Tar entries error: {}", e))?;

            for entry_res in entries {
                let mut entry = entry_res.map_err(|e| format!("Tar entry error: {}", e))?;

                // Skip directories
                if entry.header().entry_type().is_dir() {
                    continue;
                }

                let entry_path = entry
                    .path()
                    .map_err(|e| format!("Tar path error: {}", e))?
                    .to_path_buf();

                let file_name = entry_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if file_name.is_empty() {
                    continue;
                }

                if file_name == binary_name_owned {
                    found = true;
                }

                let mut out_path = install_dir_clone.clone();
                out_path.push(&file_name);

                let mut buf = Vec::new();
                entry
                    .read_to_end(&mut buf)
                    .map_err(|e| format!("Read error for {}: {}", file_name, e))?;
                std::fs::write(&out_path, &buf)
                    .map_err(|e| format!("Write error for {}: {}", file_name, e))?;

                // Make executable on Unix-like systems
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if file_name == binary_name_owned {
                        let perms = std::fs::Permissions::from_mode(0o755);
                        std::fs::set_permissions(&out_path, perms)
                            .map_err(|e| format!("chmod error: {}", e))?;
                    }
                }

                tracing::info!("[LLAMA-INSTALL] Extracted: {}", file_name);
            }
        }

        Ok(found)
    })
    .await
    .map_err(|e| format!("Extraction task panicked: {}", e))??;

    if !found_binary {
        return Err(format!(
            "Could not find {} in the downloaded archive",
            binary_name
        ));
    }

    // 6. Save path to config
    let final_path_str = final_binary_path.to_string_lossy().to_string();
    {
        let mut config = state.config.lock().await;
        config.llama_server_path = final_path_str.clone();
        save_config(&config)?;
    }

    let _ = window.emit(
        "llama-install-progress",
        json!({
            "stage": "complete",
            "message": "llama-server installed successfully!",
            "path": &final_path_str
        }),
    );

    tracing::info!(
        "[LLAMA-INSTALL] Installation complete at: {}",
        final_path_str
    );
    Ok(final_path_str)
}
