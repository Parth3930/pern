use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

/// Canonical agent names
pub const AGENT_CLAUDE_CODE: &str = "claude-code";
pub const AGENT_CODEX: &str = "codex";
pub const AGENT_HERMES: &str = "hermes";
pub const AGENT_FREEBUFF: &str = "freebuff";
pub const AGENT_AGY: &str = "agy";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum TaskOrigin {
    Local,
    Discord {
        channel_id: String,
        message_id: String,
    },
}

struct AgentLaunchSpec {
    args: Vec<String>,
    stdin_input: Option<String>,
}

struct AgentCompletion {
    status: &'static str,
    task: String,
    output: String,
    summary: Option<String>,
    origin: Option<TaskOrigin>,
}

fn build_launch_spec(
    agent_name: &str,
    prompt: &str,
    working_dir: &Path,
) -> Result<AgentLaunchSpec, String> {
    match agent_name {
        AGENT_CODEX => Ok(AgentLaunchSpec {
            args: vec!["exec".to_string()],
            stdin_input: Some(prompt.to_string()),
        }),
        AGENT_AGY => Ok(AgentLaunchSpec {
            args: vec![
                "--add-dir".to_string(),
                working_dir.display().to_string(),
                "--dangerously-skip-permissions".to_string(),
                "--print".to_string(),
                prompt.to_string(),
            ],
            stdin_input: None,
        }),
        AGENT_FREEBUFF => Err(
            "Agent 'freebuff' only exposes an interactive CLI. Pern cannot send it a one-shot task and wait for a final response. Launch Freebuff directly in a terminal instead."
                .to_string(),
        ),
        _ => Ok(AgentLaunchSpec {
            args: Vec::new(),
            stdin_input: Some(prompt.to_string()),
        }),
    }
}

