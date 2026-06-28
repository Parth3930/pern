# Graph Report - .  (2026-06-28)

## Corpus Check
- 177 files · ~189,821 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 763 nodes · 1424 edges · 28 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 341 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_App Setup and Settings|App Setup and Settings]]
- [[_COMMUNITY_Discord Integration|Discord Integration]]
- [[_COMMUNITY_WhatsApp and Local Models|WhatsApp and Local Models]]
- [[_COMMUNITY_Memory Graph Storage|Memory Graph Storage]]
- [[_COMMUNITY_Chat and Rust Bridge|Chat and Rust Bridge]]
- [[_COMMUNITY_Automation Scheduler|Automation Scheduler]]
- [[_COMMUNITY_Execution and Notifications|Execution and Notifications]]
- [[_COMMUNITY_Learning and Skills|Learning and Skills]]
- [[_COMMUNITY_Chat Logic and Tools|Chat Logic and Tools]]
- [[_COMMUNITY_CLI Agents and Projects|CLI Agents and Projects]]
- [[_COMMUNITY_Automation Data Models|Automation Data Models]]
- [[_COMMUNITY_Storage and Configuration|Storage and Configuration]]
- [[_COMMUNITY_Android Web Chrome|Android Web Chrome]]
- [[_COMMUNITY_Trigger and Cron Logic|Trigger and Cron Logic]]
- [[_COMMUNITY_Android Wry Activity|Android Wry Activity]]
- [[_COMMUNITY_Tools Parsing|Tools Parsing]]
- [[_COMMUNITY_Android Tauri Activity|Android Tauri Activity]]
- [[_COMMUNITY_Android WebView|Android WebView]]
- [[_COMMUNITY_Android Main Activity|Android Main Activity]]
- [[_COMMUNITY_Android Keep Alive Service|Android Keep Alive Service]]
- [[_COMMUNITY_Android Permission Helper|Android Permission Helper]]
- [[_COMMUNITY_Android WebView Client|Android WebView Client]]
- [[_COMMUNITY_Chat Data Models|Chat Data Models]]
- [[_COMMUNITY_Chat Input UI|Chat Input UI]]
- [[_COMMUNITY_Android Build Task|Android Build Task]]
- [[_COMMUNITY_Android Rust Plugin|Android Rust Plugin]]
- [[_COMMUNITY_Tools Data Types|Tools Data Types]]
- [[_COMMUNITY_Android IPC|Android IPC]]

