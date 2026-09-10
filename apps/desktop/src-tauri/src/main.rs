// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
struct DesktopSystemStatus {
    version: String,
    harness: String,
    platform: String,
    total_agents: usize,
    total_skills: usize,
}

struct ControlPlane(Mutex<Option<Child>>);

#[tauri::command]
fn get_desktop_status() -> DesktopSystemStatus {
    DesktopSystemStatus {
        version: "0.9.0".to_string(),
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

fn repo_root() -> PathBuf {
    if let Ok(root) = std::env::var("OAS_STUDIO_ROOT") {
        return PathBuf::from(root);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn health_ok(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    buf.contains("200") && buf.to_lowercase().contains("ok")
}

fn spawn_control_plane(port: u16) -> Option<Child> {
    let repo = repo_root();
    let script = repo.join("scripts").join("oas-studio.js");
    if !script.exists() {
        return None;
    }
    Command::new("node")
        .arg(script)
        .arg(port.to_string())
        .current_dir(repo)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

fn main() {
    tauri::Builder::default()
        .manage(ControlPlane(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_desktop_status, native_echo])
        .setup(|app| {
            let port: u16 = std::env::var("OAS_STUDIO_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(3458);
            if !health_ok(port) {
                if let Some(child) = spawn_control_plane(port) {
                    if let Some(state) = app.try_state::<ControlPlane>() {
                        *state.0.lock().expect("control plane mutex") = Some(child);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<ControlPlane>() {
                    if let Ok(mut slot) = state.0.lock() {
                        if let Some(mut child) = slot.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running OAS Studio desktop application");
}
