import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Item } from "@crossclipper/core";
import { Feed } from "../src/popup/components/Feed";
import type { FeedEntry } from "../src/popup/components/FeedCard";

const makeItem = (id: string, originDeviceId = "d-other"): Item =>
  ({
    id,
    kind: "text",
    body: id,
    origin_device_id: originDeviceId,
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T00:00:00",
    deleted_at: null,
  }) as Item;

const makeEntry = (id: string, originDeviceId = "d-other", sendState?: FeedEntry["sendState"]): FeedEntry => ({
  item: makeItem(id, originDeviceId),
  sendState,
});

const baseProps = {
  nameOf: () => "Device",
  iconOf: () => "💻",
  onCopy: vi.fn(),
  onOpen: vi.fn(),
  onDelete: vi.fn(),
  onRetry: vi.fn(),
  selfDeviceId: "d-self",
};

/** Simulate a scroll-down so the pill logic is armed. */
function simulateScrollDown(container: HTMLElement) {
  const feed = container.querySelector(".feed") as HTMLElement;
  Object.defineProperty(feed, "scrollTop", { configurable: true, get: () => 100 });
  // jsdom does not implement scrollTo — stub it so the pill onClick doesn't throw
  if (!feed.scrollTo) {
    Object.defineProperty(feed, "scrollTo", { configurable: true, value: () => {} });
  }
  act(() => {
    feed.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

describe("Feed pill — own-send suppression", () => {
  it("does NOT show the pill when a foreign item arrives while scrolled", async () => {
    const { rerender, container } = render(
      <Feed {...baseProps} entries={[makeEntry("01B", "d-other")]} />,
    );
    simulateScrollDown(container);

    rerender(<Feed {...baseProps} entries={[makeEntry("01C", "d-other"), makeEntry("01B", "d-other")]} />);

    expect(screen.getByRole("button", { name: /new item/i })).toBeInTheDocument();
  });

  it("does NOT show the pill when an own item arrives while scrolled", () => {
    const { rerender, container } = render(
      <Feed {...baseProps} entries={[makeEntry("01B", "d-other")]} />,
    );
    simulateScrollDown(container);

    // New top item originated from self — must NOT trigger pill
    rerender(
      <Feed
        {...baseProps}
        entries={[makeEntry("01C", "d-self"), makeEntry("01B", "d-other")]}
      />,
    );

    expect(screen.queryByRole("button", { name: /new item/i })).not.toBeInTheDocument();
  });

  it("does NOT show the pill for an optimistic pending send (sendState=pending)", () => {
    const { rerender, container } = render(
      <Feed {...baseProps} entries={[makeEntry("01B", "d-other")]} />,
    );
    simulateScrollDown(container);

    // Optimistic outbox echo — sendState pending, origin_device_id = self
    rerender(
      <Feed
        {...baseProps}
        entries={[
          makeEntry("01C", "d-self", "pending"),
          makeEntry("01B", "d-other"),
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: /new item/i })).not.toBeInTheDocument();
  });

  it("pill count increments for multiple foreign arrivals but not for own sends", () => {
    const { rerender, container } = render(
      <Feed {...baseProps} entries={[makeEntry("01A", "d-other")]} />,
    );
    simulateScrollDown(container);

    // Foreign arrives → count 1
    rerender(
      <Feed
        {...baseProps}
        entries={[makeEntry("01B", "d-other"), makeEntry("01A", "d-other")]}
      />,
    );
    expect(screen.getByRole("button", { name: /1 new item\b/i })).toBeInTheDocument();

    // Own send arrives → count stays 1
    rerender(
      <Feed
        {...baseProps}
        entries={[
          makeEntry("01C", "d-self"),
          makeEntry("01B", "d-other"),
          makeEntry("01A", "d-other"),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /1 new item\b/i })).toBeInTheDocument();

    // Another foreign arrives → count 2
    rerender(
      <Feed
        {...baseProps}
        entries={[
          makeEntry("01D", "d-other"),
          makeEntry("01C", "d-self"),
          makeEntry("01B", "d-other"),
          makeEntry("01A", "d-other"),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /2 new items/i })).toBeInTheDocument();
  });

  it("clicking the pill scrolls to top and clears the count", async () => {
    const { rerender, container } = render(
      <Feed {...baseProps} entries={[makeEntry("01A", "d-other")]} />,
    );
    simulateScrollDown(container);

    rerender(
      <Feed
        {...baseProps}
        entries={[makeEntry("01B", "d-other"), makeEntry("01A", "d-other")]}
      />,
    );

    const pill = screen.getByRole("button", { name: /new item/i });
    await userEvent.click(pill);
    expect(screen.queryByRole("button", { name: /new item/i })).not.toBeInTheDocument();
  });
});
