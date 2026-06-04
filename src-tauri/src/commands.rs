    use crate::memory::{update_memory, UserMemory};
use crate::model::{get_model_registry, DownloadProgress, ModelInfo};
use crate::state::AppState;
use crate::storage::{save_config, AppConfig};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use std::collections::HashSet;
use tauri::{Emitter, State, Window};

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

use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::path::BaseDirectory;
use tokio::fs as tokio_fs;
use tokio::io::AsyncWriteExt;

/// On Android, Kotlin writes nativeLibraryDir to a file so Rust can locate
/// the bundled libllama_server.so without needing a full JNI plugin.
#[cfg(target_os = "android")]
fn get_android_native_lib_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let app_dir = match app_handle.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            println!("[SERVER] Error resolving app_local_data_dir: {:?}", e);
            return None;
        }
    };
    let marker = app_dir.join("pern").join("native_lib_dir");
    println!("[SERVER] Reading nativeLibraryDir marker from: {:?}", marker);
    match std::fs::read_to_string(&marker) {
        Ok(content) => {
            let path_str = content.trim().to_string();
            println!("[SERVER] nativeLibraryDir marker content: {:?}", path_str);
            let path = PathBuf::from(path_str);
            if path.exists() {
                Some(path)
            } else {
                println!("[SERVER] Directory from marker does not exist: {:?}", path);
                None
            }
        }
        Err(e) => {
            println!("[SERVER] Failed to read nativeLibraryDir marker file: {:?}", e);
            // Fallback to get_app_dir for backwards compatibility
            use crate::storage::get_app_dir;
            let fallback_marker = get_app_dir().join("native_lib_dir");
            println!("[SERVER] Reading fallback nativeLibraryDir marker from: {:?}", fallback_marker);
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
        println!("[SERVER] llama-server for {} is already running and healthy.", model_id);
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
                println!(
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
                println!(
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
                        println!("[SERVER] Using sidecar llama-server at: {:?}", sidecar_exe);
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
    println!(
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
        println!("[SERVER] Primary spawn failed: {}. Trying fallback...", e);
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
                println!("[SERVER] CRITICAL ERROR: {}", msg);
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
            println!("[SERVER] ERROR: {}", msg);
            let _ = window.emit("app-log", json!({ "level": "error", "message": &msg }));
            return Err(msg);
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        if llama_server_health().await.unwrap_or(false) {
            println!("[SERVER] llama-server is healthy!");
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

    println!("[MODEL] Checking if model {} already exists...", model_id);
    let _ = window.emit("app-log", json!({ "level": "info", "message": format!("Checking if {} is already downloaded...", model_id) }));

    if final_path.exists() {
        println!(
            "[MODEL] Model {} found locally. Skipping download.",
            model_id
        );
        let _ = window.emit("app-log", json!({ "level": "info", "message": format!("Model {} is already present. Skipping download.", model_id) }));
        let _ = window.emit("model-download-complete", model_id);
        return Ok(());
    }

    let mut part_path = target_dir.clone();
    part_path.push(format!("{}.part", model_info.file_name));

    println!(
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
            println!("[MODEL] Network Error: {}", e);
            msg
        })?;

    if !res.status().is_success() {
        let msg = format!("Server error: {}. URL may be invalid.", res.status());
        let _ = window.emit("app-log", json!({ "level": "error", "message": &msg }));
        println!("[MODEL] HTTP Error: {}", res.status());
        return Err(msg);
    }

    let total_size = res.content_length();
    println!("[MODEL] Total size: {:?}", total_size);
    let mut downloaded: u64 = 0;

    let mut file = tokio_fs::File::create(&part_path).await.map_err(|e| {
        let msg = format!("Disk error: {}. Ensure path is writable.", e);
        let _ = window.emit("app-log", json!({ "level": "error", "message": &msg }));
        println!("[MODEL] File Create Error: {}", e);
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

    // TODO: Verify SHA256 if `model_info.sha256` is Some

    println!("[MODEL] Model {} download complete.", model_id);
    let _ = window.emit("app-log", json!({ "level": "info", "message": format!("Model {} successfully downloaded.", model_id) }));
    let _ = window.emit("model-download-complete", model_id);
    Ok(())
}

fn split_case_insensitive<'a>(input: &'a str, separator: &str) -> Vec<&'a str> {
    let lower_input = input.to_lowercase();
    let lower_separator = separator.to_lowercase();
    let mut result = Vec::new();
    let mut start = 0usize;
    let mut search_start = 0usize;

    while let Some(relative_idx) = lower_input[search_start..].find(&lower_separator) {
        let separator_start = search_start + relative_idx;
        result.push(input[start..separator_start].trim());
        start = separator_start + separator.len();
        search_start = start;
    }

    result.push(input[start..].trim());
    result
}

fn sanitize_requested_app_name(input: &str) -> String {
    let mut name = input
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'' || c == '`')
        .trim()
        .trim_end_matches(|c: char| c == '.' || c == '!' || c == '?')
        .trim()
        .to_string();

    let lower = name.to_lowercase();
    if lower.starts_with("both ") {
        name = name[5..].trim().to_string();
    } else if lower.starts_with("the ") {
        name = name[4..].trim().to_string();
    }

    if name.to_lowercase().ends_with(" desktop") {
        name = name[..name.len() - 8].trim().to_string();
    }

    if name.to_lowercase().ends_with(" app") {
        name = name[..name.len() - 4].trim().to_string();
    } else if name.to_lowercase().ends_with(" application") {
        name = name[..name.len() - 12].trim().to_string();
    } else if name.to_lowercase().ends_with(" program") {
        name = name[..name.len() - 8].trim().to_string();
    }

    name
}

fn split_requested_app_names(input: &str) -> Vec<String> {
    let mut parts: Vec<String> = vec![input.trim().to_string()];

    for separator in [",", "&"] {
        parts = parts
            .into_iter()
            .flat_map(|part| {
                part.split(separator)
                    .map(|piece| piece.trim().to_string())
                    .collect::<Vec<_>>()
            })
            .collect();
    }

    for separator in [" and ", " then ", " plus ", " also "] {
        let mut next = Vec::new();
        for part in parts {
            for piece in split_case_insensitive(&part, separator) {
                next.push(piece.to_string());
            }
        }
        parts = next;
    }

    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for part in parts {
        let cleaned = sanitize_requested_app_name(&part);
        if cleaned.is_empty() {
            continue;
        }

        let key = cleaned.to_lowercase();
        if seen.insert(key) {
            deduped.push(cleaned);
        }
    }

    deduped
}

#[cfg(target_os = "windows")]
fn launch_single_app(app_name: &str, window: &Window) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use std::process::Command;

    let _ = window.emit(
        "app-log",
        json!({ "level": "info", "message": format!("Trying quick launch for '{}'...", app_name) }),
    );

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
        let _ = window.emit(
            "app-log",
            json!({ "level": "info", "message": format!("Quick launch successful for '{}'", app_name) }),
        );
        return Ok(json!({
            "ok": true,
            "status": "launched",
            "app_name": app_name,
            "resolved_name": app_name
        }));
    }

    let _ = window.emit(
        "app-log",
        json!({ "level": "info", "message": format!("Quick launch failed. Searching Start Apps for '{}'...", app_name) }),
    );

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
        let _ = window.emit(
            "app-log",
            json!({ "level": "info", "message": format!("Found and launched via Start Apps: {}", resolved_name) }),
        );

        Ok(json!({
            "ok": true,
            "status": "launched",
            "app_name": app_name,
            "resolved_name": resolved_name
        }))
    } else {
        let _ = window.emit(
            "app-log",
            json!({ "level": "error", "message": format!("Failed to find or launch '{}' after deep search.", app_name) }),
        );
        Ok(json!({
            "ok": false,
            "status": "not_found",
            "app_name": app_name,
            "message": format!("I couldn't find '{}'. Try being more specific or check if it's installed.", app_name)
        }))
    }
}

