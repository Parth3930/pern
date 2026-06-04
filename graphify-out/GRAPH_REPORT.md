# Graph Report - .  (2026-05-17)

## Corpus Check
- Corpus is ~9,185 words - fits in a single context window. You may not need a graph.

## Summary
- 102 nodes · 115 edges · 24 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Tauri Commands & State|Tauri Commands & State]]
- [[_COMMUNITY_Onboarding UI Components|Onboarding UI Components]]
- [[_COMMUNITY_App Entry & Navigation|App Entry & Navigation]]
- [[_COMMUNITY_App Configuration & Storage|App Configuration & Storage]]
- [[_COMMUNITY_Tauri Lifecycle & Bridge|Tauri Lifecycle & Bridge]]
- [[_COMMUNITY_Project Metadata & Tech Stack|Project Metadata & Tech Stack]]
- [[_COMMUNITY_Branding & Icons|Branding & Icons]]
- [[_COMMUNITY_Chat UI Components|Chat UI Components]]
- [[_COMMUNITY_Chat Logic & Models|Chat Logic & Models]]
- [[_COMMUNITY_Model Registry & Info|Model Registry & Info]]
- [[_COMMUNITY_Tauri Build Script|Tauri Build Script]]
- [[_COMMUNITY_Backend Core Modules|Backend Core Modules]]
- [[_COMMUNITY_Config Logic|Config Logic]]
- [[_COMMUNITY_React Logo|React Logo]]
- [[_COMMUNITY_Icon Asset (128x128@2x)|Icon Asset (128x128@2x)]]
- [[_COMMUNITY_Icon Asset (Square 107x107)|Icon Asset (Square 107x107)]]
- [[_COMMUNITY_Icon Asset (Square 142x142)|Icon Asset (Square 142x142)]]
- [[_COMMUNITY_Icon Asset (Square 150x150)|Icon Asset (Square 150x150)]]
- [[_COMMUNITY_Icon Asset (Square 284x284)|Icon Asset (Square 284x284)]]
- [[_COMMUNITY_Icon Asset (Square 30x30)|Icon Asset (Square 30x30)]]
- [[_COMMUNITY_Icon Asset (Square 310x310)|Icon Asset (Square 310x310)]]
- [[_COMMUNITY_Icon Asset (Square 44x44)|Icon Asset (Square 44x44)]]
- [[_COMMUNITY_Icon Asset (Square 71x71)|Icon Asset (Square 71x71)]]
- [[_COMMUNITY_Icon Asset (Square 89x89)|Icon Asset (Square 89x89)]]

