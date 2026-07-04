/**
 * feedCard.test.tsx — Task 6 TDD step 1 (failing).
 *
 * FeedCard: full body, >12-line → Show more, link → pressable, unknown kind → fallback.
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { FeedCard } from "../FeedCard";
import type { Item } from "@crossclipper/core";

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    kind: "text",
    body: "hello world",
    user_id: "u1",
    origin_device_id: "d1",
    target_device_id: null,
    created_at: "2026-01-01T00:00:00",
    deleted_at: null,
    sync_seq: 1,
    ...overrides,
  } as unknown as Item;
}

const LONG_BODY = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("FeedCard", () => {
  it("renders short body in full", () => {
    const { getByText } = render(
      <Wrapper>
        <FeedCard
          item={makeItem({ body: "short text" })}
          originName="My Phone"
          expanded={false}
          onToggleExpand={() => {}}
        />
      </Wrapper>,
    );
    expect(getByText("short text")).toBeTruthy();
  });

  it("renders 'Show more' for body > 12 lines when not expanded", () => {
    const { getByRole } = render(
      <Wrapper>
        <FeedCard
          item={makeItem({ body: LONG_BODY })}
          originName="My Phone"
          expanded={false}
          onToggleExpand={() => {}}
        />
      </Wrapper>,
    );
    expect(getByRole("button", { name: /show more/i })).toBeTruthy();
  });

  it("calls onToggleExpand when 'Show more' is pressed", () => {
    const onToggle = jest.fn();
    const { getByRole } = render(
      <Wrapper>
        <FeedCard
          item={makeItem({ body: LONG_BODY })}
          originName="My Phone"
          expanded={false}
          onToggleExpand={onToggle}
        />
      </Wrapper>,
    );
    fireEvent.press(getByRole("button", { name: /show more/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders 'Show less' when expanded", () => {
    const { getByRole } = render(
      <Wrapper>
        <FeedCard
          item={makeItem({ body: LONG_BODY })}
          originName="My Phone"
          expanded={true}
          onToggleExpand={() => {}}
        />
      </Wrapper>,
    );
    expect(getByRole("button", { name: /show less/i })).toBeTruthy();
  });

  it("renders unknown kind with the fallback string", () => {
    const { getByText } = render(
      <Wrapper>
        <FeedCard
          item={makeItem({ kind: "image" as unknown as "text" | "link" })}
          originName="My Phone"
          expanded={false}
          onToggleExpand={() => {}}
        />
      </Wrapper>,
    );
    expect(getByText(/unsupported item.*update client/i)).toBeTruthy();
  });

  it("link body renders a pressable element", () => {
    const { getByRole } = render(
      <Wrapper>
        <FeedCard
          item={makeItem({ kind: "link", body: "https://example.com" })}
          originName="My Phone"
          expanded={false}
          onToggleExpand={() => {}}
        />
      </Wrapper>,
    );
    // The link body itself is a pressable button
    expect(getByRole("link")).toBeTruthy();
  });

  it("displays originName and relative time", () => {
    const { getByText } = render(
      <Wrapper>
        <FeedCard
          item={makeItem({ created_at: "2026-01-01T00:00:00" })}
          originName="iPad Pro"
          expanded={false}
          onToggleExpand={() => {}}
        />
      </Wrapper>,
    );
    expect(getByText("iPad Pro")).toBeTruthy();
  });
});
