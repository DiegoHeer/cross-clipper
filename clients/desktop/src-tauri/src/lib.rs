//! CrossClipper desktop Tauri library entry-point.
//!
//! Wires together all plugins and event handlers:
//!
//! 1. `tauri-plugin-single-instance` — registered **first** (decision 12).
//!    A second launch focuses the `main` window.
//! 2. `tauri-plugin-global-shortcut` — capture (`Ctrl+Alt+C`) and flyout
//!    (`Ctrl+Alt+V`) hotkeys registered in `setup`.  The capture handler
//!    reads the clipboard via the `ClipboardReader` trait and emits a
//!    `cc:capture` event to the `background` window.
//! 3. `tauri-plugin-autostart` — init with `--minimized`.
//! 4. `tauri-plugin-notification`, `tauri-plugin-store` — standard init.
//! 5. Tray built in `setup`.
//! 6. Window-close interception: `main`/`flyout` close → hide + prevent.
//!    Only `quit` calls `app.exit(0)`.
//! 7. Flyout blur-hide: when the flyout loses focus it hides itself.
//! 8. IPC commands exposed to the webview.

pub mod clipboard;
pub mod hotkeys;
pub mod tray;

use clipboard::{ClipboardRead, ClipboardReader, WindowsClipboard};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

// ---------------------------------------------------------------------------
// Capture event payload — sent to the `background` webview on Ctrl+Alt+C
// ---------------------------------------------------------------------------