## God Nodes (most connected - your core abstractions)
1. `run()` - 6 edges
2. `save_config()` - 6 edges
3. `get_config_path()` - 5 edges
4. `load_config()` - 5 edges
5. `check_ollama_installed()` - 4 edges
6. `install_ollama()` - 4 edges
7. `get_app_dir()` - 4 edges
8. `Pern Project` - 4 edges
9. `Application Icon` - 4 edges
10. `list_available_models()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `list_available_models()` --calls--> `get_model_registry()`  [INFERRED]
  D:\agent\pern\src-tauri\src\commands.rs → D:\agent\pern\src-tauri\src\model.rs
- `choose_model()` --calls--> `save_config()`  [INFERRED]
  D:\agent\pern\src-tauri\src\commands.rs → D:\agent\pern\src-tauri\src\storage.rs
- `set_first_run_completed()` --calls--> `save_config()`  [INFERRED]
  D:\agent\pern\src-tauri\src\commands.rs → D:\agent\pern\src-tauri\src\storage.rs
- `choose_model_dir()` --calls--> `save_config()`  [INFERRED]
  D:\agent\pern\src-tauri\src\commands.rs → D:\agent\pern\src-tauri\src\storage.rs
- `run()` --calls--> `load_config()`  [INFERRED]
  D:\agent\pern\src-tauri\src\lib.rs → D:\agent\pern\src-tauri\src\storage.rs

## Communities

### Community 0 - "Tauri Commands & State"
Cohesion: 0.25
Nodes (10): check_ollama_installed(), choose_model(), choose_model_dir(), download_model(), get_onboarding_state(), install_ollama(), launch_app(), list_available_models() (+2 more)

### Community 1 - "Onboarding UI Components"
Cohesion: 0.36
Nodes (8): checkOllama(), handleDirChange(), handleInstallOllama(), handleModelSelect(), handleNext(), handleSelectFolder(), setup(), startDownload()

### Community 2 - "App Entry & Navigation"
Cohesion: 0.29
Nodes (4): handleOnboardingComplete(), loadState(), src/screens/Chat.tsx, src/screens/Onboarding.tsx

### Community 3 - "App Configuration & Storage"
Cohesion: 0.57
Nodes (5): AppConfig, get_app_dir(), get_config_path(), load_config(), save_config()

### Community 4 - "Tauri Lifecycle & Bridge"
Cohesion: 0.33
Nodes (3): run(), send_chat_message(), main()

### Community 5 - "Project Metadata & Tech Stack"
Cohesion: 0.29
Nodes (6): src/lib/api.ts, Ollama, Pern Project, React 19, Rust Backend, Tauri v2

### Community 6 - "Branding & Icons"
Cohesion: 0.33
Nodes (6): 128x128 Icon, 32x32 Icon, Application Icon, Store Logo, Tauri Logo, Vite Logo

### Community 7 - "Chat UI Components"
Cohesion: 0.6
Nodes (3): handleSend(), handleToolCall(), setupListeners()

### Community 8 - "Chat Logic & Models"
Cohesion: 0.6
Nodes (3): ChatMessage, ChatRequest, ChatResponseChunk

### Community 9 - "Model Registry & Info"
Cohesion: 0.6
Nodes (3): DownloadProgress, get_model_registry(), ModelInfo

### Community 10 - "Tauri Build Script"
Cohesion: 0.67
Nodes (1): main()

### Community 11 - "Backend Core Modules"
Cohesion: 0.67
Nodes (3): src-tauri/src/commands.rs, src-tauri/src/lib.rs, src-tauri/src/main.rs

### Community 12 - "Config Logic"
Cohesion: 1.0
Nodes (2): config.json, src-tauri/src/storage.rs

### Community 20 - "React Logo"
Cohesion: 1.0
Nodes (1): React Logo

### Community 21 - "Icon Asset (128x128@2x)"
Cohesion: 1.0
Nodes (1): 128x128@2x Icon

### Community 22 - "Icon Asset (Square 107x107)"
Cohesion: 1.0
Nodes (1): Square 107x107 Logo

### Community 23 - "Icon Asset (Square 142x142)"
Cohesion: 1.0
Nodes (1): Square 142x142 Logo

### Community 24 - "Icon Asset (Square 150x150)"
Cohesion: 1.0
Nodes (1): Square 150x150 Logo

### Community 25 - "Icon Asset (Square 284x284)"
Cohesion: 1.0
Nodes (1): Square 284x284 Logo

### Community 26 - "Icon Asset (Square 30x30)"
Cohesion: 1.0
Nodes (1): Square 30x30 Logo

### Community 27 - "Icon Asset (Square 310x310)"
Cohesion: 1.0
Nodes (1): Square 310x310 Logo

### Community 28 - "Icon Asset (Square 44x44)"
Cohesion: 1.0
Nodes (1): Square 44x44 Logo

### Community 29 - "Icon Asset (Square 71x71)"
Cohesion: 1.0
Nodes (1): Square 71x71 Logo

### Community 30 - "Icon Asset (Square 89x89)"
Cohesion: 1.0
Nodes (1): Square 89x89 Logo

## Knowledge Gaps
- **25 isolated node(s):** `React 19`, `Rust Backend`, `Ollama`, `src/lib/api.ts`, `src/screens/Onboarding.tsx` (+20 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Tauri Build Script`** (3 nodes): `main()`, `build.rs`, `build.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Config Logic`** (2 nodes): `config.json`, `src-tauri/src/storage.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `React Logo`** (1 nodes): `React Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (128x128@2x)`** (1 nodes): `128x128@2x Icon`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (Square 107x107)`** (1 nodes): `Square 107x107 Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (Square 142x142)`** (1 nodes): `Square 142x142 Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (Square 150x150)`** (1 nodes): `Square 150x150 Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (Square 284x284)`** (1 nodes): `Square 284x284 Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (Square 30x30)`** (1 nodes): `Square 30x30 Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (Square 310x310)`** (1 nodes): `Square 310x310 Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (Square 44x44)`** (1 nodes): `Square 44x44 Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (Square 71x71)`** (1 nodes): `Square 71x71 Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Icon Asset (Square 89x89)`** (1 nodes): `Square 89x89 Logo`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `run()` connect `Tauri Lifecycle & Bridge` to `Tauri Commands & State`, `App Configuration & Storage`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `list_available_models()` connect `Tauri Commands & State` to `Model Registry & Info`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `get_model_registry()` connect `Model Registry & Info` to `Tauri Commands & State`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `run()` (e.g. with `load_config()` and `.new()`) actually correct?**
  _`run()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `save_config()` (e.g. with `choose_model()` and `set_first_run_completed()`) actually correct?**
  _`save_config()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `React 19`, `Rust Backend`, `Ollama` to the rest of the system?**
  _25 weakly-connected nodes found - possible documentation gaps or missing edges._