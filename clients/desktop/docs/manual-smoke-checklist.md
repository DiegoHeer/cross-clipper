# Manual Smoke Checklist

**Release gate for native behavior that CI cannot drive (decision 11).**
Run this checklist in full before tagging a release. Every item must be checked.
The Windows bundle job proves the installer *compiles*; this checklist proves it *works*.

---

## 1. Hotkey capture

- [ ] **Text capture — normal**: with another app focused (e.g., Notepad), press `Ctrl+Alt+C`. A toast appears confirming the capture, with an Undo action. The item appears in the CrossClipper feed.
- [ ] **Text capture — sensitive content**: press the capture hotkey while a password-manager field or browser password input is focused. A guard toast appears (no content shown). Item is still synced.
- [ ] **Empty clipboard**: press the capture hotkey with an empty clipboard. No item is created; appropriate feedback is given (toast or silence).
- [ ] **Image in clipboard**: press the capture hotkey with an image on the clipboard. An "unsupported content type" toast appears. No item is created.

---

## 2. Flyout open/close

- [ ] **Tray click opens flyout**: clicking the system tray icon opens the flyout window above the tray.
- [ ] **Hotkey opens flyout**: pressing `Ctrl+Alt+V` (default flyout hotkey) opens the flyout while another app is focused.
- [ ] **Focus-loss auto-hide**: clicking outside the flyout dismisses it automatically (blur-triggered hide).
- [ ] **Second hotkey press closes**: pressing the flyout hotkey again while the flyout is visible closes it.

---

## 3. Tray menu

- [ ] **Open**: "Open" menu item shows the main CrossClipper window.
- [ ] **Toggle capture (enable/disable)**: "Pause capture" / "Resume capture" menu item toggles the hotkey capture state. Confirm the menu label updates and capture is actually blocked/unblocked.
- [ ] **Pause 1 hour**: "Pause for 1 hour" menu item suspends capture. After 1 hour (or by testing with a mocked time), capture resumes automatically without user intervention. Confirm the tray menu item reflects the paused state and then re-enables.
- [ ] **Settings**: "Settings" menu item opens the Settings panel in the main window.
- [ ] **Quit**: "Quit" menu item fully exits the app (process terminates, tray icon disappears).

---

## 4. Autostart

- [ ] **Autostart enable**: enable "Start at login" in Settings. Reboot the machine. CrossClipper starts automatically and appears in the system tray.
- [ ] **Autostart disable**: disable "Start at login" in Settings. Reboot the machine. CrossClipper does NOT start automatically.

---

## 5. Single instance

- [ ] **Second launch focuses**: with CrossClipper already running, launch a second instance (double-click the exe or run from terminal). The existing instance's main window is focused; no second tray icon or process appears.

---

## 6. Offline capture and queue flush

- [ ] **Offline capture queues**: disconnect from the network (or stop the CrossClipper server). Press the capture hotkey. A toast confirms capture. The item is held in the local outbox.
- [ ] **Flush on reconnect**: reconnect the network (or restart the server). The queued item(s) are synced to the server and appear in the feed on other devices.

---

## 7. Notification policy

- [ ] **Targeted notification arrives**: from another device, send a clipboard item targeted at this Windows device. A Windows toast notification appears for that item.
- [ ] **Untargeted notification respects toggle**: with notifications for untargeted items disabled in Settings, send a clipboard item from another device with no specific target. No Windows toast appears.

---

## 8. Window close hides to tray

- [ ] **Close button hides (does not quit)**: pressing the X button on the main window hides it. The app remains running; the tray icon is still present. Clicking the tray icon or choosing "Open" from the tray menu brings the window back.

---

## 9. Theme following

- [ ] **Light/dark follows OS**: switch the Windows OS theme between Light and Dark. CrossClipper's UI (flyout and main window) updates accordingly without restart.
- [ ] **Accent re-skin**: change the accent color in CrossClipper Settings. The flyout and main window reflect the new accent color immediately.

---

## 10. NSIS installer + Windows toast verification

- [ ] **Install from NSIS setup**: run the `*-setup.exe` from `clients/desktop/src-tauri/target/release/bundle/nsis/`. The installer completes without errors. CrossClipper appears in Start Menu and "Add or remove programs".
- [ ] **Windows toast appears after install**: after installing (not just running the dev build), trigger a notification event. Windows toast notifications appear in the notification center. (Toasts require a registered installed app — a dev/portable run will not show OS toasts.)
- [ ] **Uninstall clean**: uninstall CrossClipper via "Add or remove programs". No leftover processes or tray icons.
