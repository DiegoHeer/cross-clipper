import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Compose } from "../src/ui/Compose";
import { TargetPicker } from "../src/ui/TargetPicker";
import type { DeviceView } from "../src/shared/model";

const devices: DeviceView[] = [
  { id: "self", name: "Work laptop", platform: "extension", online: true, isSelf: true, lastSeenAt: "2026-07-03T11:59:00" },
  { id: "d2", name: "Pixel 8", platform: "android", online: false, isSelf: false, lastSeenAt: "2026-07-01T00:00:00" },
];

describe("TargetPicker", () => {
  it("defaults to Silent and excludes the current device", () => {
    render(<TargetPicker devices={devices} target={null} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /silent/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /work laptop/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pixel 8/i })).toBeInTheDocument();
  });
  it("selecting a chip reports the device id", async () => {
    const onChange = vi.fn();
    render(<TargetPicker devices={devices} target={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /pixel 8/i }));
    expect(onChange).toHaveBeenCalledWith("d2");
  });
});

describe("Compose", () => {
  it("Enter sends trimmed text and resets body and target", async () => {
    const onSend = vi.fn();
    render(<Compose devices={devices} onSend={onSend} />);
    await userEvent.click(screen.getByRole("button", { name: /pixel 8/i }));
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "  hello world  {Enter}");
    expect(onSend).toHaveBeenCalledWith("text", "hello world", "d2");
    expect(box).toHaveValue("");
    expect(screen.getByRole("button", { name: /silent/i })).toHaveAttribute("aria-pressed", "true");
  });
  it("Shift+Enter inserts a newline instead of sending", async () => {
    const onSend = vi.fn();
    render(<Compose devices={devices} onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox"), "line1{Shift>}{Enter}{/Shift}line2");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("line1\nline2");
  });
  it("a lone URL is sent as a link; empty input is ignored", async () => {
    const onSend = vi.fn();
    render(<Compose devices={devices} onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox"), "https://example.com{Enter}");
    expect(onSend).toHaveBeenCalledWith("link", "https://example.com", null);
    await userEvent.type(screen.getByRole("textbox"), "   {Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it("Enter during IME composition does not send", () => {
    const onSend = vi.fn();
    render(<Compose devices={devices} onSend={onSend} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });
  it("plain Enter (not composing) does send when text is present", async () => {
    const onSend = vi.fn();
    render(<Compose devices={devices} onSend={onSend} />);
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "hello");
    fireEvent.keyDown(box, { key: "Enter", isComposing: false });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it("shows a disabled media drop zone", () => {
    render(<Compose devices={devices} onSend={vi.fn()} />);
    const dz = screen.getByText(/drop files or images here/i);
    expect(dz).toHaveAttribute("aria-disabled");
  });
});