/// JSON payload for the `cc:capture` Tauri event.
///
/// Shape: `{ kind: "text" | "empty" | "sensitive" | "unsupported", text?: string }`
#[derive(Debug, Clone, Serialize)]
pub struct CapturePayload {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

impl From<ClipboardRead> for CapturePayload {
    fn from(r: ClipboardRead) -> Self {
        match r {
            ClipboardRead::Text(t) => CapturePayload {
                kind: "text",
                text: Some(t),
            },
            ClipboardRead::Empty => CapturePayload {
                kind: "empty",
                text: None,
            },
            ClipboardRead::Sensitive => CapturePayload {
                kind: "sensitive",
                text: None,
            },
            ClipboardRead::Unsupported => CapturePayload {
                kind: "unsupported",
                text: None,
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Hotkey state (shared across the capture handler and IPC commands)
// ---------------------------------------------------------------------------

struct HotkeyStateMutex(Mutex<hotkeys::HotkeyState>);

// ---------------------------------------------------------------------------
// IPC commands
// ---------------------------------------------------------------------------

/// Re-register capture and flyout hotkeys with new combo strings.
///
/// Returns `Err(msg)` if either registration fails (decision 7 — combo
/// taken).  The caller (settings webview) should surface this as a
/// notification linking to Settings → Capture.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn register_hotkeys(app: AppHandle, capture: String, flyout: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let gs = app.global_shortcut();

    // Unregister any previously registered shortcuts (best-effort).
    if let Some(state) = app.try_state::<HotkeyStateMutex>() {
        let s = state.0.lock().unwrap();
        if let Some(old_cap) = hotkeys::parse_accelerator(&s.capture_combo) {
            let _ = gs.unregister(old_cap);
        }
        if let Some(old_fly) = hotkeys::parse_accelerator(&s.flyout_combo) {
            let _ = gs.unregister(old_fly);
        }
    }

    let cap_sc = hotkeys::parse_accelerator(&capture)
        .ok_or_else(|| format!("Invalid capture combo: {capture}"))?;
    let fly_sc = hotkeys::parse_accelerator(&flyout)
        .ok_or_else(|| format!("Invalid flyout combo: {flyout}"))?;

    gs.register(cap_sc)
        .map_err(|e| format!("Capture hotkey conflict: {e}"))?;
    gs.register(fly_sc)
        .map_err(|e| format!("Flyout hotkey conflict: {e}"))?;

    if let Some(state) = app.try_state::<HotkeyStateMutex>() {
        let mut s = state.0.lock().unwrap();
        s.capture_combo = capture;
        s.flyout_combo = flyout;
    }

    Ok(())
}

/// Pause clipboard capture for `minutes`.  Zero minutes resumes immediately.
#[tauri::command]
fn pause_capture(app: AppHandle, minutes: u64) {
    use tray::{set_tray_state, TrayState};
    if let Some(state) = app.try_state::<HotkeyStateMutex>() {
        let mut s = state.0.lock().unwrap();
        if minutes == 0 {
            s.pause = hotkeys::PauseState::Active;
        } else {
            s.pause = hotkeys::PauseState::pause_for(minutes);
        }
    }
    let new_state = if minutes == 0 {
        TrayState::Normal
    } else {
        TrayState::Paused
    };
    set_tray_state(&app, new_state);
}

/// Enable or disable the capture hotkey without changing the combo.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn set_capture_enabled(app: AppHandle, enabled: bool) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    use tray::{set_tray_state, TrayState};

    if let Some(state) = app.try_state::<HotkeyStateMutex>() {
        let mut s = state.0.lock().unwrap();
        s.capture_enabled = enabled;
        let gs = app.global_shortcut();
        if let Some(sc) = hotkeys::parse_accelerator(&s.capture_combo) {
            if enabled {
                let _ = gs.register(sc);
            } else {
                let _ = gs.unregister(sc);
            }
        }
    }
    let new_state = if enabled {
        TrayState::Normal
    } else {
        TrayState::Paused
    };
    set_tray_state(&app, new_state);
}

/// Show the flyout window (called from the webview).
#[tauri::command]
fn show_flyout(app: AppHandle) {
    tray::show_flyout(&app);
}

/// Show the main window (called from the webview).
#[tauri::command]
fn show_main(app: AppHandle) {
    tray::show_main(&app);
}

/// Show a window by label (called from the webview — e.g. the toast window).
#[tauri::command]
fn show_window(app: AppHandle, label: String) {
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Hide a window by label (called from the webview).
#[tauri::command]
fn hide_window(app: AppHandle, label: String) {
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.hide();
    }
}

/// Nudge the tray icon into or out of the "unread/pending" visual state.
///
/// `pending = true`  → tooltip "CrossClipper — New items" (tray pending).
/// `pending = false` → revert to normal tooltip.
///
/// This is the desktop substitute for the extension's badge increment: the
/// AlertManager calls this instead of setBadgeText so the tray icon signals
/// "something arrived" even for items that didn't trigger a notification toast.
/// A later PR will swap in a distinct icon asset; for now a tooltip change is
/// the simplest tray-icon affordance Tauri v2 supports without per-asset work.
#[tauri::command]
fn set_tray_pending(app: AppHandle, pending: bool) {
    use tray::{set_tray_state, TrayState};
    let state = if pending {
        TrayState::Pending
    } else {
        TrayState::Normal
    };
    set_tray_state(&app, state);
}

// ---------------------------------------------------------------------------
// Invoke-handler macro — include platform-gated commands
// ---------------------------------------------------------------------------

// Tauri's generate_handler! macro doesn't support cfg-gates inside the list,
// so we define separate run() implementations per platform.

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn run() {
    use tauri_plugin_autostart::MacosLauncher;

    tauri::Builder::default()
        // 1. Single-instance FIRST (decision 12).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch → focus the main window.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        // 2. Global shortcuts (handler wired in setup).
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // 3. Autostart with --minimized arg (decision 8).
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        // 4. Standard plugins.
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(HotkeyStateMutex(Mutex::new(hotkeys::HotkeyState::new(
            "Ctrl+Alt+C",
            "Ctrl+Alt+V",
        ))))
        .setup(|app| {
            // Build the tray and store the handle in managed state.
            let tray = tray::build_tray(app.handle())?;
            app.manage(tray::TrayHandle(tray));

            // Register default hotkeys.
            register_default_hotkeys(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            handle_window_event(window, event);
        })
        .invoke_handler(tauri::generate_handler![
            register_hotkeys,
            pause_capture,
            set_capture_enabled,
            show_flyout,
            show_main,
            show_window,
            hide_window,
            set_tray_pending,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CrossClipper");
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(HotkeyStateMutex(Mutex::new(hotkeys::HotkeyState::new(
            "Ctrl+Alt+C",
            "Ctrl+Alt+V",
        ))))
        .invoke_handler(tauri::generate_handler![
            pause_capture,
            show_flyout,
            show_main,
            show_window,
            hide_window,
            set_tray_pending,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CrossClipper");
}

// ---------------------------------------------------------------------------
// Default hotkey registration
// ---------------------------------------------------------------------------

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn register_default_hotkeys(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let capture_combo = "Ctrl+Alt+C";
    let flyout_combo = "Ctrl+Alt+V";

    let cap_sc = hotkeys::parse_accelerator(capture_combo);
    let fly_sc = hotkeys::parse_accelerator(flyout_combo);

    let app_cap = app.clone();
    let app_fly = app.clone();

    if let Some(sc) = cap_sc {
        let result = app.global_shortcut().on_shortcut(sc, move |app, _sc, _ev| {
            emit_capture_event(app);
        });
        if let Err(e) = result {
            // Decision 7: failed registration → emit notification (non-blocking).
            eprintln!("[crossclipper] Capture hotkey conflict: {e}");
            let _ = app_cap.emit_to(
                "background",
                "cc:hotkey-conflict",
                serde_json::json!({
                    "combo": capture_combo,
                    "role": "capture"
                }),
            );
        }
    }

    if let Some(sc) = fly_sc {
        let result = app.global_shortcut().on_shortcut(sc, move |app, _sc, _ev| {
            tray::show_flyout(app);
        });
        if let Err(e) = result {
            eprintln!("[crossclipper] Flyout hotkey conflict: {e}");
            let _ = app_fly.emit_to(
                "background",
                "cc:hotkey-conflict",
                serde_json::json!({
                    "combo": flyout_combo,
                    "role": "flyout"
                }),
            );
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Capture event emission
// ---------------------------------------------------------------------------

/// Read clipboard ONCE via the trait, map to payload, emit to `background`.
fn emit_capture_event<R: Runtime>(app: &AppHandle<R>) {
    // Check pause state before reading the clipboard.
    if let Some(state) = app.try_state::<HotkeyStateMutex>() {
        if state.0.lock().unwrap().is_capture_paused() {
            return;
        }
    }

    let reader = WindowsClipboard;
    let read = reader.read();
    let payload = CapturePayload::from(read);

    let _ = app.emit_to("background", "cc:capture", payload);
}

// ---------------------------------------------------------------------------
// Window event handler
// ---------------------------------------------------------------------------

fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
        // Close button → hide + prevent close (decision 13).
        // Only `quit` (tray menu) calls app.exit(0).
        tauri::WindowEvent::CloseRequested { api, .. } => {
            let label = window.label();
            if label == "main" || label == "flyout" {
                api.prevent_close();
                let _ = window.hide();
            }
        }
        // Flyout blur-hide: unconditionally hide when the flyout loses focus
        // (decision 13).  There is no guard for the brief blur that fires after
        // a tray-click shows the window — hide() is idempotent and show/set_focus
        // immediately follows, so the window is visible within the same tick.
        tauri::WindowEvent::Focused(false) if window.label() == "flyout" => {
            let _ = window.hide();
        }
        _ => {}
    }
}