## God Nodes (most connected - your core abstractions)
1. `error()` - 40 edges
2. `execute_discord_tool_call()` - 31 edges
3. `save_config()` - 27 edges
4. `Rust` - 23 edges
5. `fresh_graph()` - 23 edges
6. `RustWebChromeClient` - 19 edges
7. `discord_api_call()` - 17 edges
8. `MemoryGraph` - 15 edges
9. `AutomationManager` - 14 edges
10. `internal_start_whatsapp_session()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `clear_conversation_summary()` --calls--> `save_config()`  [INFERRED]
  D:\agent\pern\src-tauri\src\commands\memory.rs → D:\agent\pern\src-tauri\src\storage.rs
- `add_project()` --calls--> `save_config()`  [INFERRED]
  D:\agent\pern\src-tauri\src\commands\projects.rs → D:\agent\pern\src-tauri\src\storage.rs
- `remove_project()` --calls--> `save_config()`  [INFERRED]
  D:\agent\pern\src-tauri\src\commands\projects.rs → D:\agent\pern\src-tauri\src\storage.rs
- `exec_add_todo()` --calls--> `save_todos()`  [INFERRED]
  D:\agent\pern\src-tauri\src\automations\executor.rs → D:\agent\pern\src-tauri\src\commands\todos.rs
- `loadState()` --calls--> `error()`  [INFERRED]
  D:\agent\pern\src\App.tsx → D:\agent\pern\src-tauri\gen\android\app\src\main\java\com\pern\app\generated\Logger.kt

## Communities

### Community 0 - "App Setup and Settings"
Cohesion: 0.04
Nodes (51): handleOnboardingComplete(), loadState(), refreshConfig(), setupContactsListener(), handleProcess(), processImage(), error(), requestNotificationPermission() (+43 more)

### Community 1 - "Discord Integration"
Cohesion: 0.08
Nodes (57): ChatPromptOptions, request_frontend_reply(), discord_api_call(), discord_assign_role(), discord_ban(), discord_delete_messages(), discord_get_channels(), discord_get_guilds() (+49 more)

### Community 2 - "WhatsApp and Local Models"
Cohesion: 0.06
Nodes (50): save_email_config(), update_memory(), UserMemory, check_llama_installed(), choose_model(), choose_model_dir(), delete_model(), DownloadProgress (+42 more)

### Community 3 - "Memory Graph Storage"
Cohesion: 0.08
Nodes (41): unsupported_action_deserializes_and_skips(), clear_conversation_summary(), Entity, EntityCategory, EntityPatch, fresh_graph(), generate_id(), get_memory_graph_path() (+33 more)

### Community 4 - "Chat and Rust Bridge"
Cohesion: 0.04
Nodes (10): Chat(), Logger, warn(), Rust, playBeep(), useSpeech(), useChatServer(), useCLIAgentEvents() (+2 more)

### Community 5 - "Automation Scheduler"
Cohesion: 0.07
Nodes (33): create_automation(), delete_automation(), get_automation(), get_run_history(), list_automations(), run_automation_now(), update_automation(), internal_start_discord_session() (+25 more)

### Community 6 - "Execution and Notifications"
Cohesion: 0.08
Nodes (38): EmailConfig, normalize_email_body(), send_email(), exec_add_todo(), exec_discord_channel(), exec_discord_dm(), exec_recall_fact(), exec_remember_fact() (+30 more)

### Community 7 - "Learning and Skills"
Cohesion: 0.09
Nodes (18): DiscordUserStats, record_behaviour_interaction(), LearnerData, clear_learning_insights(), create_skill(), delete_learning_insight(), delete_skill(), find_relevant_skills() (+10 more)

### Community 8 - "Chat Logic and Tools"
Cohesion: 0.09
Nodes (31): buildConversationHistory(), buildToolReply(), compactConversationMessages(), detectActionIntent(), detectRequiredToolCategories(), extractPromptFromUserMessage(), extractToolCalls(), getBooleanArg() (+23 more)

### Community 9 - "CLI Agents and Projects"
Cohesion: 0.1
Nodes (21): AgentCompletion, AgentLaunchSpec, AgentStateInfo, AgentStatus, build_launch_spec(), capture_child_output(), check_binary_exists(), CLIAgentConfig (+13 more)

### Community 10 - "Automation Data Models"
Cohesion: 0.11
Nodes (17): Action, ActionResult, Automation, automation_id_is_unique(), automation_new_stamps_timestamps(), automation_patch_defaults_are_empty(), AutomationPatch, AutomationStore (+9 more)

### Community 11 - "Storage and Configuration"
Cohesion: 0.13
Nodes (20): send_chat_message(), submit_external_reply(), test_lib_onboarding(), AppConfig, clear_conversation_summary(), get_app_dir(), get_config_path(), get_todos_path() (+12 more)

### Community 12 - "Android Web Chrome"
Cohesion: 0.08
Nodes (3): ActivityResultListener, PermissionListener, RustWebChromeClient

### Community 13 - "Trigger and Cron Logic"
Cohesion: 0.16
Nodes (19): cron_malformed_returns_false_not_panic(), cron_matches(), cron_matches_day_of_week(), cron_matches_every_minute_star(), cron_matches_list_and_range(), cron_matches_or_combines_dom_and_dow(), cron_matches_specific_hour(), cron_matches_specific_minute() (+11 more)

### Community 14 - "Android Wry Activity"
Cohesion: 0.1
Nodes (2): WryActivity, WryLifecycleObserver

### Community 15 - "Tools Parsing"
Cohesion: 0.19
Nodes (12): parse_tool_calls(), build_action_system_prompt(), clean_tool_name(), clean_user_id(), detect_required_tool_categories(), get_action_few_shots(), get_action_few_shots_filtered(), get_tool_params() (+4 more)

### Community 16 - "Android Tauri Activity"
Cohesion: 0.17
Nodes (2): TauriActivity, TauriLifecycleObserver

### Community 17 - "Android WebView"
Cohesion: 0.25
Nodes (1): RustWebView

### Community 18 - "Android Main Activity"
Cohesion: 0.29
Nodes (2): AndroidNotificationInterface, MainActivity

### Community 19 - "Android Keep Alive Service"
Cohesion: 0.29
Nodes (1): PernKeepAliveService

### Community 20 - "Android Permission Helper"
Cohesion: 0.29
Nodes (1): PermissionHelper

### Community 21 - "Android WebView Client"
Cohesion: 0.29
Nodes (1): RustWebViewClient

### Community 22 - "Chat Data Models"
Cohesion: 0.33
Nodes (5): ChatMessage, ChatRequest, OpenAIChoice, OpenAIDelta, OpenAIStreamChunk

### Community 23 - "Chat Input UI"
Cohesion: 0.5
Nodes (2): handleKeyDown(), handleLocalSend()

### Community 24 - "Android Build Task"
Cohesion: 0.5
Nodes (1): BuildTask

### Community 25 - "Android Rust Plugin"
Cohesion: 0.5
Nodes (2): Config, RustPlugin

### Community 26 - "Tools Data Types"
Cohesion: 0.5
Nodes (3): FewShotExample, RuleDefinition, ToolDefinition

### Community 27 - "Android IPC"
Cohesion: 0.67
Nodes (1): Ipc

## Knowledge Gaps
- **38 isolated node(s):** `Logger`, `Config`, `ChatMessage`, `ChatRequest`, `OpenAIDelta` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Android Wry Activity`** (20 nodes): `WryActivity.kt`, `WryActivity`, `.getAppClass()`, `.onCreate()`, `.onDestroy()`, `.onLowMemory()`, `.onNewIntent()`, `.onPause()`, `.onResume()`, `.onSaveInstanceState()`, `.onWebViewCreate()`, `.onWindowFocusChanged()`, `.setWebView()`, `.startActivity()`, `WryLifecycleObserver`, `.onCreate()`, `.onPause()`, `.onResume()`, `.onStart()`, `.onStop()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Android Tauri Activity`** (12 nodes): `TauriActivity.kt`, `TauriActivity`, `.getPluginManager()`, `.onConfigurationChanged()`, `.onCreate()`, `.onDestroy()`, `.onNewIntent()`, `.onRestart()`, `TauriLifecycleObserver`, `.onPause()`, `.onResume()`, `.onStop()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Android WebView`** (8 nodes): `RustWebView`, `.clearAllBrowsingData()`, `.evalScript()`, `.getCookies()`, `.loadHTMLMainThread()`, `.loadUrl()`, `.loadUrlMainThread()`, `RustWebView.kt`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Android Main Activity`** (7 nodes): `AndroidNotificationInterface`, `.hasPermission()`, `.showNotification()`, `MainActivity`, `.onCreate()`, `.onWebViewCreate()`, `MainActivity.kt`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Android Keep Alive Service`** (7 nodes): `PernKeepAliveService`, `.buildNotification()`, `.createNotificationChannel()`, `.onBind()`, `.onCreate()`, `.onStartCommand()`, `PernKeepAliveService.kt`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Android Permission Helper`** (7 nodes): `PermissionHelper`, `.getManifestPermissions()`, `.getUndefinedPermissions()`, `.hasDefinedPermission()`, `.hasDefinedPermissions()`, `.hasPermissions()`, `PermissionHelper.kt`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Android WebView Client`** (7 nodes): `RustWebViewClient`, `.onPageFinished()`, `.onPageStarted()`, `.onReceivedError()`, `.shouldInterceptRequest()`, `.shouldOverrideUrlLoading()`, `RustWebViewClient.kt`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Chat Input UI`** (5 nodes): `handleInputChange()`, `handleKeyDown()`, `handleLocalSend()`, `handleProcess()`, `ChatInput.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Android Build Task`** (4 nodes): `BuildTask`, `.assemble()`, `.runTauriCli()`, `BuildTask.kt`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Android Rust Plugin`** (4 nodes): `Config`, `RustPlugin`, `.apply()`, `RustPlugin.kt`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Android IPC`** (3 nodes): `Ipc`, `.postMessage()`, `Ipc.kt`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `error()` connect `App Setup and Settings` to `Chat Logic and Tools`, `Chat and Rust Bridge`?**
  _High betweenness centrality (0.174) - this node is a cross-community bridge._
- **Why does `run()` connect `Automation Scheduler` to `WhatsApp and Local Models`, `Memory Graph Storage`, `Execution and Notifications`, `CLI Agents and Projects`, `Storage and Configuration`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Why does `setup()` connect `Automation Scheduler` to `App Setup and Settings`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Are the 39 inferred relationships involving `error()` (e.g. with `main()` and `loadState()`) actually correct?**
  _`error()` has 39 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `execute_discord_tool_call()` (e.g. with `.get()` and `.as_str()`) actually correct?**
  _`execute_discord_tool_call()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `save_config()` (e.g. with `save_email_config()` and `clear_conversation_summary()`) actually correct?**
  _`save_config()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Logger`, `Config`, `ChatMessage` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._