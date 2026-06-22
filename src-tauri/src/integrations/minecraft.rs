// ponytail: minimal Rust backend module for Minecraft bot integration
use std::net::{UdpSocket, Ipv4Addr};
use std::time::Duration;
use std::process::Child;
use std::sync::{Mutex, OnceLock};

static MINECRAFT_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn get_minecraft_process() -> &'static Mutex<Option<Child>> {
    MINECRAFT_PROCESS.get_or_init(|| Mutex::new(None))
}

// ponytail: Scan UDP multicast for Minecraft LAN world port
#[tauri::command]
pub fn detect_minecraft_lan_port() -> Option<u16> {
    let socket = UdpSocket::bind("0.0.0.0:4445").ok()?;
    socket.set_read_timeout(Some(Duration::from_millis(500))).ok()?;
    socket.join_multicast_v4(
        &Ipv4Addr::new(224, 0, 2, 60),
        &Ipv4Addr::new(0, 0, 0, 0),
    ).ok()?;

    let mut buf = [0u8; 1024];
    if let Ok((amt, _)) = socket.recv_from(&mut buf) {
        let msg = String::from_utf8_lossy(&buf[..amt]);
        if let Some(ad_start) = msg.find("[AD]") {
            if let Some(ad_end) = msg.find("[/AD]") {
                let port_str = &msg[ad_start + 4..ad_end];
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    return Some(port);
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn join_minecraft_world(port: Option<u16>, version: Option<String>) -> Result<String, String> {
    // Kill existing process if running
    let mut proc_lock = get_minecraft_process().lock().unwrap();
    if let Some(mut old_child) = proc_lock.take() {
        let _ = old_child.kill();
    }

    // Detect port if none is passed (or is 0)
    let final_port = match port {
        Some(p) if p > 0 => p,
        _ => detect_minecraft_lan_port().unwrap_or(25565),
    };

    let final_version = version.unwrap_or_else(|| "1.20.4".to_string());

    let script_path = if std::path::Path::new("scripts/minecraft_bot.cjs").exists() {
        "scripts/minecraft_bot.cjs"
    } else {
        "../scripts/minecraft_bot.cjs"
    };

    let mut cmd = std::process::Command::new("node");
    cmd.arg(script_path)
       .arg(final_port.to_string())
       .arg("localhost")
       .arg("Pern")
       .arg(final_version);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    match cmd.spawn() {
        Ok(child) => {
            *proc_lock = Some(child);
            Ok(format!("Successfully spawned Minecraft bot on port {}", final_port))
        }
        Err(e) => Err(format!("Failed to spawn bot: {}", e)),
    }
}

#[tauri::command]
pub async fn disconnect_minecraft_world() -> Result<String, String> {
    let mut proc_lock = get_minecraft_process().lock().unwrap();
    if let Some(mut child) = proc_lock.take() {
        match child.kill() {
            Ok(_) => Ok("Minecraft bot disconnected.".to_string()),
            Err(e) => Err(format!("Failed to kill bot process: {}", e)),
        }
    } else {
        Ok("Bot was not connected.".to_string())
    }
}

#[tauri::command]
pub fn get_minecraft_status() -> bool {
    let mut proc_lock = get_minecraft_process().lock().unwrap();
    if let Some(ref mut child) = *proc_lock {
        match child.try_wait() {
            Ok(None) => true, // Still running
            _ => {
                *proc_lock = None; // Already exited
                false
            }
        }
    } else {
        false
    }
}
