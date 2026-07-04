use reqwest::Client;

// ponytail: minimum viable slack webhook
#[tauri::command]
pub async fn send_slack_message(webhook_url: String, text: String) -> Result<(), String> {
    Client::new()
        .post(&webhook_url)
        .json(&serde_json::json!({
            "text": text,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    Ok(())
}
