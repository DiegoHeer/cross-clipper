import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toast } from "../src/toast/Toast";

describe("Toast", () => {
  it("synced shows snippet, countdown and a working Undo", async () => {
    const onUndo = vi.fn();
    render(<Toast toast={{ state: "synced", snippet: "hello", outboxId: "01X" }} countdownMs={5000} onUndo={onUndo} onDismiss={vi.fn()} />);
    expect(screen.getByText(/synced/i)).toBeInTheDocument();
    expect(screen.getByText(/hello/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledWith("01X");
  });
  it("queued shows the offline message and no Undo countdown timer", () => {
    render(<Toast toast={{ state: "queued", snippet: "hi" }} countdownMs={0} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/queued — will sync when connected/i)).toBeInTheDocument();
  });
  it("renders sensitive / empty / unsupported messages", () => {
    for (const [state, re] of [["sensitive", /marked sensitive/i], ["empty", /clipboard is empty/i], ["unsupported", /later version/i]] as const) {
      const { unmount } = render(<Toast toast={{ state }} countdownMs={0} onUndo={vi.fn()} onDismiss={vi.fn()} />);
      expect(screen.getByText(re)).toBeInTheDocument();
      unmount();
    }
  });
  it("cancelled state hides the toast (onDismiss called)", () => {
    const onDismiss = vi.fn();
    render(<Toast toast={{ state: "cancelled" }} countdownMs={0} onUndo={vi.fn()} onDismiss={onDismiss} />);
    expect(onDismiss).toHaveBeenCalled();
  });
  it("Undo click calls onUndo with outboxId", async () => {
    const onUndo = vi.fn();
    render(<Toast toast={{ state: "synced", snippet: "test", outboxId: "abc" }} countdownMs={10000} onUndo={onUndo} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledWith("abc");
  });
});