pub fn default_agents() -> Vec<CLIAgentConfig> {
    vec![
        CLIAgentConfig {
            name: AGENT_CLAUDE_CODE.to_string(),
            enabled: false,
            binary_path: "claude".to_string(),
            display_name: "Claude Code".to_string(),
        },
        CLIAgentConfig {
            name: AGENT_CODEX.to_string(),
            enabled: false,
            binary_path: "codex".to_string(),
            display_name: "Codex".to_string(),
        },
        CLIAgentConfig {
            name: AGENT_HERMES.to_string(),
            enabled: false,
            binary_path: "hermes".to_string(),
            display_name: "Hermes".to_string(),
        },
        CLIAgentConfig {
            name: AGENT_FREEBUFF.to_string(),
            enabled: false,
            binary_path: "freebuff".to_string(),
            display_name: "Freebuff".to_string(),
        },
        CLIAgentConfig {
            name: AGENT_AGY.to_string(),
            enabled: false,
            binary_path: "agy".to_string(),
            display_name: "Antigravity".to_string(),
        },
    ]
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CLIAgentConfig {
    pub name: String,
    pub enabled: bool,
    pub binary_path: String,
    pub display_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum AgentStatus {
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "not_found")]
    NotFound,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentStateInfo {
    pub name: String,
    pub display_name: String,
    pub enabled: bool,
    pub binary_path: String,
    pub status: AgentStatus,
    pub current_task: Option<String>,
    pub last_output: Option<String>,
    pub last_finished_at: Option<i64>, // unix millis
    pub binary_found: bool,
}

#[derive(Debug)]
pub(crate) struct ManagedAgent {
    pub config: CLIAgentConfig,
    pub binary_found: bool,
    pub process: Option<Child>,
    pub status: AgentStatus,
    pub current_task: Option<String>,
    pub last_output: Option<String>,
    pub last_finished_at: Option<Instant>,
    pub working_dir: Option<PathBuf>,
    pub origin: Option<TaskOrigin>,
}

impl ManagedAgent {
    pub fn new(config: CLIAgentConfig) -> Self {
        Self {
            binary_found: check_binary_exists(&config.binary_path),
            config,
            process: None,
            status: AgentStatus::Idle,
            current_task: None,
            last_output: None,
            last_finished_at: None,
            working_dir: None,
            origin: None,
        }
    }

    pub fn info(&self) -> AgentStateInfo {
        AgentStateInfo {
            name: self.config.name.clone(),
            display_name: self.config.display_name.clone(),
            enabled: self.config.enabled,
            binary_path: self.config.binary_path.clone(),
            status: self.status.clone(),
            current_task: self.current_task.clone(),
            last_output: self.last_output.clone(),
            last_finished_at: self.last_finished_at.map(|i| i.elapsed().as_millis() as i64),
            binary_found: self.binary_found,
        }
    }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

pub struct CLIAgentManager {
    agents: Mutex<HashMap<String, ManagedAgent>>,
}

impl CLIAgentManager {
    pub fn new() -> Self {
        let agents: HashMap<String, ManagedAgent> = default_agents()
            .into_iter()
            .map(|cfg| (cfg.name.clone(), ManagedAgent::new(cfg)))
            .collect();
        Self {
            agents: Mutex::new(agents),
        }
    }

    /// Apply config overrides from persisted settings (keeps runtime state intact)
    pub async fn apply_configs(&self, configs: Vec<CLIAgentConfig>) {
        let mut map = self.agents.lock().await;
        for cfg in configs {
            if let Some(agent) = map.get_mut(&cfg.name) {
                agent.config.enabled = cfg.enabled;
                agent.config.binary_path = cfg.binary_path.clone();
                agent.config.display_name = cfg.display_name.clone();
                agent.binary_found = check_binary_exists(&cfg.binary_path);
            } else {
                map.insert(cfg.name.clone(), ManagedAgent::new(cfg));
            }
        }
    }

    /// Get snapshot of all agent states
    pub async fn get_all_states(&self) -> Vec<AgentStateInfo> {
        let map = self.agents.lock().await;
        let mut states: Vec<AgentStateInfo> = map.values().map(|a| a.info()).collect();
        states.sort_by(|a, b| a.name.cmp(&b.name));
        states
    }

    /// Send a prompt to an agent (if enabled & binary found)
    /// If project_dir is provided, the agent process will be spawned in that directory.
    pub async fn send_prompt(
        &self,
        agent_name: &str,
        prompt: &str,
        project_dir: Option<&Path>,
        origin: Option<TaskOrigin>,
    ) -> Result<String, String> {
        let mut map = self.agents.lock().await;
        let agent = map
            .get_mut(agent_name)
            .ok_or_else(|| format!("Agent '{}' not found", agent_name))?;

        if !agent.config.enabled {
            return Err(format!(
                "Agent '{}' is disabled. Enable it in settings first.",
                agent_name
            ));
        }

        if !agent.binary_found {
            return Err(format!(
                "Binary '{}' for agent '{}' not found on PATH. Configure the correct path in settings.",
                agent.config.binary_path, agent_name
            ));
        }

        if agent.status == AgentStatus::Running {
            let _ = poll_agent_completion(agent);
        }

        if agent.status == AgentStatus::Running {
            return Err(format!(
                "Agent '{}' is already running a task. Wait for it to finish.",
                agent_name
            ));
        }

        let working_dir = resolve_working_dir(project_dir);

        // Delete existing pern.md in the working directory before launching the agent
        let pern_md_path = working_dir.join("pern.md");
        if pern_md_path.exists() {
            let _ = std::fs::remove_file(&pern_md_path);
        }

        // Wrap prompt to request a pern.md summary
        let wrapped_prompt = format!(
            "{}\n\n[System Instruction: Once you finish the task, you MUST create or overwrite a file named 'pern.md' in the root of the project directory. In this 'pern.md' file, write a clear, detailed, and human-readable Markdown summary of all the actions you took, files modified, and results of the task. Do not include extra conversational text in the file, just the summary.]",
            prompt
        );

        let launch = build_launch_spec(agent_name, &wrapped_prompt, &working_dir)?;
        let agent_name_owned = agent_name.to_string();

        let mut command = Command::new(&agent.config.binary_path);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        command
            .current_dir(&working_dir)
            .args(&launch.args)
            .env_remove("ANTIGRAVITY_AGENT")
            .env_remove("ANTIGRAVITY_LS_ADDRESS")
            .env_remove("ANTIGRAVITY_TRAJECTORY_ID")
            .stdin(if launch.stdin_input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        println!("[CLI AGENT] Spawning process: {:?} {:?}", command.get_program(), command.get_args());
        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn '{}': {}", agent.config.binary_path, e))?;
        println!("[CLI AGENT] Spawned successfully with PID: {:?}", child.id());

        if let Some(input) = launch.stdin_input {
            if let Some(ref mut stdin) = child.stdin {
                let mut payload = input;
                payload.push('\n');
                let _ = stdin.write_all(payload.as_bytes());
            }
            drop(child.stdin.take());
        }

        agent.process = Some(child);
        agent.status = AgentStatus::Running;
        agent.current_task = Some(prompt.to_string()); // Original prompt
        agent.working_dir = Some(working_dir);
        agent.origin = origin;

        Ok(agent_name_owned)
    }

    /// Clean up finished processes. Call from a periodic tick or after spawning.
    pub async fn reap_finished(&self, app_handle: tauri::AppHandle, state: crate::AppState) {
        let mut map = self.agents.lock().await;
        for (name, agent) in map.iter_mut() {
            let Some(completion) = poll_agent_completion(agent) else {
                continue;
            };

            println!("[CLI AGENT] Agent {} finished, emitting event. Status: {}, Output len: {}", name, completion.status, completion.output.len());
            let _ = app_handle.emit(
                "cli-agent-complete",
                serde_json::json!({
                    "agent": name,
                    "status": completion.status,
                    "task": completion.task,
                    "output": completion.output,
                    "summary": completion.summary,
                }),
            );

            // Notify Discord if requested
            if let Some(TaskOrigin::Discord { channel_id, message_id }) = completion.origin {
                let status_emoji = if completion.status == "completed" { "✅" } else { "❌" };
                let summary_text = if let Some(ref sum) = completion.summary {
                    format!("\n\n**Summary of changes:**\n{}", sum)
                } else {
                    String::new()
                };

                let mut reply_text = format!(
                    "{} **Agent '{}' has finished executing the task.**\n> **Task:** {}\n> **Status:** {}{}",
                    status_emoji,
                    name,
                    completion.task,
                    completion.status,
                    summary_text
                );

                if completion.summary.is_none() && !completion.output.is_empty() {
                    let snippet = if completion.output.len() > 1000 {
                        format!("{}...", &completion.output[..1000])
                    } else {
                        completion.output.clone()
                    };
                    reply_text.push_str(&format!("\n\n**Output:**\n```\n{}\n```", snippet));
                }

                if reply_text.len() > 1950 {
                    reply_text = reply_text.chars().take(1950).collect::<String>();
                    reply_text.push_str("...\n*(Truncated due to length)*");
                }

                let state_clone = state.clone();
                let channel_id_clone = channel_id.clone();
                let message_id_clone = message_id.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = crate::integrations::discord::send_discord_reply_outside(
                        &channel_id_clone,
                        &message_id_clone,
                        &reply_text,
                        &state_clone,
                    ).await {
                        println!("[CLI AGENT] Failed to send Discord reply: {}", e);
                    }
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn resolve_working_dir(project_dir: Option<&Path>) -> PathBuf {
    let requested = project_dir
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let canonical = requested.canonicalize().unwrap_or(requested);
    if cfg!(target_os = "windows") {
        let path_str = canonical.to_string_lossy();
        if path_str.starts_with(r"\\?\") {
            return PathBuf::from(&path_str[4..]);
        }
    }
    canonical
}

fn check_binary_exists(binary_path: &str) -> bool {
    let (cmd, arg) = if cfg!(target_os = "windows") {
        ("where", binary_path)
    } else {
        ("which", binary_path)
    };
    let mut check_cmd = Command::new(cmd);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        check_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    check_cmd
        .arg(arg)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn poll_agent_completion(agent: &mut ManagedAgent) -> Option<AgentCompletion> {
    if agent.status != AgentStatus::Running {
        return None;
    }

    let Some(mut child) = agent.process.take() else {
        agent.status = AgentStatus::Idle;
        return None;
    };

    match child.try_wait() {
        Ok(Some(_)) => {
            let (succeeded, output) = capture_child_output(child);
            agent.status = if succeeded {
                AgentStatus::Completed
            } else {
                AgentStatus::Failed
            };
            agent.last_output = Some(output.clone());
            agent.last_finished_at = Some(Instant::now());

            // Read pern.md summary file if it exists in working directory
            let mut summary = None;
            if let Some(ref dir) = agent.working_dir {
                let pern_md_path = dir.join("pern.md");
                if pern_md_path.exists() {
                    if let Ok(content) = std::fs::read_to_string(&pern_md_path) {
                        summary = Some(content.trim().to_string());
                    }
                }
            }

            let origin = agent.origin.take();
            Some(AgentCompletion {
                status: if succeeded { "completed" } else { "failed" },
                task: agent.current_task.clone().unwrap_or_default(),
                output,
                summary,
                origin,
            })
        }
        Ok(None) => {
            agent.process = Some(child);
            None
        }
        Err(e) => {
            let output = format!("Failed to check agent process status: {}", e);
            agent.status = AgentStatus::Failed;
            agent.last_output = Some(output.clone());
            agent.last_finished_at = Some(Instant::now());
            let origin = agent.origin.take();
            Some(AgentCompletion {
                status: "failed",
                task: agent.current_task.clone().unwrap_or_default(),
                output,
                summary: None,
                origin,
            })
        }
    }
}

fn capture_child_output(child: Child) -> (bool, String) {
    match child.wait_with_output() {
        Ok(output) => (
            output.status.success(),
            combine_process_output(&output.stdout, &output.stderr),
        ),
        Err(e) => (
            false,
            format!("Process finished but output could not be captured: {}", e),
        ),
    }
}

fn combine_process_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stdout_text = String::from_utf8_lossy(stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(stderr).trim().to_string();

    match (stdout_text.is_empty(), stderr_text.is_empty()) {
        (false, true) => stdout_text,
        (true, false) => stderr_text,
        (false, false) => format!("stdout:\n{}\n\nstderr:\n{}", stdout_text, stderr_text),
        (true, true) => String::new(),
    }
}
