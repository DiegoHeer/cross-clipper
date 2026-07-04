import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Banner } from "../src/ui/Banner";
import { DeviceRail } from "../src/ui/DeviceRail";
import { Feed } from "../src/ui/Feed";
import type { FeedEntry } from "../src/ui/FeedCard";
import type { DeviceView } from "../src/shared/model";
import type { Item } from "@crossclipper/core";

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    kind: "text",
    body: `body ${id}`,
    origin_device_id: "d1",
    target_device_id: null,
    blob_id: null,
    created_at: "2026-07-03T00:00:00",
    deleted_at: null,
    ...over,
  }) as Item;

const devices: DeviceView[] = [
  {
    id: "self",
    name: "Work laptop",
    platform: "windows",
    online: true,
    isSelf: true,
    lastSeenAt: "2026-07-03T11:59:00",
  },
  {
    id: "d2",
    name: "Pixel 8",
    platform: "android",
    online: false,
    isSelf: false,
    lastSeenAt: "2026-07-01T00:00:00",
  },
];

// ---------------------------------------------------------------------------
// DeviceRail
// ---------------------------------------------------------------------------

describe("DeviceRail", () => {
  it("renders All plus every device and reports selection", async () => {
    const onSelect = vi.fn();
    render(<DeviceRail devices={devices} selected={null} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /all/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: /pixel 8/i }));
    expect(onSelect).toHaveBeenCalledWith("d2");
  });

  it("All button is not pressed when a device is selected", () => {
    render(<DeviceRail devices={devices} selected="d2" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /all/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /pixel 8/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows presence dots", () => {
    render(<DeviceRail devices={devices} selected={null} onSelect={() => {}} />);
    expect(
      screen.getByRole("button", { name: /work laptop/i }).querySelector(".dot-online"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /pixel 8/i }).querySelector(".dot-offline"),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

const entry = (id: string, over: Partial<Item> = {}): FeedEntry => ({
  item: item(id, over),
  sendState: undefined,
});

describe("Feed", () => {
  const nameOf = () => "Phone";
  const iconOf = () => "📱";
  const noop = () => {};

  it("renders all entries as article elements", () => {
    const entries: FeedEntry[] = [entry("01B"), entry("01A")];
    render(
      <Feed
        entries={entries}
        nameOf={nameOf}
        iconOf={iconOf}
        onCopy={noop}
        onOpen={noop}
        onDelete={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("shows empty state when there are no entries", () => {
    render(
      <Feed
        entries={[]}
        nameOf={nameOf}
        iconOf={iconOf}
        onCopy={noop}
        onOpen={noop}
        onDelete={noop}
        onRetry={noop}
      />,
    );
    expect(
      screen.getByText(/copy something on another device, or type below/i),
    ).toBeInTheDocument();
  });

  it("does not show pill when not scrolled", () => {
    // Feed shows pill only after scrolling down then new item arrives.
    // Initial render with entries should have no pill.
    const entries: FeedEntry[] = [entry("01A")];
    render(
      <Feed
        entries={entries}
        nameOf={nameOf}
        iconOf={iconOf}
        onCopy={noop}
        onOpen={noop}
        onDelete={noop}
        onRetry={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: /new item/i })).toBeNull();
  });

  it("calls onDelete when delete button clicked", async () => {
    const onDelete = vi.fn();
    render(
      <Feed
        entries={[entry("01A")]}
        nameOf={nameOf}
        iconOf={iconOf}
        onCopy={noop}
        onOpen={noop}
        onDelete={onDelete}
        onRetry={noop}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith("01A");
  });
});

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

describe("Banner", () => {
  it("renders reconnecting text for kind=reconnecting", () => {
    render(<Banner kind="reconnecting" />);
    expect(screen.getByRole("status")).toHaveTextContent(/reconnecting…/i);
  });

  it("renders custom message for kind=version", () => {
    render(<Banner kind="version" message="Update available" />);
    expect(screen.getByRole("status")).toHaveTextContent("Update available");
  });

  it("applies the banner-reconnecting class", () => {
    render(<Banner kind="reconnecting" />);
    expect(screen.getByRole("status")).toHaveClass("banner-reconnecting");
  });
});
