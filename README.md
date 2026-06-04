# Pern — Offline-First Local AI Desktop & Mobile Assistant

Pern is a modern, cross-platform personal AI assistant built using **Tauri v2**, **React**, and **TypeScript**. It operates completely offline and securely by running an embedded local Llama server (`llama-server`) directly on your device, ensuring total privacy for your data and conversations.

---

## ✨ Key Features

* **Offline & Private AI**: Runs a local, device-native `llama-server` instance. No external API keys are required, and your data never leaves your device.
* **Unified Onboarding**: A step-by-step setup screen that downloads, extracts, and configures the optimized Llama engine binaries for your hardware.
* **Deep Tool Integrations**:
  * 📁 **Projects Manager**: Interface to connect, organize, and perform actions directly on your local directories and workspace codebases.
  * 💬 **WhatsApp Agent**: Link and manage automated notifications, message dispatching, and agent behaviors over WhatsApp.
  * 👾 **Discord Integrations**: Automated interactions and notifications for Discord channels.
  * ✉️ **Email (SMTP/IMAP)**: Draft, review, and dispatch emails securely via your local mail configurations.
  * 💻 **CLI Agents**: Execute terminal commands and run developer diagnostics securely using custom CLI tools.
* **Skills Registry**: An interactive learning panel to track, manage, and expand the assistant's capabilities dynamically.
* **Multi-Platform Support**: Tailored UI views built for both Windows Desktop window management and Android Mobile viewports.

---

## 🛠️ Technology Stack

* **Frontend**: React 19, TypeScript, Vite, CSS, Lucide React Icons
* **Application Shell**: Tauri v2 (Rust-backed desktop/mobile multi-platform app framework)
* **Local Database**: SQLite with Diesel ORM
* **Network & Protocols**: Tokio (async runtime), Reqwest, Tokio-Tungstenite (WebSockets), Wa-rs (WhatsApp protocol implementation in Rust)

---

## 💻 Local Development

### Prerequisites
* **Node.js** (v20 or higher)
* **Rust** (stable toolchain)
* **Android Studio & SDK Command-line Tools** (if building for Android)

### Setup & Run
1. Clone the repository:
   ```bash
   git clone https://github.com/Parth3930/pern.git
   cd pern
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the application:
   * **Tauri Desktop Dev**:
     ```bash
     npm run tauri dev
     ```
   * **Vite Web Preview**:
     ```bash
     npm run dev
     ```

### Build Commands
* **Windows Build**:
  ```bash
  npm run tauri build
  ```
* **Android Build**:
  ```bash
  npm run android:build
  ```