#[tauri::command]
pub async fn launch_app(app_name: String, window: Window) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let _ = window.emit(
        "app-log",
        json!({ "level": "info", "message": format!("Request to launch: {}", app_name) }),
    );

    let lower_name = app_name.to_lowercase();
    let blocked_terms = [
        "powershell",
        "cmd.exe",
        "regedit",
        "format",
        "del ",
        "rmdir",
    ];

    if app_name.contains('\\')
        || app_name.contains('/')
        || app_name.contains(':')
        || app_name.contains(';')
        || blocked_terms.iter().any(|&term| lower_name.contains(term))
    {
        let msg = "Blocked attempt to use direct paths or system commands.";
        let _ = window.emit("app-log", json!({ "level": "error", "message": msg }));
        return Ok(json!({
            "ok": false,
            "status": "blocked_by_policy",
            "app_name": app_name,
            "message": "Pern cannot open direct paths or execute system commands."
        }));
    }

    #[cfg(target_os = "windows")]
    {
        let requested_apps = split_requested_app_names(&app_name);
        if requested_apps.is_empty() {
            return Ok(json!({
                "ok": false,
                "status": "not_found",
                "app_name": app_name,
                "message": "I couldn't detect which app to open."
            }));
        }

        if requested_apps.len() == 1 {
            return launch_single_app(&requested_apps[0], &window);
        }

        let mut opened_apps: Vec<String> = Vec::new();
        let mut failed_apps: Vec<String> = Vec::new();

        for requested in &requested_apps {
            let result = launch_single_app(requested, &window)?;
            let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

            if ok {
                let resolved = result
                    .get("resolved_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(requested);
                opened_apps.push(resolved.to_string());
            } else {
                failed_apps.push(requested.to_string());
            }
        }

        if failed_apps.is_empty() {
            return Ok(json!({
                "ok": true,
                "status": "launched_multiple",
                "app_name": app_name,
                "resolved_name": opened_apps.join(", "),
                "message": format!("Opened {}.", opened_apps.join(", "))
            }));
        }

        if opened_apps.is_empty() {
            return Ok(json!({
                "ok": false,
                "status": "not_found",
                "app_name": app_name,
                "message": format!("I couldn't find these apps: {}. Try being more specific or check if they're installed.", failed_apps.join(", "))
            }));
        }

        Ok(json!({
            "ok": false,
            "status": "partial_success",
            "app_name": app_name,
            "message": format!("Opened {}. I couldn't find {}.", opened_apps.join(", "), failed_apps.join(", "))
        }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(json!({
            "ok": false,
            "status": "not_supported",
            "app_name": app_name,
            "message": "App launching is not available on this platform."
        }))
    }
}

#[cfg(target_os = "windows")]
fn close_single_app(app_name: &str, window: &Window) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use std::process::Command;

    let lower_name = app_name.to_lowercase();
    let name_with_exe = if lower_name.ends_with(".exe") {
        lower_name.clone()
    } else {
        format!("{}.exe", lower_name)
    };

    let mut kill_cmd = Command::new("taskkill");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        kill_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = kill_cmd
        .args(["/F", "/IM", &name_with_exe])
        .output()
        .map_err(|e| format!("Taskkill execution failed: {}", e))?;

    if output.status.success() {
        let _ = window.emit(
            "app-log",
            json!({ "level": "info", "message": format!("Closed: {}", app_name) }),
        );
        return Ok(json!({
            "ok": true,
            "status": "closed",
            "app_name": app_name
        }));
    }

    let script = format!(
        "$name = '{0}'; \
         $procs = Get-Process | Where-Object {{ $_.ProcessName -like \"*$name*\" -or $_.Description -like \"*$name*\" }}; \
         if ($procs) {{ \
            $procs | Stop-Process -Force; \
            echo \"closed\" \
         }} else {{ \
            echo \"not_found\" \
         }}",
        app_name.replace("'", "''")
    );

    let mut ps_cmd = Command::new("powershell");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        ps_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = ps_cmd
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("PowerShell execution failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if stdout == "closed" {
        let _ = window.emit(
            "app-log",
            json!({ "level": "info", "message": format!("Closed via PS: {}", app_name) }),
        );
        Ok(json!({
            "ok": true,
            "status": "closed",
            "app_name": app_name
        }))
    } else {
        let _ = window.emit(
            "app-log",
            json!({ "level": "error", "message": format!("Failed to find or close '{}'", app_name) }),
        );
        Ok(json!({
            "ok": false,
            "status": "not_found",
            "app_name": app_name,
            "message": format!("I couldn't find a running app named '{}'.", app_name)
        }))
    }
}

#[tauri::command]
pub async fn close_app(app_name: String, window: Window) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let _ = window.emit(
        "app-log",
        json!({ "level": "info", "message": format!("Request to close: {}", app_name) }),
    );

    let lower_name = app_name.to_lowercase();
    let blocked_terms = [
        "powershell",
        "cmd.exe",
        "regedit",
        "format",
        "del ",
        "rmdir",
    ];

    if app_name.contains('\\')
        || app_name.contains('/')
        || app_name.contains(':')
        || app_name.contains(';')
        || blocked_terms.iter().any(|&term| lower_name.contains(term))
    {
        return Ok(json!({
            "ok": false,
            "status": "blocked_by_policy",
            "app_name": app_name,
            "message": "Pern cannot execute system commands."
        }));
    }

    #[cfg(target_os = "windows")]
    {
        let requested_apps = split_requested_app_names(&app_name);
        if requested_apps.is_empty() {
            return Ok(json!({
                "ok": false,
                "status": "not_found",
                "app_name": app_name
            }));
        }

        if requested_apps.len() == 1 {
            return close_single_app(&requested_apps[0], &window);
        }

        let mut closed_apps: Vec<String> = Vec::new();
        let mut missing_apps: Vec<String> = Vec::new();

        for requested in &requested_apps {
            let result = close_single_app(requested, &window)?;
            let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

            if ok {
                closed_apps.push(requested.to_string());
            } else {
                missing_apps.push(requested.to_string());
            }
        }

        if missing_apps.is_empty() {
            return Ok(json!({
                "ok": true,
                "status": "closed_multiple",
                "app_name": app_name,
                "message": format!("Closed {}.", closed_apps.join(", "))
            }));
        }

        if closed_apps.is_empty() {
            return Ok(json!({
                "ok": false,
                "status": "not_found",
                "app_name": app_name,
                "message": format!("I couldn't find running apps named {}.", missing_apps.join(", "))
            }));
        }

        Ok(json!({
            "ok": false,
            "status": "partial_success",
            "app_name": app_name,
            "message": format!("Closed {}. I couldn't find {} running.", closed_apps.join(", "), missing_apps.join(", "))
        }))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(json!({
            "ok": false,
            "status": "not_supported",
            "app_name": app_name,
            "message": "App management is not available on this platform."
        }))
    }
}

