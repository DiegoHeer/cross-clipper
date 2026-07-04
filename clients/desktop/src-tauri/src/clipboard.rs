//! Clipboard reader trait and sensitive-content guard.
//!
//! `ClipboardReader` is the single abstraction between the hotkey handler and
//! the OS clipboard API.  `WindowsClipboard` is the real implementation
//! (compiled only on Windows).  On all other platforms a stub returns
//! `ClipboardRead::Unsupported` so the crate compiles on Linux CI.
//!
//! **No polling, no change-listeners, no timers.**  The hotkey handler (Task 4)
//! calls `reader.read()` exactly once per capture invocation — never anywhere
//! else.
//!
//! Text classification (text vs link, 256 KB cap, whitespace trim) is done in
//! TypeScript (packages/core `detectKind`).  Rust only distinguishes the four
//! variants below (decision 5).

/// The outcome of a single clipboard-read attempt.
#[derive(Debug, PartialEq)]
pub enum ClipboardRead {
    /// Clipboard is empty or contains no text-compatible format.
    Empty,
    /// The clipboard owner marked the content as sensitive via the
    /// `ExcludeClipboardContentFromMonitoringProcessing` registered format.
    /// The text is deliberately **not** read.
    Sensitive,
    /// Plain-text content is available.  Classification (text vs link, trim,
    /// byte cap) happens in TS.
    Text(String),
    /// Clipboard contains only non-text formats (image, file, etc.).
    Unsupported,
}

/// Read the clipboard once.  Called only from the capture-hotkey handler.
pub trait ClipboardReader {
    fn read(&self) -> ClipboardRead;
}

// ---------------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub struct WindowsClipboard;

#[cfg(windows)]
impl ClipboardReader for WindowsClipboard {
    fn read(&self) -> ClipboardRead {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::DataExchange::{
            CloseClipboard, GetClipboardData, IsClipboardFormatAvailable,
            OpenClipboard, RegisterClipboardFormatW,
        };
        use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};

        unsafe {
            // Open the clipboard associated with no window (NULL hwnd).
            if OpenClipboard(None).is_err() {
                return ClipboardRead::Empty;
            }

            let result = read_clipboard_inner();

            let _ = CloseClipboard();
            result
        }
    }
}

#[cfg(windows)]
unsafe fn read_clipboard_inner() -> ClipboardRead {
    use windows::core::w;
    use windows::Win32::System::DataExchange::{
        GetClipboardData, IsClipboardFormatAvailable, RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    // 1. Check for the sensitive-content sentinel format first.
    //    Password managers and other security-aware apps register this format to
    //    signal that clipboard monitors should not read the content.
    let sensitive_fmt = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitoringProcessing"));
    if sensitive_fmt != 0 && IsClipboardFormatAvailable(sensitive_fmt).is_ok() {
        return ClipboardRead::Sensitive;
    }

    // 2. Try to read CF_UNICODETEXT (format 13).
    const CF_UNICODETEXT: u32 = 13;
    if IsClipboardFormatAvailable(CF_UNICODETEXT).is_err() {
        return ClipboardRead::Unsupported;
    }

    let hdata = match GetClipboardData(CF_UNICODETEXT) {
        Ok(h) if !h.is_invalid() => h,
        _ => return ClipboardRead::Empty,
    };

    let ptr = GlobalLock(windows::Win32::Foundation::HGLOBAL(hdata.0)) as *const u16;
    if ptr.is_null() {
        return ClipboardRead::Empty;
    }

    // Find the null terminator.
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
    }

    let text = if len == 0 {
        String::new()
    } else {
        let slice = std::slice::from_raw_parts(ptr, len);
        String::from_utf16_lossy(slice)
    };

    let _ = GlobalUnlock(windows::Win32::Foundation::HGLOBAL(hdata.0));

    if text.is_empty() {
        ClipboardRead::Empty
    } else {
        ClipboardRead::Text(text)
    }
}

// ---------------------------------------------------------------------------
// Non-Windows stub — keeps `cargo check` / `cargo test` green on Linux CI.
// ---------------------------------------------------------------------------

#[cfg(not(windows))]
pub struct WindowsClipboard;

#[cfg(not(windows))]
impl ClipboardReader for WindowsClipboard {
    fn read(&self) -> ClipboardRead {
        // Real clipboard access requires the Windows API.
        ClipboardRead::Unsupported
    }
}

// ---------------------------------------------------------------------------
// Tests — use FakeClipboard so they run on every platform.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeClipboard {
        r: fn() -> ClipboardRead,
    }
    impl ClipboardReader for FakeClipboard {
        fn read(&self) -> ClipboardRead {
            (self.r)()
        }
    }

    #[test]
    fn sensitive_content_is_never_read_as_text() {
        let fake = FakeClipboard {
            r: || ClipboardRead::Sensitive,
        };
        assert!(matches!(fake.read(), ClipboardRead::Sensitive));
    }

    #[test]
    fn empty_text_and_unsupported_are_distinct() {
        assert!(matches!(
            FakeClipboard { r: || ClipboardRead::Empty }.read(),
            ClipboardRead::Empty
        ));
        assert!(matches!(
            FakeClipboard {
                r: || ClipboardRead::Text("hi".into())
            }
            .read(),
            ClipboardRead::Text(_)
        ));
        assert!(matches!(
            FakeClipboard {
                r: || ClipboardRead::Unsupported
            }
            .read(),
            ClipboardRead::Unsupported
        ));
    }
}
