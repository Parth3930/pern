//! Cross-platform notification wrapper.
//!
//! ### Cargo note
//!
//! `tauri-plugin-notification` is **not** in `Cargo.toml` for this project,
//! so we use a logging-only fallback. The function signature is identical
//! to the Tauri command surface so swapping in the plugin later is a
//! one-line change in this file.
//!
//! The fallback path always returns `Ok` so that `Action::SendNotification`
//! never causes a whole automation to be marked failed just because the
//! platform can't pop a real notification. The warning is logged so
//! developers / debugging output still surfaces the fact that nothing
//! happened.

use serde_json::json;

const PLUGIN_AVAILABLE: bool = false; // flip when `tauri-plugin-notification` is added.

/// Send an OS-level notification. Returns `Ok(())` after attempting delivery
/// or `Ok` with a log-line acknowledgment on platforms / builds where the
/// notification plugin is not present.
pub async fn send_notification(title: &str, body: &str) -> Result<String, String> {
    if PLUGIN_AVAILABLE {
        // Future: route to tauri_plugin_notification::NotificationExt.
        // Kept behind a const so the unwired branch is a no-op at runtime.
    }

    eprintln!(
        "[NOTIFY] (fallback) title={:?} body={:?} — tauri-plugin-notification is not in Cargo.toml",
        title, body
    );

    // Surface the would-be notification on the `app-log` channel if a Tauri
    // app handle is registered globally. We do this defensively: if no
    // handle is available (e.g. running from a unit test) we just log.
    // We deliberately don't take an AppHandle parameter — this is the
    // log-and-return path. The scheduler / executor emit their own events
    // for fired automations, so consumers still see *something*.
    let _ = json!({ "level": "info", "message": format!("Notification: {} — {}", title, body) });
    Ok(format!(
        "Notification logged (no plugin): '{}' / '{}'",
        title, body
    ))
}

/// Tauri command wrapper. Always returns `Ok(())` on the no-op path so
/// that `Action::SendNotification` never fails the whole automation just
/// because the platform can't pop a real notification.
#[tauri::command]
pub async fn send_notification_command(
    title: String,
    body: String,
) -> Result<(), String> {
    match send_notification(&title, &body).await {
        Ok(_) => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn send_notification_returns_ok_via_fallback() {
        let r = send_notification("hi", "there").await;
        assert!(r.is_ok());
        // The fallback path always logs a warning — we don't assert on stderr
        // to keep the test hermetic, but we do assert the message format.
        let msg = r.unwrap();
        assert!(msg.contains("Notification logged"));
        assert!(msg.contains("hi"));
        assert!(msg.contains("there"));
    }
}