#[tauri::command]
pub async fn send_email(
    to: String,
    subject: String,
    body: String,
    window: Window,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config = state.config.lock().await;

    if !config.email_configured {
        let _ = window.emit(
            "app-log",
            json!({ "level": "error", "message": "Email not configured" }),
        );
        return Ok(json!({
            "ok": false,
            "status": "not_configured",
            "message": "Email is not configured. Please set up your email in settings first."
        }));
    }

    let email_config = crate::integrations::email::EmailConfig {
        smtp_host: config.email_smtp_host.clone(),
        smtp_port: config.email_smtp_port,
        sender_email: config.email_sender_email.clone(),
        smtp_password: config.email_smtp_password.clone(),
    };
    drop(config);

    let _ = window.emit(
        "app-log",
        json!({ "level": "info", "message": format!("Sending email to {}: {}", to, subject) }),
    );

    match crate::integrations::email::send_email(&email_config, &to, &subject, &body).await {
        Ok(()) => {
            let _ = window.emit(
                "app-log",
                json!({ "level": "info", "message": "Email sent successfully" }),
            );
            Ok(json!({
                "ok": true,
                "status": "sent",
                "to": to,
                "subject": subject
            }))
        }
        Err(e) => {
            let _ = window.emit(
                "app-log",
                json!({ "level": "error", "message": format!("Email failed: {}", e) }),
            );
            Ok(json!({
                "ok": false,
                "status": "send_failed",
                "error": e.to_string()
            }))
        }
    }
}

