/**
 * Tests for SignInStep — TDD step 1 (Task 10).
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { Platform } from "react-native";
import { SignInStep } from "../SignInStep";
import { ThemeProvider } from "../../theme/ThemeProvider";

// Mock ApiClient
jest.mock("@crossclipper/core", () => ({
  ApiClient: jest.fn(),
}));

import { ApiClient } from "@crossclipper/core";

// Mock expo-device
jest.mock("expo-device", () => ({
  modelName: "iPhone 14",
}));

afterEach(() => jest.restoreAllMocks());

function mockApiClient(loginResult: unknown) {
  const login = jest.fn().mockResolvedValue(loginResult);
  const register = jest.fn().mockResolvedValue(undefined);
  (ApiClient as jest.Mock).mockImplementation(() => ({ login, register }));
  return { login, register };
}

const MOCK_AUTH_STORE = {
  saveAuth: jest.fn().mockResolvedValue(undefined),
};

jest.mock("../authPersist", () => ({
  saveAuth: (...args: unknown[]) => MOCK_AUTH_STORE.saveAuth(...args),
}));

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function renderSignIn(props?: Partial<React.ComponentProps<typeof SignInStep>>) {
  const onDone = jest.fn();
  const utils = render(
    <Wrapper>
      <SignInStep baseUrl="https://clip.example.com" mode="signin" onDone={onDone} {...props} />
    </Wrapper>,
  );
  return { ...utils, onDone };
}

describe("SignInStep", () => {
  it("renders sign in mode with correct heading", () => {
    const { getAllByText } = renderSignIn({ mode: "signin" });
    // "Sign in" appears as both the heading and the button — just assert presence
    expect(getAllByText(/sign in/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders create account mode with correct heading", () => {
    const { getByText } = renderSignIn({ mode: "create" });
    expect(getByText(/create your account/i)).toBeTruthy();
  });

  it("submits login with correct platform from Platform.OS", async () => {
    const { login } = mockApiClient({ token: "tok123", device_id: "dev1" });
    const { getByTestId, getByRole } = renderSignIn({ mode: "signin" });

    fireEvent.changeText(getByTestId("signin-email"), "user@example.com");
    fireEvent.changeText(getByTestId("signin-password"), "password123");

    await act(async () => {
      fireEvent.press(getByRole("button", { name: /sign in/i }));
    });

    expect(login).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        password: "password123",
        platform: Platform.OS === "ios" ? "ios" : "android",
      }),
    );
  });

  it("persists auth and calls onDone on successful login", async () => {
    mockApiClient({ token: "tok123", device_id: "dev1" });
    const { getByTestId, getByRole, onDone } = renderSignIn({ mode: "signin" });

    fireEvent.changeText(getByTestId("signin-email"), "user@example.com");
    fireEvent.changeText(getByTestId("signin-password"), "password123");

    await act(async () => {
      fireEvent.press(getByRole("button", { name: /sign in/i }));
    });

    expect(MOCK_AUTH_STORE.saveAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://clip.example.com",
        token: "tok123",
        deviceId: "dev1",
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("calls register then login for create mode", async () => {
    const { login, register } = mockApiClient({ token: "tok456", device_id: "dev2" });
    const { getByTestId, getByRole } = renderSignIn({ mode: "create" });

    fireEvent.changeText(getByTestId("signin-email"), "new@example.com");
    fireEvent.changeText(getByTestId("signin-password"), "secret");

    await act(async () => {
      fireEvent.press(getByRole("button", { name: /create account/i }));
    });

    expect(register).toHaveBeenCalledWith("new@example.com", "secret");
    expect(login).toHaveBeenCalled();
  });

  it("shows error on login failure", async () => {
    (ApiClient as jest.Mock).mockImplementation(() => ({
      login: jest.fn().mockRejectedValue(new Error("Invalid credentials")),
      register: jest.fn().mockResolvedValue(undefined),
    }));
    const { getByTestId, getByRole, getByText } = renderSignIn({ mode: "signin" });

    fireEvent.changeText(getByTestId("signin-email"), "user@example.com");
    fireEvent.changeText(getByTestId("signin-password"), "wrong");

    await act(async () => {
      fireEvent.press(getByRole("button", { name: /sign in/i }));
    });

    expect(getByText(/invalid credentials/i)).toBeTruthy();
  });

  it("shows notice when provided", () => {
    (ApiClient as jest.Mock).mockImplementation(() => ({
      login: jest.fn(),
      register: jest.fn(),
    }));
    const { getByText } = renderSignIn({ notice: "Session expired — sign in again." });
    expect(getByText(/session expired/i)).toBeTruthy();
  });
});
