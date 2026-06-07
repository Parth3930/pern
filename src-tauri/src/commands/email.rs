use crate::state::AppState;
use crate::storage::save_config;
use serde_json::json;
use tauri::{State, Window, Emitter};

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
