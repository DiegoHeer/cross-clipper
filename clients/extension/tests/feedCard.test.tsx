import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Item } from "@crossclipper/core";
import { FeedCard } from "../src/popup/components/FeedCard";

const base = {
  originName: "Pixel 8",
  originIcon: "📱",
  onCopy: vi.fn(),
  onOpen: vi.fn(),
  onDelete: vi.fn(),
};

const item = (over: Partial<Item>): Item =>
  ({
    id: "01J0000000000000000000000",
    kind: "text",
    body: "meeting notes draft",
    origin_device_id: "d2",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T11:00:00",
    deleted_at: null,
    ...over,
  }) as Item;

describe("FeedCard", () => {
  it("text items get Copy and Delete, no Open", () => {
    render(<FeedCard {...base} entry={{ item: item({}) }} />);
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open/i })).not.toBeInTheDocument();
  });

  it("link items additionally get Open, and Open receives the URL", async () => {
    render(
      <FeedCard {...base} entry={{ item: item({ kind: "link", body: "https://example.com" }) }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(base.onOpen).toHaveBeenCalledWith("https://example.com");
  });

  it("copy flashes a confirmation", async () => {
    render(<FeedCard {...base} entry={{ item: item({}) }} />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(base.onCopy).toHaveBeenCalledWith("meeting notes draft");
    expect(await screen.findByText(/copied ✓/i)).toBeInTheDocument();
  });

  it("unknown kinds render the update-client fallback", () => {
    render(<FeedCard {...base} entry={{ item: item({ kind: "image" as Item["kind"] }) }} />);
    expect(screen.getByText(/unsupported item — update client/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("failed sends show the retry affordance instead of actions", async () => {
    const onRetry = vi.fn();
    render(<FeedCard {...base} onRetry={onRetry} entry={{ item: item({}), sendState: "failed" }} />);
    await userEvent.click(screen.getByRole("button", { name: /not sent — tap to retry/i }));
    expect(onRetry).toHaveBeenCalledWith("01J0000000000000000000000");
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("pending sends keep Copy enabled, disable Delete, and show sending indicator", () => {
    render(<FeedCard {...base} entry={{ item: item({}), sendState: "pending" }} />);
    expect(screen.getByRole("button", { name: /copy/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /delete/i })).toBeDisabled();
    expect(screen.getByText(/sending…/i)).toBeInTheDocument();
  });

  it("shows origin device and relative time in the header", () => {
    render(<FeedCard {...base} entry={{ item: item({}) }} />);
    expect(screen.getByText(/Pixel 8/)).toBeInTheDocument();
    expect(screen.getByText(/ago|just now/)).toBeInTheDocument();
  });
});
