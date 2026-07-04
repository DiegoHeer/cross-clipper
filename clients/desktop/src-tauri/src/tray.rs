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
    menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager, Runtime,
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
/// `setup`.  The tray icon handle is returned; store it in managed state so
/// `set_tray_state` can retrieve it.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    let menu = build_menu(app)?;

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

    builder
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
        .build(app)
}

// ---------------------------------------------------------------------------
// Menu construction
// ---------------------------------------------------------------------------

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let open = MenuItemBuilder::with_id("open", "Open CrossClipper").build(app)?;
    let toggle_capture = CheckMenuItemBuilder::with_id("toggle_capture", "Capture hotkey enabled")
        .checked(true)
        .build(app)?;
    let pause = MenuItemBuilder::with_id("pause", "Pause 1 hour").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    MenuBuilder::new(app)
        .item(&open)
        .item(&toggle_capture)
        .item(&pause)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()
}

// ---------------------------------------------------------------------------
// Menu event dispatch
// ---------------------------------------------------------------------------

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "open" => show_main(app),
        "toggle_capture" => {
            // Emit an event to the background window to let the TS layer
            // sync the toggle state.  Actual hotkey re-registration is
            // driven from the webview via `set_capture_enabled`.
            let _ = app.emit_to("background", "cc:toggle-capture", ());
        }
        "pause" => {
            // Emit to background; TS calls back via `pause_capture` command.
            let _ = app.emit_to("background", "cc:tray-pause", ());
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
        TrayState::Pending => "CrossClipper — Sync pending",
    };
    if let Some(tray_handle) = app.try_state::<TrayHandle>() {
        let _ = tray_handle.0.set_tooltip(Some(tooltip));
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
