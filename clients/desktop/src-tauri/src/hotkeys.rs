//! Global-shortcut parsing, description, and pause bookkeeping.
//!
//! All OS-level registration goes through the `tauri-plugin-global-shortcut`
//! plugin; this module provides:
//!
//! * `parse_accelerator` — validate an accelerator string and return a
//!   `Shortcut` (or `None` for garbage input).
//! * `describe` — round-trip a `Shortcut` back to a human-readable string in
//!   the canonical `"Ctrl+Alt+C"` style used throughout the UI.
//! * `HotkeyState` — lightweight struct that tracks the current capture /
//!   flyout shortcuts and an optional pause deadline.
//!
//! The heavy, OS-bound work (actually calling `global_shortcut().register()`)
//! lives in `lib.rs`; helpers here are pure-logic so they can be unit-tested
//! on Linux CI.

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_global_shortcut::Shortcut;

use std::str::FromStr;
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// Accelerator parsing
// ---------------------------------------------------------------------------

/// Parse an accelerator string such as `"Ctrl+Alt+C"` into a `Shortcut`.
///
/// Returns `None` for unrecognised or malformed strings.
///
/// Wraps the underlying `Shortcut::from_str` / `HotKey::from_str` which
/// accepts lower-case modifier names (`ctrl`, `alt`, `shift`, `super`) and
/// `KeyX` style key names as well as bare letters.  The plugin normalises the
/// input, so `"Ctrl+Alt+C"` and `"ctrl+alt+c"` both parse successfully.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn parse_accelerator(s: &str) -> Option<Shortcut> {
    Shortcut::from_str(s).ok()
}

/// Stub for platforms where the global-shortcut plugin is unavailable.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn parse_accelerator(_s: &str) -> Option<()> {
    None
}

// ---------------------------------------------------------------------------
// Description (round-trip to canonical string)
// ---------------------------------------------------------------------------

/// Convert a `Shortcut` to the canonical UI string, e.g. `"Ctrl+Alt+C"`.
///
/// The underlying `HotKey::into_string()` returns a lowercase string like
/// `"control+alt+c"`.  This function normalises it to the `"Ctrl+Alt+C"` form
/// expected by the settings UI and the plan's unit tests.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn describe(sc: &Shortcut) -> String {
    // HotKey::into_string() returns lowercase tokens joined by '+',
    // e.g. "control+alt+c" or "shift+control+keya".
    let raw = sc.into_string();
    raw.split('+')
        .map(normalise_token)
        .collect::<Vec<_>>()
        .join("+")
}

/// Normalise a single accelerator token to title-case for the UI.
///
/// Examples: `"control"` → `"Ctrl"`, `"alt"` → `"Alt"`, `"KeyC"` → `"C"`,
/// `"KeySpace"` → `"Space"`.
///
/// The `Code::Display` impl in the `keyboard_types` crate uses `"KeyX"` for
/// letter keys and leaves function keys etc. as-is (e.g. `"F1"`).
fn normalise_token(token: &str) -> String {
    match token {
        "control" | "ctrl" => "Ctrl".to_string(),
        "alt" => "Alt".to_string(),
        "shift" => "Shift".to_string(),
        "super" | "meta" | "logo" => "Super".to_string(),
        other => {
            // Strip the "Key" prefix that the Code Display impl emits for
            // letter keys (e.g. "KeyC" → "C", "KeySpace" → "Space").
            // The prefix is always capital-K lowercase-e-y.
            let key = other.strip_prefix("Key").unwrap_or(other);
            // If the result is a single ASCII letter, uppercase it.
            // Otherwise leave it as-is (e.g. "F1", "Space", "Enter").
            if key.len() == 1 {
                key.to_ascii_uppercase()
            } else {
                key.to_string()
            }
        }
    }
}

/// Stub for platforms where the global-shortcut plugin is unavailable.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn describe(_sc: &()) -> String {
    String::new()
}

// ---------------------------------------------------------------------------
// HotkeyState — tracks active shortcuts + optional pause deadline
// ---------------------------------------------------------------------------

/// Pause duration sentinel — `None` means capture is active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PauseState {
    Active,
    PausedUntil(Instant),
}

impl PauseState {
    /// Returns `true` while the pause deadline has not yet passed.
    pub fn is_paused(&self) -> bool {
        match self {
            PauseState::Active => false,
            PauseState::PausedUntil(deadline) => Instant::now() < *deadline,
        }
    }

    /// Set a pause deadline `minutes` into the future.
    pub fn pause_for(minutes: u64) -> Self {
        PauseState::PausedUntil(Instant::now() + Duration::from_secs(minutes * 60))
    }
}

/// Tracks the currently-registered capture / flyout shortcuts and the pause
/// state.  The plugin's actual OS registration is driven from `lib.rs`;
/// `HotkeyState` only carries the logical bookkeeping.
#[derive(Debug)]
pub struct HotkeyState {
    pub capture_combo: String,
    pub flyout_combo: String,
    pub pause: PauseState,
}

impl HotkeyState {
    pub fn new(capture: &str, flyout: &str) -> Self {
        Self {
            capture_combo: capture.to_string(),
            flyout_combo: flyout.to_string(),
            pause: PauseState::Active,
        }
    }

    pub fn is_capture_paused(&self) -> bool {
        self.pause.is_paused()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_capture_combo() {
        let sc = parse_accelerator("Ctrl+Alt+C").expect("valid");
        assert_eq!(describe(&sc), "Ctrl+Alt+C");
    }

    #[test]
    fn rejects_garbage_accelerator() {
        assert!(parse_accelerator("not a combo!!").is_none());
    }

    #[test]
    fn distinct_capture_and_flyout_combos_are_allowed() {
        assert!(parse_accelerator("Ctrl+Alt+C").is_some());
        assert!(parse_accelerator("Ctrl+Alt+V").is_some());
    }

    #[test]
    fn pause_state_starts_active() {
        let state = HotkeyState::new("Ctrl+Alt+C", "Ctrl+Alt+V");
        assert!(!state.is_capture_paused());
    }

    #[test]
    fn pause_state_pauses_then_expires() {
        // 0-minute pause deadline is immediately in the past → already expired.
        let state = PauseState::PausedUntil(Instant::now() - Duration::from_secs(1));
        assert!(!state.is_paused());

        // A far-future deadline is still paused.
        let state = PauseState::pause_for(60);
        assert!(state.is_paused());
    }

    #[test]
    fn parses_flyout_combo() {
        let sc = parse_accelerator("Ctrl+Alt+V").expect("valid");
        assert_eq!(describe(&sc), "Ctrl+Alt+V");
    }
}
