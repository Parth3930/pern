use reqwest::Client;

// ponytail: minimum viable send message
#[tauri::command]
pub async fn send_telegram_message(token: String, chat_id: String, text: String) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    Client::new()
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": text,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    Ok(())
}
