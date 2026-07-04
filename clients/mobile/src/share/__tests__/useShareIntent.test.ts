/**
 * useShareIntent.test.ts — Task 14 TDD step 1.
 *
 * Tests the useShareIntent() hook wrapper:
 *   - Text share → { kind: "text", body }
 *   - URL share (type=weburl) → { kind: "link", body }
 *   - No intent → { shared: null }
 *   - reset() calls resetShareIntent from the underlying hook
 *
 * expo-share-intent is mocked at the setup level (jest.setup.ts).
 * Per-test overrides use jest.mocked() to configure return values.
 */
import { renderHook } from "@testing-library/react-native";

// The module-level default mock is set in jest.setup.ts.
// We import it here so we can spy on / reconfigure it per test.
import { useShareIntent as useExpoShareIntent } from "expo-share-intent";

import { useShareIntent } from "../useShareIntent";

const mockUseExpoShareIntent = jest.mocked(useExpoShareIntent);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIntent(overrides: object) {
  const resetShareIntent = jest.fn();
  mockUseExpoShareIntent.mockReturnValue({
    isReady: true,
    hasShareIntent: true,
    shareIntent: {
      files: null,
      text: null,
      webUrl: null,
      type: null,
      ...overrides,
    },
    resetShareIntent,
    error: null,
  });
  return resetShareIntent;
}

function makeNoIntent() {
  const resetShareIntent = jest.fn();
  mockUseExpoShareIntent.mockReturnValue({
    isReady: true,
    hasShareIntent: false,
    shareIntent: { files: null, text: null, webUrl: null, type: null },
    resetShareIntent,
    error: null,
  });
  return resetShareIntent;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useShareIntent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when there is no pending intent", () => {
    makeNoIntent();
    const { result } = renderHook(() => useShareIntent());
    expect(result.current.shared).toBeNull();
  });

  it("maps a plain-text share to { kind: 'text', body }", () => {
    makeIntent({ text: "hello world", type: "text" });
    const { result } = renderHook(() => useShareIntent());
    expect(result.current.shared).toEqual({ kind: "text", body: "hello world" });
  });

  it("maps a URL share (text field, lone URL) to { kind: 'link' }", () => {
    makeIntent({ text: "https://example.com/path", type: "text" });
    const { result } = renderHook(() => useShareIntent());
    expect(result.current.shared).toEqual({
      kind: "link",
      body: "https://example.com/path",
    });
  });

  it("maps a webUrl share to { kind: 'link' }", () => {
    makeIntent({ webUrl: "https://news.example.com", type: "weburl" });
    const { result } = renderHook(() => useShareIntent());
    expect(result.current.shared).toEqual({
      kind: "link",
      body: "https://news.example.com",
    });
  });

  it("prefers webUrl over text when both are present", () => {
    makeIntent({ webUrl: "https://url.example.com", text: "some text", type: "weburl" });
    const { result } = renderHook(() => useShareIntent());
    expect(result.current.shared?.body).toBe("https://url.example.com");
  });

  it("trims whitespace from the body", () => {
    makeIntent({ text: "  trimmed  ", type: "text" });
    const { result } = renderHook(() => useShareIntent());
    expect(result.current.shared?.body).toBe("trimmed");
  });

  it("reset() calls the underlying resetShareIntent", () => {
    const resetShareIntent = makeNoIntent();
    const { result } = renderHook(() => useShareIntent());
    result.current.reset();
    expect(resetShareIntent).toHaveBeenCalledTimes(1);
  });

  it("passes resetOnBackground:false to the underlying hook", () => {
    makeNoIntent();
    renderHook(() => useShareIntent());
    expect(mockUseExpoShareIntent).toHaveBeenCalledWith(
      expect.objectContaining({ resetOnBackground: false }),
    );
  });
});