#[tauri::command]
pub async fn save_email_config(
    smtp_host: String,
    smtp_port: u16,
    sender_email: String,
    smtp_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.email_configured =
        !smtp_host.is_empty() && !sender_email.is_empty() && !smtp_password.is_empty();
    config.email_smtp_host = smtp_host;
    config.email_smtp_port = smtp_port;
    config.email_sender_email = sender_email;
    config.email_smtp_password = smtp_password;
    save_config(&config)?;
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
            println!("[SERVER] Android native library check: server_so={}, ggml_so={}, mtmd_so={}, installed={}",
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
                    println!("[SERVER] Detected and registered bundled llama-server at: {:?}", sidecar_exe);
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
                        println!("[SERVER] install_llama_server: Using bundled sidecar at {:?}", sidecar_exe);
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

    println!("[LLAMA-INSTALL] Downloading from: {}", download_url);

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

                println!("[LLAMA-INSTALL] Extracted: {}", file_name);
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

                println!("[LLAMA-INSTALL] Extracted: {}", file_name);
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

    println!(
        "[LLAMA-INSTALL] Installation complete at: {}",
        final_path_str
    );
    Ok(final_path_str)
}

/// SKILLS COMMANDS ##########################################

#[tauri::command]
pub async fn list_skills(state: State<'_, AppState>) -> Result<Vec<crate::skills::Skill>, String> {
    let _config = state.config.lock().await;
    let store = crate::skills::SkillStore::load();
    let mut skills: Vec<crate::skills::Skill> = store.skills.into_values().collect();
    skills.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
    drop(_config);
    Ok(skills)
}

#[tauri::command]
pub async fn get_skill(name: String) -> Result<crate::skills::Skill, String> {
    let store = crate::skills::SkillStore::load();
    store
        .skills
        .get(&name)
        .cloned()
        .ok_or_else(|| format!("Skill '{}' not found", name))
}

#[tauri::command]
pub async fn create_skill(
    name: String,
    description: String,
    trigger_patterns: Vec<String>,
    related_tools: Vec<String>,
    tags: Vec<String>,
    content: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    let skill = crate::skills::Skill {
        name: crate::skills::sanitize_skill_name(&name),
        description,
        version: "1.0.0".to_string(),
        author: "Pern User".to_string(),
        trigger_patterns,
        related_tools,
        tags,
        content,
        usage_count: 0,
        auto_generated: false,
    };
    let mut store = crate::skills::SkillStore::load();
    store.upsert(skill)
}

#[tauri::command]
pub async fn delete_skill(name: String) -> Result<(), String> {
    let mut store = crate::skills::SkillStore::load();
    store.remove(&name)
}

#[tauri::command]
pub async fn record_tool_usage(
    tool: String,
    args_summary: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    let mut skills_store = crate::skills::SkillStore::load();
    let mut learner = crate::learner::LearnerData::load();
    learner.record_tool_call(&tool, &args_summary, &mut skills_store)?;
    config.tool_usage_stats = learner.stats.clone();

    // Persist skills changes (auto-generated skills from pattern detection)
    // Also persist learner data
    crate::storage::save_config(&config)?;
    drop(config);

    Ok(())
}

#[tauri::command]
pub async fn get_learning_insights(
    _state: State<'_, AppState>,
) -> Result<Vec<crate::learner::LearnedInsight>, String> {
    let learner = crate::learner::LearnerData::load();
    Ok(learner.get_recent_insights(20))
}

#[tauri::command]
pub async fn get_tool_usage_summary(_state: State<'_, AppState>) -> Result<String, String> {
    let learner = crate::learner::LearnerData::load();
    Ok(learner.get_usage_summary())
}

#[tauri::command]
pub async fn set_user_preference(
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.user_preferences.insert(key, value);
    crate::storage::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn get_user_preferences(
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let config = state.config.lock().await;
    Ok(config.user_preferences.clone())
}

#[tauri::command]
pub async fn find_relevant_skills(input: String) -> Result<Vec<crate::skills::Skill>, String> {
    let store = crate::skills::SkillStore::load();
    let relevant: Vec<crate::skills::Skill> =
        store.find_relevant(&input).into_iter().cloned().collect();
    Ok(relevant)
}

#[tauri::command]
pub async fn record_skill_usage(name: String) -> Result<(), String> {
    let mut store = crate::skills::SkillStore::load();
    store.record_usage(&name)
}

/// CLI AGENT COMMANDS ########################################

#[tauri::command]
pub async fn get_cli_agents_status(
    state: State<'_, AppState>,
) -> Result<Vec<crate::integrations::cli_agents::AgentStateInfo>, String> {
    let _ = state.config.lock().await;
    Ok(state.cli_agent_manager.get_all_states().await)
}

#[tauri::command]
pub async fn configure_cli_agent(
    name: String,
    enabled: bool,
    binary_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cfg = crate::integrations::cli_agents::CLIAgentConfig {
        name: name.clone(),
        enabled,
        binary_path: binary_path.clone(),
        display_name: name.clone(),
    };
    state.cli_agent_manager.apply_configs(vec![cfg]).await;
    // Persist to config
    let mut config = state.config.lock().await;
    let configs = state.cli_agent_manager.get_all_states().await;
    config.cli_agent_configs = configs
        .into_iter()
        .map(|s| crate::integrations::cli_agents::CLIAgentConfig {
            name: s.name,
            enabled: s.enabled,
            binary_path: s.binary_path,
            display_name: s.display_name,
        })
        .collect();
    crate::storage::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn send_to_cli_agent(
    agent_name: String,
    prompt: String,
    project_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let normalized_agent_name = match agent_name.to_lowercase().trim() {
        "agy" | "antigravity" | "agye" => "agy".to_string(),
        "claude" | "claude-code" | "claude_code" | "claudecode" => "claude-code".to_string(),
        "codex" => "codex".to_string(),
        "hermes" => "hermes".to_string(),
        "freebuff" | "freebuf" => "freebuff".to_string(),
        other => other.to_string(),
    };

    // Resolve project directory if project_name is provided
    let project_dir = if let Some(ref pname) = project_name {
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
        drop(config);
        Some(path)
    } else {
        None
    };

    let result = state
        .cli_agent_manager
        .send_prompt(
            &normalized_agent_name,
            &prompt,
            project_dir.as_deref(),
            Some(crate::integrations::cli_agents::TaskOrigin::Local),
        )
        .await?;
    Ok(result)
}

/// PROJECT COMMANDS ##########################################

#[tauri::command]
pub async fn add_project(
    name: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    // Check for duplicate names
    if config.projects.iter().any(|p| p.name == name) {
        return Err(format!("Project '{}' already exists.", name));
    }
    config.projects.push(crate::storage::ProjectConfig {
        name: name.clone(),
        path: path.clone(),
    });
    crate::storage::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn remove_project(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock().await;
    let len_before = config.projects.len();
    config.projects.retain(|p| p.name != name);
    if config.projects.len() == len_before {
        return Err(format!("Project '{}' not found.", name));
    }
    crate::storage::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub async fn list_projects(
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::ProjectConfig>, String> {
    let config = state.config.lock().await;
    Ok(config.projects.clone())
}

/// INSIGHT MANAGEMENT COMMANDS ###############################

#[tauri::command]
pub async fn delete_learning_insight(index: usize) -> Result<(), String> {
    let mut learner = crate::learner::LearnerData::load();
    if index >= learner.insights.len() {
        return Err(format!(
            "Insight index {} out of bounds (max {})",
            index,
            learner.insights.len().saturating_sub(1)
        ));
    }
    learner.insights.remove(index);
    learner.save()?;
    Ok(())
}

#[tauri::command]
pub async fn clear_learning_insights() -> Result<(), String> {
    let mut learner = crate::learner::LearnerData::load();
    learner.insights.clear();
    learner.save()?;
    Ok(())
}

#[tauri::command]
pub async fn update_learning_insight(
    index: usize,
    insight: String,
    category: String,
    confidence: f64,
    related_tools: Vec<String>,
) -> Result<(), String> {
    let mut learner = crate::learner::LearnerData::load();
    if index >= learner.insights.len() {
        return Err(format!(
            "Insight index {} out of bounds (max {})",
            index,
            learner.insights.len().saturating_sub(1)
        ));
    }
    learner.insights[index] = crate::learner::LearnedInsight {
        category,
        insight,
        confidence,
        related_tools,
    };
    learner.save()?;
    Ok(())
}

#[tauri::command]
pub async fn restart_system(window: Window) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use std::process::Command;

    let _ = window.emit(
        "app-log",
        json!({ "level": "info", "message": "Request to restart the system." }),
    );

    #[cfg(target_os = "windows")]
    let res = {
        let mut shutdown_cmd = Command::new("shutdown");
        use std::os::windows::process::CommandExt;
        shutdown_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        shutdown_cmd.args(["/r", "/t", "0"]).output()
    };

    #[cfg(target_os = "macos")]
    let res = Command::new("osascript")
        .args(["-e", "tell app \"System Events\" to restart"])
        .output();

    #[cfg(target_os = "linux")]
    let res = Command::new("reboot").output();

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let res: Result<std::process::Output, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Other,
        "Restart is not supported on this platform.",
    ));

    match res {
        Ok(output) => {
            if output.status.success() {
                Ok(json!({ "ok": true, "status": "restarting", "message": "System is restarting..." }))
            } else {
                let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
                let _ = window.emit("app-log", json!({ "level": "error", "message": format!("Restart failed: {}", err_msg) }));
                Ok(json!({ "ok": false, "status": "failed", "message": format!("Failed to restart: {}", err_msg) }))
            }
        }
        Err(e) => {
            let err_msg = e.to_string();
            let _ = window.emit("app-log", json!({ "level": "error", "message": format!("Restart failed: {}", err_msg) }));
            Ok(json!({ "ok": false, "status": "failed", "message": format!("Failed to restart: {}", err_msg) }))
        }
    }
}

#[tauri::command]
pub async fn shutdown_system(window: Window) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use std::process::Command;

    let _ = window.emit(
        "app-log",
        json!({ "level": "info", "message": "Request to shut down the system." }),
    );

    #[cfg(target_os = "windows")]
    let res = {
        let mut shutdown_cmd = Command::new("shutdown");
        use std::os::windows::process::CommandExt;
        shutdown_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        shutdown_cmd.args(["/s", "/t", "0"]).output()
    };

    #[cfg(target_os = "macos")]
    let res = Command::new("osascript")
        .args(["-e", "tell app \"System Events\" to shut down"])
        .output();

    #[cfg(target_os = "linux")]
    let res = Command::new("poweroff").output();

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let res: Result<std::process::Output, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Other,
        "Shutdown is not supported on this platform.",
    ));

    match res {
        Ok(output) => {
            if output.status.success() {
                Ok(json!({ "ok": true, "status": "shutting_down", "message": "System is shutting down..." }))
            } else {
                let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
                let _ = window.emit("app-log", json!({ "level": "error", "message": format!("Shutdown failed: {}", err_msg) }));
                Ok(json!({ "ok": false, "status": "failed", "message": format!("Failed to shut down: {}", err_msg) }))
            }
        }
        Err(e) => {
            let err_msg = e.to_string();
            let _ = window.emit("app-log", json!({ "level": "error", "message": format!("Shutdown failed: {}", err_msg) }));
            Ok(json!({ "ok": false, "status": "failed", "message": format!("Failed to shut down: {}", err_msg) }))
        }
    }
}
