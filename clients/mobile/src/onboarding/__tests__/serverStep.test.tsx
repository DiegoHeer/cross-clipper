/**
 * Tests for ServerStep — TDD step 1 (Task 10).
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { ServerStep } from "../ServerStep";
import * as probeModule from "../probe";
import { ThemeProvider } from "../../theme/ThemeProvider";

afterEach(() => jest.restoreAllMocks());

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function renderStep(props?: Partial<React.ComponentProps<typeof ServerStep>>) {
  const onNext = jest.fn();
  const utils = render(
    <Wrapper>
      <ServerStep onNext={onNext} {...props} />
    </Wrapper>,
  );
  return { ...utils, onNext };
}

describe("ServerStep", () => {
  it("shows an error when URL is empty and Next pressed", async () => {
    const { getByText, getByRole } = renderStep();
    await act(async () => { fireEvent.press(getByRole("button", { name: /next/i })); });
    expect(getByText(/enter your server address/i)).toBeTruthy();
  });

  it("shows error message when probe fails (unreachable)", async () => {
    jest.spyOn(probeModule, "probeServer").mockResolvedValue({ ok: false, reason: "unreachable" });
    const { getByText, getByTestId, getByRole } = renderStep();
    fireEvent.changeText(getByTestId("server-url-input"), "https://clip.example.com");
    await act(async () => { fireEvent.press(getByRole("button", { name: /next/i })); });
    expect(getByText(/could not reach/i)).toBeTruthy();
  });

  it("shows error message for not_crossclipper", async () => {
    jest.spyOn(probeModule, "probeServer").mockResolvedValue({ ok: false, reason: "not_crossclipper" });
    const { getByText, getByTestId, getByRole } = renderStep();
    fireEvent.changeText(getByTestId("server-url-input"), "https://clip.example.com");
    await act(async () => { fireEvent.press(getByRole("button", { name: /next/i })); });
    expect(getByText(/did not identify itself/i)).toBeTruthy();
  });

  it("calls onNext with url and probe result on success", async () => {
    const probeResult = { ok: true as const, version: "0.1.0", registrationOpen: false };
    jest.spyOn(probeModule, "probeServer").mockResolvedValue(probeResult);
    const { getByTestId, getByRole, onNext } = renderStep();
    fireEvent.changeText(getByTestId("server-url-input"), "https://clip.example.com");
    await act(async () => { fireEvent.press(getByRole("button", { name: /next/i })); });
    expect(onNext).toHaveBeenCalledWith("https://clip.example.com", probeResult);
  });

  it("shows insecure http warning for non-local host", async () => {
    const { getByText, getByTestId } = renderStep();
    fireEvent.changeText(getByTestId("server-url-input"), "http://example.com");
    expect(getByText(/plain http/i)).toBeTruthy();
  });

  it("does NOT show http warning for localhost", async () => {
    const { queryByText, getByTestId } = renderStep();
    fireEvent.changeText(getByTestId("server-url-input"), "http://localhost:8000");
    expect(queryByText(/plain http/i)).toBeNull();
  });
});
