import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { whatsappApi, WhatsAppContact, RecentChat } from "../integrations/whatsapp/api";
import { emailApi } from "../integrations/email/api";
import { discordApi } from "../integrations/discord/api";

export type { WhatsAppContact, RecentChat };

export interface AppConfig {
  model_dir: string;
  selected_model: string;
  provider: string;
  first_run_completed: boolean;
  email_configured: boolean;
  email_smtp_host: string;
  email_smtp_port: number;
  email_sender_email: string;
  email_smtp_password: string;
  whatsapp_enabled: boolean;
  whatsapp_contacts: WhatsAppContact[];
  llama_server_path: string;
  discord_enabled: boolean;
  discord_token: string;
  discord_status: string;
  discord_activity: string;
  discord_owner_id: string;
  discord_behaviour_channel_id: string;
  projects: ProjectConfig[];
}

export interface UserMemory {
  name: string | null;
  persona: string[];
  conversation_summary: string;
}

export interface ModelInfo {
  id: string;
  display_name: string;
  file_name: string;
  download_url: string;
  sha256?: string | null;
  tier: string;
  default: boolean;
  size_mb: number;
  recommended_ram_gb: number;
  context_length: number;
  estimated_memory: string;
  recommended_for: string;
}

export interface DownloadProgress {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface LlamaInstallProgress {
  stage: string;
  message: string;
  progress?: number;
  total?: number;
  downloaded?: number;
  path?: string;
}

export interface PlatformInfo {
  os: string;
  arch: string;
}

export interface ChatMessage {
  role: string;
  content: string;
  /**
   * Optional structured payload attached to an assistant message so the
   * renderer (MessageList) can show rich tool results — currently used for
   * long-term memory remember/recall/forget. When present, the renderer
   * paints a pill or list of cards next to the message body; the textual
   * `content` still contains the human-readable description.
   */
  memory_tool_results?: MemoryToolResult[];
  /**
   * Optional payload to render the planner view in chat history
   */
  harness_plan?: any;
}

export type MemoryToolResult =
  | {
      kind: "remember";
      key: string;
      value: string;
      category: string;
    }
  | {
      kind: "forget";
      key: string;
    }
  | {
      kind: "recall";
      query: string;
      hits: SearchHit[];
    };

export interface Skill {
  name: string;
  description: string;
  version: string;
  author: string;
  trigger_patterns: string[];
  related_tools: string[];
  tags: string[];
  content: string;
  usage_count: number;
  auto_generated: boolean;
}

export interface LearnedInsight {
  category: string;
  insight: string;
  confidence: number;
  related_tools: string[];
}

export interface CLIAgentConfig {
  name: string;
  enabled: boolean;
  binary_path: string;
  display_name: string;
}

export type AgentStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "not_found";

export interface ProjectConfig {
  name: string;
  path: string;
}

export interface AgentStateInfo {
  name: string;
  display_name: string;
  enabled: boolean;
  binary_path: string;
  status: AgentStatus;
  current_task: string | null;
  last_output: string | null;
  last_finished_at: number | null;
  binary_found: boolean;
}

// ---------------------------------------------------------------------------
// Long-term memory graph
// ---------------------------------------------------------------------------

export type EntityCategory =
  | "person"
  | "project"
  | "preference"
  | "recurring_task"
  | "other";

export interface Entity {
  id: string;
  category: EntityCategory;
  key: string;
  value: string;
  aliases: string[];
  source: string;
  created_at: number;
  updated_at: number;
}

export interface EntityPatch {
  category?: string;
  key?: string;
  value?: string;
  aliases?: string[];
  source?: string;
}

export interface Relation {
  from_id: string;
  to_id: string;
  label: string;
}

export interface SearchHit {
  entity: Entity;
  score: number;
}

export const api = {
  getOnboardingState: () => invoke<AppConfig>("get_onboarding_state"),
  listAvailableModels: () => invoke<ModelInfo[]>("list_available_models"),
  listInstalledModels: () => invoke<string[]>("list_installed_models"),
  deleteModel: (modelId: string) => invoke<void>("delete_model", { modelId }),
  chooseModel: (modelId: string) => invoke<void>("choose_model", { modelId }),
  chooseModelDir: (path: string) => invoke<void>("choose_model_dir", { path }),
  setFirstRunCompleted: (completed: boolean) =>
    invoke<void>("set_first_run_completed", { completed }),
  downloadModel: (modelId: string) =>
    invoke<void>("download_model", { modelId }),
  sendChatMessage: (modelId: string, messages: ChatMessage[], tools?: any) =>
    invoke<void>("send_chat_message", { modelId, messages, tools }),
  updateUserMemory: (memory: UserMemory) =>
    invoke<void>("update_user_memory", { memory }),
  getUserMemory: () => invoke<UserMemory>("get_user_memory"),
  startLlamaServer: (modelId: string) =>
    invoke<void>("start_llama_server", { modelId }),
  llamaServerHealth: () => invoke<boolean>("llama_server_health"),
  launchApp: (appName: string) => invoke<any>("launch_app", { appName }),
  closeApp: (appName: string) => invoke<any>("close_app", { appName }),
  restartSystem: () => invoke<any>("restart_system"),
  shutdownSystem: () => invoke<any>("shutdown_system"),
  checkLlamaInstalled: () => invoke<boolean>("check_llama_installed"),
  installLlamaServer: (force?: boolean) =>
    invoke<string>("install_llama_server", { force }),
  getPlatformInfo: () => invoke<PlatformInfo>("get_platform_info"),
  requestAndroidNotificationPermission: () =>
    invoke<boolean>("request_android_notification_permission"),

  onDownloadProgress: (cb: (progress: DownloadProgress) => void) =>
    listen<DownloadProgress>("model-download-progress", (e) => cb(e.payload)),
  onDownloadComplete: (cb: (modelId: string) => void) =>
    listen<string>("model-download-complete", (e) => cb(e.payload)),

  onAppLog: (cb: (log: { level: string; message: string }) => void) =>
    listen<{ level: string; message: string }>("app-log", (e) => cb(e.payload)),

  onLlamaInstallProgress: (cb: (progress: LlamaInstallProgress) => void) =>
    listen<LlamaInstallProgress>("llama-install-progress", (e) =>
      cb(e.payload),
    ),

  onChatToken: async (cb: (token: string) => void) => {
    return await listen<string>("chat-token", (e) => cb(e.payload));
  },
  onChatComplete: async (cb: () => void) => {
    return await listen<void>("chat-complete", () => cb());
  },

  ...whatsappApi,
  ...emailApi,
  ...discordApi,

  // Skills & Learning API
  listSkills: () => invoke<Skill[]>("list_skills"),
  getSkill: (name: string) => invoke<Skill>("get_skill", { name }),
  createSkill: (
    name: string,
    description: string,
    triggerPatterns: string[],
    relatedTools: string[],
    tags: string[],
    content: string,
  ) =>
    invoke<void>("create_skill", {
      name,
      description,
      triggerPatterns,
      relatedTools,
      tags,
      content,
    }),
  deleteSkill: (name: string) => invoke<void>("delete_skill", { name }),
  recordToolUsage: (tool: string, argsSummary: string) =>
    invoke<void>("record_tool_usage", { tool, argsSummary }),
  getLearningInsights: () => invoke<LearnedInsight[]>("get_learning_insights"),
  getToolUsageSummary: () => invoke<string>("get_tool_usage_summary"),
  setUserPreference: (key: string, value: string) =>
    invoke<void>("set_user_preference", { key, value }),
  getUserPreferences: () =>
    invoke<Record<string, string>>("get_user_preferences"),
  findRelevantSkills: (input: string) =>
    invoke<Skill[]>("find_relevant_skills", { input }),
  recordSkillUsage: (name: string) =>
    invoke<void>("record_skill_usage", { name }),

  // Insight Management
  deleteLearningInsight: (index: number) =>
    invoke<void>("delete_learning_insight", { index }),
  clearLearningInsights: () =>
    invoke<void>("clear_learning_insights"),    updateLearningInsight: (
    index: number,
    insight: string,
    category: string,
    confidence: number,
    relatedTools: string[],
  ) =>
    invoke<void>("update_learning_insight", {
      index,
      insight,
      category,
      confidence,
      relatedTools,
    }),

  // CLI Agent Management
  getCLIAgentsStatus: () => invoke<AgentStateInfo[]>("get_cli_agents_status"),
  configureCLIAgent: (name: string, enabled: boolean, binaryPath: string) =>
    invoke<void>("configure_cli_agent", { name, enabled, binaryPath }),
  sendToCLIAgent: (agentName: string, prompt: string, projectName?: string) =>
    invoke<string>("send_to_cli_agent", { agentName, prompt, projectName: projectName || null }),

  // Project Management
  addProject: (name: string, path: string) =>
    invoke<void>("add_project", { name, path }),
  removeProject: (name: string) =>
    invoke<void>("remove_project", { name }),
  read_file: (path: string, projectName: string) => invoke<string>("read_file", { path, projectName }),
  list_dir: (path: string, projectName: string) => invoke<string>("list_dir", { path, projectName }),
  webSearch: (query: string) => invoke<string>("web_search", { query }),
  listProjects: () => invoke<ProjectConfig[]>("list_projects"),

  // Windows Autostart
  getAutostart: () => invoke<boolean>("get_autostart"),
  setAutostart: (enabled: boolean) => invoke<void>("set_autostart", { enabled }),

  // Todos persistence
  getTodos: () => invoke<any[]>("get_todos"),
  saveTodos: (todos: any[]) => invoke<void>("save_todos", { todos }),

  // Long-term memory graph
  memoryListEntities: (category?: string) =>
    invoke<Entity[]>("memory_list_entities", { category: category ?? null }),
  memoryGetEntity: (id: string) =>
    invoke<Entity | null>("memory_get_entity", { id }),
  memoryAddEntity: (
    category: string,
    key: string,
    value: string,
    aliases?: string[],
  ) =>
    invoke<Entity>("memory_add_entity", {
      category,
      key,
      value,
      aliases: aliases ?? null,
    }),
  memoryUpdateEntity: (id: string, patch: EntityPatch) =>
    invoke<Entity>("memory_update_entity", { id, patch }),
  memoryDeleteEntity: (id: string) =>
    invoke<void>("memory_delete_entity", { id }),
  memorySearch: (query: string, k?: number) =>
    invoke<SearchHit[]>("memory_search", { query, k: k ?? null }),
  memoryAddRelation: (fromId: string, toId: string, label: string) =>
    invoke<Relation>("memory_add_relation", { fromId, toId, label }),
  memoryDeleteRelation: (fromId: string, toId: string, label: string) =>
    invoke<void>("memory_delete_relation", { fromId, toId, label }),
  memoryListRelations: (fromId?: string) =>
    invoke<Relation[]>("memory_list_relations", { fromId: fromId ?? null }),

  // Chat-session summary helpers
  clearConversationSummary: () =>
    invoke<void>("clear_conversation_summary"),

  // Minecraft integration
  detectMinecraftLanPort: () => invoke<number | null>("detect_minecraft_lan_port"),
  joinMinecraftWorld: (port?: number, host?: string, version?: string) => invoke<string>("join_minecraft_world", { port: port ?? null, host: host ?? null, version: version ?? null }),
  disconnectMinecraftWorld: () => invoke<string>("disconnect_minecraft_world"),
  getMinecraftStatus: () => invoke<boolean>("get_minecraft_status"),

  onCLIAgentComplete: (
    cb: (data: {
      agent: string;
      status: string;
      task: string;
      output: string;
      summary?: string;
    }) => void,
  ) =>
    listen<{
      agent: string;
      status: string;
      task: string;
      output: string;
      summary?: string;
    }>("cli-agent-complete", (e) => cb(e.payload)),
};
