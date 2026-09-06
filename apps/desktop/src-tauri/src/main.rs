// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct DesktopSystemStatus {
    version: String,
    harness: String,
    platform: String,
    total_agents: usize,
    total_skills: usize,
}

#[tauri::command]
fn get_desktop_status() -> DesktopSystemStatus {
    DesktopSystemStatus {
        version: "2.2.1".to_string(),
        harness: "Universal (Claude + Codex + Cursor + Gemini)".to_string(),
        platform: std::env::consts::OS.to_string(),
        total_agents: 68,
        total_skills: 286,
    }
}

#[tauri::command]
fn native_echo(message: String) -> String {
    format!("[OAS Native Rust Core] Received: {}", message)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_desktop_status, native_echo])
        .run(tauri::generate_context!())
        .expect("error while running OAS Studio desktop application");
}
