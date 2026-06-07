use serde_json::json;
use std::collections::HashSet;
use tauri::{Window, Emitter};

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

    let final_lower = name.to_lowercase();
    if final_lower == "file manager"
        || final_lower == "filemanager"
        || final_lower == "files"
        || final_lower == "file explorer"
    {
        name = "explorer".to_string();
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
        let _ = window;
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
        let _ = window;
        Ok(json!({
            "ok": false,
            "status": "not_supported",
            "app_name": app_name,
            "message": "App management is not available on this platform."
        }))
    }
}

#[tauri::command]
pub async fn restart_system(window: Window) -> Result<serde_json::Value, String> {
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

#[tauri::command]
pub async fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;

        // Skip autostart registry modifications in debug/dev mode
        if cfg!(debug_assertions) {
            tracing::info!("[AUTOSTART] Autostart registration is bypassed in debug/dev mode.");
            return Ok(());
        }

        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get current executable path: {}", e))?;
        let exe_path_str = exe_path.to_string_lossy();

        if enabled {
            let mut cmd = Command::new("reg");
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            let status = cmd
                .args(&[
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    "Pern",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &format!("\"{}\"", exe_path_str),
                    "/f",
                ])
                .status()
                .map_err(|e| format!("Failed to execute reg.exe: {}", e))?;

            if !status.success() {
                return Err("reg.exe command failed to add autostart entry".to_string());
            }
        } else {
            let mut cmd = Command::new("reg");
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            let _ = cmd
                .args(&[
                    "delete",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    "Pern",
                    "/f",
                ])
                .status();
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err("Autostart is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub async fn get_autostart() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("reg");
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let output = cmd
            .args(&[
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v",
                "Pern",
            ])
            .output()
            .map_err(|e| format!("Failed to execute reg.exe: {}", e))?;

        Ok(output.status.success())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}
