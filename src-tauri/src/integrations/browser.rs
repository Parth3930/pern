use headless_chrome::Browser;

// ponytail: minimum viable headless browser web research
#[tauri::command]
pub fn browser_research(url: String) -> Result<String, String> {
    let browser = Browser::default().map_err(|e| e.to_string())?;
    let tab = browser.new_tab().map_err(|e| e.to_string())?;
    tab.navigate_to(&url).map_err(|e| e.to_string())?;
    tab.wait_until_navigated().map_err(|e| e.to_string())?;
    
    let remote_object = tab.evaluate("document.body.innerText", false).map_err(|e| e.to_string())?;
    let value = remote_object.value.ok_or_else(|| "No content".to_string())?;
    Ok(value.as_str().unwrap_or("").to_string())
}
