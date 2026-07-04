import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../src/popup/App";

describe("popup shell (fixtures)", () => {
  it("renders header, rail, feed cards and compose", () => {
    render(<App />);
    expect(screen.getByText("CrossClipper")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /all/i })).toBeInTheDocument();
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("target picker shows non-self device chips", () => {
    render(<App />);
    const picker = screen.getByRole("group", { name: /notify device/i });
    // TargetPicker internally excludes isSelf — Pixel 8 chip must appear
    expect(within(picker).getByRole("button", { name: /pixel 8/i })).toBeInTheDocument();
  });

  it("rail selection filters the feed by origin device", async () => {
    render(<App />);
    const rail = screen.getByRole("navigation", { name: /devices/i });
    const before = screen.getAllByRole("article").length;
    await userEvent.click(within(rail).getByRole("button", { name: /pixel 8/i }));
    expect(screen.getAllByRole("article").length).toBeLessThan(before);
  });

  it("shows the empty-state hint when the filter matches nothing", async () => {
    render(<App />);
    const rail = screen.getByRole("navigation", { name: /devices/i });
    await userEvent.click(within(rail).getByRole("button", { name: /old tablet/i }));
    expect(
      screen.getByText(/copy something on another device, or type below/i),
    ).toBeInTheDocument();
  });
});
