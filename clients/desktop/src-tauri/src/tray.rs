//! System-tray construction and state management.
//!
//! `build_tray` creates the tray icon with its right-click context menu.
//! Left-click is wired to toggle the flyout window (not to show the menu).
//!
//! Menu item ids (stable contracts consumed by the event handler in lib.rs):
//!   open, toggle_capture, pause, settings, quit
//!
//! Tray icon states (plan decision 3 / tray spec):
//!   normal, paused, pending
//!
//! `set_tray_state` swaps the tooltip to reflect the current state.

use tauri::{
    menu::{CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, Runtime,
};

// ---------------------------------------------------------------------------
// Tray state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Normal,
    Paused,
    Pending,
}

// ---------------------------------------------------------------------------
// Build the tray icon
// ---------------------------------------------------------------------------

/// Create the tray icon and attach event handlers.  Must be called once from
/// `setup`.  Returns `(TrayIcon, CheckMenuItem)` — callers must store both in
/// managed state so `set_tray_state` and `set_capture_check` can retrieve them.
pub fn build_tray<R: Runtime>(
    app: &AppHandle<R>,
) -> tauri::Result<(TrayIcon<R>, CheckMenuItem<R>)> {
    let (menu, toggle_capture) = build_menu(app)?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        // Left-click toggles the flyout; right-click shows the menu.
        .show_menu_on_left_click(false)
        .tooltip("CrossClipper");

    // Set the application icon when available; Tauri renders a placeholder
    // otherwise.
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    let tray = builder
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::TrayIconEvent;
            if let TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_flyout(app);
            }
        })
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id.as_ref());
        })
        .build(app)?;

    Ok((tray, toggle_capture))
}

// ---------------------------------------------------------------------------
// Menu construction
// ---------------------------------------------------------------------------

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<(Menu<R>, CheckMenuItem<R>)> {
    let open = MenuItemBuilder::with_id("open", "Open CrossClipper").build(app)?;
    let toggle_capture = CheckMenuItemBuilder::with_id("toggle_capture", "Capture hotkey enabled")
        .checked(true)
        .build(app)?;
    let pause = MenuItemBuilder::with_id("pause", "Pause 1 hour").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open)
        .item(&toggle_capture)
        .item(&pause)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()?;

    Ok((menu, toggle_capture))
}

// ---------------------------------------------------------------------------
// Menu event dispatch
// ---------------------------------------------------------------------------

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "open" => show_main(app),
        "toggle_capture" => {
            // Toggle capture-enabled state directly in Rust — no TS roundtrip
            // needed because `HotkeyStateMutex` already tracks the flag and
            // the global-shortcut plugin is available here.
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                use crate::hotkeys;
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                if let Some(state) = app.try_state::<crate::HotkeyStateMutex>() {
                    let mut s = state.0.lock().unwrap();
                    let new_enabled = !s.capture_enabled;
                    s.capture_enabled = new_enabled;
                    let gs = app.global_shortcut();
                    if let Some(sc) = hotkeys::parse_accelerator(&s.capture_combo) {
                        if new_enabled {
                            let _ = gs.register(sc);
                        } else {
                            let _ = gs.unregister(sc);
                        }
                    }
                    let new_state = if new_enabled {
                        TrayState::Normal
                    } else {
                        TrayState::Paused
                    };
                    // Drop the lock before calling set_tray_state / set_capture_check
                    // (avoids potential deadlock if those ever read state).
                    drop(s);
                    set_tray_state(app, new_state);
                    // Sync the CheckMenuItem checked state (fix: was never updated).
                    set_capture_check(app, new_enabled);
                }
            }
        }
        "pause" => {
            // Pause capture for 1 hour directly in Rust (spec §3).
            use crate::hotkeys::PauseState;
            if let Some(state) = app.try_state::<crate::HotkeyStateMutex>() {
                let mut s = state.0.lock().unwrap();
                s.pause = PauseState::pause_for(60);
                drop(s);
            }
            set_tray_state(app, TrayState::Paused);
        }
        "settings" => show_main(app),
        "quit" => app.exit(0),
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

/// Show and focus the main window.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Toggle the flyout window visibility.
pub fn toggle_flyout<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("flyout") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// Show and focus the flyout window (used by the hotkey handler).
pub fn show_flyout<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("flyout") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

// ---------------------------------------------------------------------------
// Tray state update
// ---------------------------------------------------------------------------

/// Update the tray tooltip to reflect `state`.
///
/// Icon swaps require distinct asset files; a later PR will add
/// normal/paused/pending icons.  For now the tooltip signals the state.
pub fn set_tray_state<R: Runtime>(app: &AppHandle<R>, state: TrayState) {
    let tooltip = match state {
        TrayState::Normal => "CrossClipper",
        TrayState::Paused => "CrossClipper — Capture paused",
        TrayState::Pending => "CrossClipper — New items",
    };
    if let Some(tray_handle) = app.try_state::<TrayHandle>() {
        let _ = tray_handle.0.set_tooltip(Some(tooltip));
    }
}

/// Sync the `toggle_capture` CheckMenuItem checked state.
///
/// Must be called from every code path that changes `capture_enabled` so the
/// menu stays in sync with the actual state:
/// * tray `toggle_capture` menu-event handler
/// * `set_capture_enabled` IPC command
pub fn set_capture_check<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    if let Some(check_handle) = app.try_state::<CheckMenuHandle>() {
        let _ = check_handle.0.set_checked(enabled);
    }
}

// ---------------------------------------------------------------------------
// TrayHandle managed state
// ---------------------------------------------------------------------------

/// Wraps the tray-icon ID so `set_tray_state` can retrieve the tray and
/// update its tooltip / icon without needing the generic `R: Runtime`
/// parameter in managed state.
///
/// We store just the id string rather than the `TrayIcon<R>` handle so we
/// avoid the `Send + Sync` wrapper complexity (TrayIcon is not `Send` itself
/// on all platforms).  Tooltip updates go through the app handle.
pub struct TrayHandle(pub tauri::tray::TrayIcon<tauri::Wry>);

// TrayIcon<Wry> is already Send+Sync for the default (Wry) runtime.
// The unsafe impls are guarded to Wry only via the concrete type above.
unsafe impl Send for TrayHandle {}
unsafe impl Sync for TrayHandle {}

// ---------------------------------------------------------------------------
// CheckMenuHandle managed state
// ---------------------------------------------------------------------------

/// Holds the `toggle_capture` `CheckMenuItem` so `set_capture_check` can
/// update its checked state without a generic `R: Runtime` parameter.
///
/// Using the concrete `Wry` runtime is idiomatic (same pattern as
/// `TrayHandle`).  `CheckMenuItem<Wry>` is `Send + Sync`.
pub struct CheckMenuHandle(pub CheckMenuItem<tauri::Wry>);

unsafe impl Send for CheckMenuHandle {}
unsafe impl Sync for CheckMenuHandle {}
